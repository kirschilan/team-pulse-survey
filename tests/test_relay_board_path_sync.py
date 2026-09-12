from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Step 2 of the "Board sync" plan in STATUS.md: relay-client.js and
# local-store.js's router now also recognize "boards/<teamCode>"-rooted
# paths, purely additively -- nothing in the app's UI calls db.doc()/
# collection() with one yet (that's steps 3+). This test proves the
# plumbing itself works end to end, at the level BELOW any UI: two
# independent browser contexts (own localStorage, standing in for two
# devices), talking to the real relay/server.js over a real WebSocket,
# exchange a real encrypted document under a "boards/..." path -- and,
# just as importantly, that adding this doesn't touch "sessions/..." path
# behavior at all (still covered end to end by
# test_relay_cross_device_sync.py).

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_relay_board_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8793
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
        out = relay_proc.stdout.read() if relay_proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        # ============ device A: writes a board doc ============
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)

        print("=== isBoardPath/isSessionPath recognize their own namespaces and not each other's ===")
        checks = a.evaluate("""() => ({
          boardIsBoard: SquadPulseRelay.isBoardPath("boards/TEAM01"),
          boardIsSession: SquadPulseRelay.isSessionPath("boards/TEAM01"),
          sessionIsSession: SquadPulseRelay.isSessionPath("sessions/ABC123"),
          sessionIsBoard: SquadPulseRelay.isBoardPath("sessions/ABC123"),
        })""")
        print(checks)
        assert checks["boardIsBoard"] is True
        assert checks["boardIsSession"] is False
        assert checks["sessionIsSession"] is True
        assert checks["sessionIsBoard"] is False

        print("=== device A writes an encrypted board doc via the real db shim ===")
        a.evaluate("""async () => {
          const db = await window.claude.use("db");
          await db.doc("boards/TEAM01/config").set({ unit: "Tribe", updatedAt: "2026-09-12T00:00:00.000Z" });
        }""")
        a.wait_for_timeout(300)
        print("errors so far:", a_errors)

        # ============ device B: an independently-seeded context joins the
        # same team code and should see A's write over the wire, decrypted ============
        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_timeout(300)

        print("=== device B reads the same board doc, decrypted, over the relay ===")
        result = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/TEAM01/config").get();
          return { exists: snap.exists, data: snap.data() };
        }""")
        print(result)
        assert result["exists"] is True
        assert result["data"]["unit"] == "Tribe"
        print("errors so far:", b_errors)

        print("=== a DIFFERENT board path with no writer yet reads back as not-found, not a crash ===")
        empty = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/NEVERUSED/config").get();
          return { exists: snap.exists };
        }""")
        assert empty["exists"] is False

        print("=== a sessions/* path is completely unaffected by boards/* now also being routed ===")
        session_untouched = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("sessions/ZZZZZZ").get();
          return { exists: snap.exists };
        }""")
        assert session_untouched["exists"] is False

        print("=== a doc() call can pass a SEPARATE secret, decoupling the routing id from the encryption key ===")
        a.evaluate("""async () => {
          const db = await window.claude.use("db");
          await db.doc("boards/ROUTINGONLY", "the-real-secret").set({ hello: "with a secret" });
        }""")

        # Fresh contexts for each read below -- relay-client.js caches an
        # opened room (and the key it was opened with) per page for as long
        # as the page lives, so reusing device A or B here (both of which
        # already opened "boards/ROUTINGONLY" with the correct secret while
        # writing/priming it above) would silently reuse that cached room
        # instead of actually exercising a fresh connection with the secret
        # this check passes.
        right_ctx = browser.new_context()
        right_ctx.add_init_script(point_at_test_relay)
        right_page = right_ctx.new_page()
        right_page.goto(INDEX_URL, wait_until="domcontentloaded")
        right_page.wait_for_timeout(200)
        read_with_right_secret = right_page.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/ROUTINGONLY", "the-real-secret").get();
          return { exists: snap.exists, data: snap.data() };
        }""")
        print("read with the matching secret, from a fresh connection:", read_with_right_secret)
        assert read_with_right_secret["exists"] is True
        assert read_with_right_secret["data"]["hello"] == "with a secret"

        wrong_ctx = browser.new_context()
        wrong_ctx.add_init_script(point_at_test_relay)
        wrong_page = wrong_ctx.new_page()
        wrong_page.goto(INDEX_URL, wait_until="domcontentloaded")
        wrong_page.wait_for_timeout(200)
        read_with_wrong_secret = wrong_page.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/ROUTINGONLY", "a-different-guess").get();
          return { exists: snap.exists };
        }""")
        print("read with the SAME routing id but a wrong secret, from a fresh connection:", read_with_wrong_secret)
        assert read_with_wrong_secret["exists"] is False, "same room, wrong key -- decryption must fail, not fall back to plaintext or the path-derived key"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
