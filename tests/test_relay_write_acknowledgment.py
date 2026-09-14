from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket, sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

# Proves relay-client.js's doc().set()/update()/delete() now resolve on a
# real relay acknowledgment, not "the write was merely queued locally" --
# the exact gap that let a fresh reader (test_relay_board_path_sync.py) race
# a just-written board doc under parallel CPU load. See relay/server.js's
# updated wire-protocol comment and relay/test/relay.test.js for the
# protocol-level half of this coverage; this file proves relay-client.js's
# own promise/correlation/reconnect handling of that protocol, against a
# REAL relay/server.js subprocess and a real WebSocket -- no mock, no fake
# store. Uses the same "load crypto.js + relay-client.js only" isolation
# harness test_relay_error_handling.py already established, so this stays
# about relay-client.js's own contract, not the whole app's UI.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
PUBLIC_DIR = REPO_ROOT / "public"
CRYPTO_JS = (PUBLIC_DIR / "js" / "crypto.js").read_text(encoding="utf-8")
RELAY_CLIENT_JS = (PUBLIC_DIR / "js" / "relay-client.js").read_text(encoding="utf-8")
RELAY_PORT = 8797  # unused by any other test file (see grep across tests/*.py before picking)
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


def wait_for_port_closed(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                time.sleep(0.05)
        except OSError:
            return True
    return False


def start_relay():
    relay_env = dict(os.environ)
    relay_env["PORT"] = str(RELAY_PORT)
    proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=str(RELAY_DIR),
        env=relay_env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if not wait_for_port(RELAY_PORT):
        # Must kill the process (closing its stdout) BEFORE reading it --
        # .read() blocks until EOF, and a relay that's still alive (just
        # slow to bind, e.g. under CPU contention from parallel test jobs)
        # never sends EOF, so this used to deadlock the whole suite instead
        # of raising the intended error. Found via a real hang in CI/local
        # runs: this exact test process stuck for 50+ minutes.
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        out = proc.stdout.read() if proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))
    return proc


def build_harness(out_name):
    """Same isolation harness test_relay_error_handling.py uses (only
    crypto.js + relay-client.js, no full app) -- plus a thin, test-only
    wrapper around the real WebSocket constructor that counts real "ack"
    messages as they actually arrive. This does not fake or intercept any
    protocol behavior -- every message still goes over a real WebSocket to
    the real relay -- it only counts what already happened, so the test can
    assert a write's promise resolved AFTER an ack was actually received,
    not just "eventually, probably.\""""
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<script>window.SQUAD_PULSE_RELAY_URL = %r;</script>" % RELAY_URL +
        "<script>"
        "window.__acksReceived = 0;"
        "var __NativeWebSocket = window.WebSocket;"
        "window.WebSocket = function(url){"
        "  var ws = new __NativeWebSocket(url);"
        "  ws.addEventListener('message', function(evt){"
        "    try{ var m = JSON.parse(evt.data); if(m.op==='ack') window.__acksReceived++; }catch(e){}"
        "  });"
        "  return ws;"
        "};"
        "</script>"
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


relay_proc = start_relay()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()

        harness = build_harness("_test_relay_ack_harness.html")
        harness_url = "file://" + str(harness.resolve())

        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(harness_url, wait_until="domcontentloaded")

        print("=== a write's promise resolves only once a real ack has actually been received, not merely queued ===")
        result = page.evaluate("""
          async () => {
            var acksBefore = window.__acksReceived;
            await SquadPulseRelay.doc("boards/ACKPROOF/config").set({ hello: "world" });
            return { acksBefore: acksBefore, acksAfter: window.__acksReceived };
          }
        """)
        print("acks before/after the awaited set():", result)
        assert result["acksAfter"] == result["acksBefore"] + 1, (
            "set() must not resolve before its own ack has been received -- "
            "resolving on mere queuing is the exact bug this test exists to catch"
        )
        print("errors so far:", errors)

        print("=== a fresh connection reads back the acked write immediately, with no fixed wait at all ===")
        fresh_page = browser.new_page()
        fresh_page.goto(harness_url, wait_until="domcontentloaded")
        read = fresh_page.evaluate("""
          async () => {
            const snap = await SquadPulseRelay.doc("boards/ACKPROOF/config").get();
            return { exists: snap.exists, data: snap.data() };
          }
        """)
        print("fresh read:", read)
        assert read["exists"] is True
        assert read["data"]["hello"] == "world"

        print("=== two concurrent writes resolve independently, correlated by their own opId (not just arrival order) ===")
        concurrent = page.evaluate("""
          async () => {
            var acksBefore = window.__acksReceived;
            await Promise.all([
              SquadPulseRelay.doc("boards/ACKPROOF/first").set({ n: 1 }),
              SquadPulseRelay.doc("boards/ACKPROOF/second").set({ n: 2 }),
            ]);
            return { acksAfter: window.__acksReceived - acksBefore };
          }
        """)
        print("acks received for the two concurrent writes:", concurrent)
        assert concurrent["acksAfter"] == 2
        # A NEW page here, not the already-open fresh_page above: fresh_page
        # has been continuously connected since its earlier read, so by now
        # it's just another live subscriber -- reading through it would
        # depend on the server's "put" BROADCAST to it having already been
        # received and decrypted, a completely separate, unawaited path from
        # the ack the writer itself waited on. That's exactly the kind of
        # race this whole file exists to eliminate; a genuinely fresh
        # connection's very first snapshot is built synchronously from
        # room.docs at accept time, so it's guaranteed to reflect both
        # already-acked writes with no timing dependency at all.
        second_reader = browser.new_page()
        second_reader.goto(harness_url, wait_until="domcontentloaded")
        both = second_reader.evaluate("""
          async () => {
            var a = await SquadPulseRelay.doc("boards/ACKPROOF/first").get();
            var b = await SquadPulseRelay.doc("boards/ACKPROOF/second").get();
            return { a: a.data(), b: b.data() };
          }
        """)
        print("both concurrent writes landed at their own path:", both)
        assert both["a"]["n"] == 1 and both["b"]["n"] == 2

        print("=== a write the relay rejects (oversized envelope) surfaces a real rejection, not a hang ===")
        rejected = page.evaluate("""
          async () => {
            try {
              await SquadPulseRelay.doc("boards/ACKPROOF/toobig").set({ huge: "x".repeat(300000) });
              return { rejected: false };
            } catch (e) {
              return { rejected: true, code: e.code, message: e.message };
            }
          }
        """)
        print("oversized write result:", rejected)
        assert rejected["rejected"] is True
        assert rejected.get("message"), "a rejected write should carry the relay's own error message, not a generic one"

        print("=== a write made while the relay connection is down (mid-reconnect) still resolves once it reconnects and acks -- no resend loses correlation ===")
        # First write succeeds normally, proving the room is fully up.
        page2 = browser.new_page()
        page2.goto(harness_url, wait_until="domcontentloaded")
        page2.evaluate("""
          async () => { await SquadPulseRelay.doc("boards/RECONNECT/config").set({ seq: 0 }); }
        """)

        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        assert wait_for_port_closed(RELAY_PORT), "relay port never actually closed"

        # room.ready already resolved from the write above, so this call
        # runs putDoc() immediately and finds the socket down -- exactly
        # the "queued while not connected" path relay-client.js's sendQueue
        # (reused for a mid-flight reconnect) has to handle correctly.
        page2.wait_for_function(
            "() => document.getElementById('diagLog').textContent.includes('disconnected') || document.getElementById('diagLog').textContent.includes('reconnecting')"
        )
        pending_write_started_at = time.time()

        # A fresh relay process on the same port stands in for the network
        # coming back -- relay-client.js's own backoff/reconnect logic (not
        # this test) decides when to retry.
        relay_proc = start_relay()

        # The ONLY wait below is Playwright's page.evaluate() awaiting the
        # REAL promise relay-client.js returns -- there is no fixed sleep
        # anywhere in this scenario. If reconnect+resend+ack didn't work,
        # this would hang until Playwright's own default timeout and fail
        # loudly, not silently pass.
        reconnected_write = page2.evaluate("""
          async () => {
            var acksBefore = window.__acksReceived;
            await SquadPulseRelay.doc("boards/RECONNECT/config").set({ seq: 1 });
            return { acksAfter: window.__acksReceived - acksBefore };
          }
        """)
        print("write made while disconnected, resolved %.2fs after the relay came back:" % (time.time() - pending_write_started_at), reconnected_write)
        assert reconnected_write["acksAfter"] == 1

        confirm_page = browser.new_page()
        confirm_page.goto(harness_url, wait_until="domcontentloaded")
        confirmed = confirm_page.evaluate("""
          async () => {
            const snap = await SquadPulseRelay.doc("boards/RECONNECT/config").get();
            return snap.data();
          }
        """)
        print("final state after reconnect, read from a fresh connection:", confirmed)
        assert confirmed["seq"] == 1, "the write made during the outage must have actually landed once the relay came back, not been silently dropped"

        print("=== ALL ERRORS:", errors)
        assert errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()

print("=== ALL WRITE-ACKNOWLEDGMENT TESTS PASSED ===")
