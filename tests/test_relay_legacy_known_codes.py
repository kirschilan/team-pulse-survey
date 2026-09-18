from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket

# Codex review on PR #14 (P2): relay-client.js's loadKnownCodes() used to
# assume every entry under localStorage's "squadpulse:relay:knownCodes" key
# was already the SEC-2 {roomId, secret} shape. A device that saved entries
# under the OLDER shape (a bare code string -- see the pre-SEC-2 form of
# rememberCode()/loadKnownCodes()) handed getRoom() `{roomId: undefined,
# secret: undefined}`, which opened a WebSocket asking the relay to route
# "?code=undefined" -- reconnecting nothing (there is nothing to migrate a
# typed-code entry TO; that whole concept no longer exists) and, worse,
# doing it on every single reload forever.
#
# Migration decision (per docs/DefinitionOfDone.md's "new data shape" rule):
# RETIRE, don't migrate. A legacy entry carries no secret this app can
# recover (the old shape's bare string WAS a human-typed code, not a
# derivable secret), and a typed-code session was already short-lived by
# design (forgotten within minutes of the retro ending -- see relay-
# client.js's own header comment) -- by the time this ships, any such saved
# entry is for a retro that ended long ago. loadKnownCodes() now filters out
# anything that isn't a well-formed {roomId, secret} pair, silently, on
# every read -- never attempting to reconnect it, never crashing, and never
# affecting any OTHER, well-formed entry sitting right next to it in the
# same array.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "public"
CRYPTO_JS = (PUBLIC_DIR / "js" / "crypto.js").read_text(encoding="utf-8")
RELAY_CLIENT_JS = (PUBLIC_DIR / "js" / "relay-client.js").read_text(encoding="utf-8")
RELAY_DIR = REPO_ROOT / "relay"
RELAY_PORT = 8799  # distinct from every other RELAY_PORT in tests/*.py -- see tests/run_all.sh's own comment on why each must be unique
RELAY_URL = "ws://localhost:%d" % RELAY_PORT


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def build_harness(out_name):
    # Same minimal isolation harness tests/test_relay_error_handling.py uses:
    # only crypto.js + relay-client.js, no fake store, no rest-of-app --
    # this test is about relay-client.js's own localStorage handling, not
    # anything UI-driven.
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<script>window.SQUAD_PULSE_RELAY_URL = " + repr(RELAY_URL) + ";</script>"
        "<script>" + CRYPTO_JS + "</script>"
        "<script>" + RELAY_CLIENT_JS + "</script>"
        "</head><body>"
        "<div id='diagLog'></div>"
        "<script>window.diag = function(msg){ document.getElementById('diagLog').textContent += msg + \"\\n\"; };</script>"
        "</body></html>"
    )
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


relay_env = dict(os.environ)
relay_env["PORT"] = str(RELAY_PORT)
relay_proc = subprocess.Popen(
    ["node", "server.js"],
    cwd=str(RELAY_DIR),
    env=relay_env,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)

try:
    if not wait_for_port(RELAY_PORT):
        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        out = relay_proc.stdout.read() if relay_proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        harness = build_harness("_test_relay_legacy_known_codes.html")

        page = browser.new_page()
        console = []
        page.on("console", lambda m: console.append(m.type + ": " + m.text))
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto("file://" + str(harness.resolve()), wait_until="domcontentloaded")

        # Seed a legacy bare-string entry (the pre-SEC-2 shape) alongside a
        # real, well-formed {roomId, secret} entry -- roomId computed via
        # the real crypto.js call the app itself uses, so this proves the
        # fix distinguishes the two shapes rather than just wiping the list.
        setup = page.evaluate("""
          (async () => {
            var secret = "well-formed-legacy-sibling-secret";
            var roomId = await SquadPulseCrypto.roomIdFor(secret);
            var legacyShape = ["legacyBareCodeString123", { roomId: roomId, secret: secret }];
            localStorage.setItem("squadpulse:relay:knownCodes", JSON.stringify(legacyShape));
            return { roomId: roomId, secret: secret };
          })()
        """)
        print("seeded legacy + well-formed knownCodes entries:", setup)

        # Reload so relay-client.js's own state starts fresh and
        # subscribeBroadSessions() below is the FIRST thing to read the
        # seeded list, same as a real page boot would.
        page.reload(wait_until="domcontentloaded")

        result = page.evaluate(
            "roomId => new Promise((resolve) => {"
            "  SquadPulseRelay.collection('sessions').onSnapshot(function(snap){"
            "    resolve({ size: snap.size, secretForWellFormed: SquadPulseRelay.secretForRoom(roomId) });"
            "  });"
            "})",
            setup["roomId"],
        )
        print("subscribeBroadSessions() result:", result)

        page.wait_for_timeout(300)  # let any (mis)reconnect attempts settle
        diag_text = page.eval_on_selector("#diagLog", "el=>el.textContent")
        print("diag log:\n", diag_text)
        print("console:", console)
        print("page errors:", errors)

        assert errors == [], "a legacy bare-string knownCodes entry must not throw -- just be silently retired"
        assert "undefined" not in diag_text, \
            "must never attempt to reconnect a legacy entry as an 'undefined' room -- diag log: " + diag_text
        assert result["secretForWellFormed"] == setup["secret"], \
            "a well-formed entry sitting next to a legacy one in the same list must still be usable"

        browser.close()
        print("Legacy knownCodes entries are silently retired; well-formed entries alongside them are unaffected: passed")
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
