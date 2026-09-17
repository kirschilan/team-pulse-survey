from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# REF-3 (STATUS.md's "Code quality & refactoring backlog"): the second of
# the two real coverage gaps the backlog identified for board-sync.js --
# disconnect/reconnect with a queued board-sync push. relay-client.js's own
# queue-while-disconnected/resend-on-reconnect mechanics are already
# thoroughly covered (tests/test_relay_error_handling.py,
# tests/test_relay_write_acknowledgment.py) at THAT layer -- a single
# device, one write, no second device. This test exercises the same real
# outage/recovery through board-sync.js's OWN push path instead: two
# team-synced devices, a real relay killed and restarted mid-edit, proving
# the edit a device made WHILE disconnected genuinely reaches a SECOND
# device once the relay comes back -- not just that the writing device's
# own promise eventually resolves.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_disconnect_reconnect.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8805  # distinct from every other RELAY_PORT in tests/*.py -- see run_all.sh's own comment on why each must be unique
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
        ["node", "server.js"], cwd=str(RELAY_DIR), env=relay_env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if not wait_for_port(RELAY_PORT):
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        out = proc.stdout.read() if proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))
    return proc


relay_proc = start_relay()

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        secret = None

        # ---- Device A: creates the team, device B joins it ----
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        errors_a = []
        a.on("pageerror", lambda e: errors_a.append(str(e)))
        a.goto(INDEX_URL)
        a.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
        secret = a.evaluate("() => SquadPulseCrypto.generateSecret()")
        a.evaluate("(secret) => connectWithSecret(secret)", secret)

        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        errors_b = []
        b.on("pageerror", lambda e: errors_b.append(str(e)))
        b.goto(INDEX_URL)
        b.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
        b.evaluate("(secret) => connectWithSecret(secret)", secret)

        # Confirm B is really live-subscribed to A's team before the outage --
        # A renames squad-1, B (subscribed) must pick it up with no reload.
        a.click('.view-btn[data-view="admin"]')
        a.evaluate("() => renameSquad('squad-1', 'BeforeOutage')")
        b.wait_for_function("() => state.squads.filter(s => s.id==='squad-1')[0].name === 'BeforeOutage'")
        print("=== baseline: B picks up A's edit live, before any outage ===")

        # ---- Kill the relay -- both devices' WebSockets drop ----
        print("=== killing the relay ===")
        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        assert wait_for_port_closed(RELAY_PORT), "relay port never actually closed"
        a.wait_for_function(
            "() => document.getElementById('diagLog').textContent.includes('disconnected') || document.getElementById('diagLog').textContent.includes('reconnecting')"
        )

        # ---- While disconnected, A makes an edit -- pushBoardSnapshotIfConnected()
        # issues a real write that relay-client.js queues (room.sendQueue)
        # since the socket is down. ----
        print("=== A edits while disconnected -- the push gets queued, not lost ===")
        a.evaluate("() => renameSquad('squad-1', 'DuringOutage')")

        # ---- Relay comes back on the same port ----
        print("=== restarting the relay ===")
        relay_proc = start_relay()

        # ---- The ONLY waits below are real, causal conditions -- no fixed
        # sleep guessing how long reconnect+resend+ack+broadcast takes. ----
        print("=== B (a SEPARATE device, never told about the outage directly) must see A's edit once the relay comes back ===")
        b.wait_for_function(
            "() => state.squads.filter(s => s.id==='squad-1')[0].name === 'DuringOutage'",
            timeout=15000,
        )

        # A's own local state must also agree (it's not just that B guessed
        # right independently).
        a_name = a.evaluate("() => state.squads.filter(s => s.id==='squad-1')[0].name")
        assert a_name == "DuringOutage"

        print("errors (A):", errors_a)
        print("errors (B):", errors_b)
        assert errors_a == []
        assert errors_b == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
