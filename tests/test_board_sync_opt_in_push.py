from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Step 3 of STATUS.md's "Board sync" plan: an opt-in "team code" setting
# (Admin view, board-sync.js) that, once connected, pushes the CURRENT full
# board to boards/<teamCode> on the relay after every squad/dimension/config
# save -- one-way only (hydrate-on-load is the next step). This drives the
# real UI (not a direct page.evaluate call, unlike test_relay_board_path_sync.py
# which only proved the underlying plumbing) to prove: (1) a device with no
# team code set never touches the relay for its board, (2) connecting one and
# then making an ordinary board change (adding a squad) pushes a real,
# decryptable snapshot a second device can read directly off the relay, and
# (3) disconnecting stops further pushes.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8794
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

        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)

        print("=== not connected by default: adding a squad never touches the relay ===")
        status_before = a.eval_on_selector("#teamSyncStatus", "el=>el.textContent")
        print("status:", status_before)
        assert "not connected" in status_before.lower()
        assert a.eval_on_selector("#teamCodeDisconnectBtn", "el=>el.hidden") is True

        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_timeout(300)
        unconnected_read = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/OPTINTEAM").get();
          return snap.exists;
        }""")
        assert unconnected_read is False, "nothing should exist on the relay before any device connects a team code"

        print("=== connecting a team code, then adding a squad, pushes a real board snapshot ===")
        a.fill("#teamCodeInput", "opt-in team!")
        a.click("#teamCodeConnectBtn")
        a.wait_for_timeout(200)
        status_after = a.eval_on_selector("#teamSyncStatus", "el=>el.textContent")
        print("status:", status_after)
        assert "connected" in status_after.lower()
        assert "OPTINTEAM" in status_after, "the code should be normalized (upper-cased, punctuation stripped)"
        assert a.eval_on_selector("#teamCodeInput", "el=>el.value") == "OPTINTEAM"

        a.click("#addSquadBtn")
        a.wait_for_timeout(300)

        remote = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/OPTINTEAM").get();
          return { exists: snap.exists, data: snap.data() };
        }""")
        print("remote board doc:", remote)
        assert remote["exists"] is True
        names = [s["name"] for s in remote["data"]["squads"]]
        print("squad names on the relay's copy of the board:", names)
        assert "New squad" in names, "the squad just added locally should already be in the pushed snapshot"
        assert len(remote["data"]["dimensions"]) > 0

        print("=== disconnecting stops further pushes ===")
        a.click("#teamCodeDisconnectBtn")
        a.wait_for_timeout(150)
        status_disconnected = a.eval_on_selector("#teamSyncStatus", "el=>el.textContent")
        assert "not connected" in status_disconnected.lower()

        a.click("#addSquadBtn")
        a.wait_for_timeout(300)
        remote_after_disconnect = b.evaluate("""async () => {
          const db = await window.claude.use("db");
          const snap = await db.doc("boards/OPTINTEAM").get();
          return snap.data();
        }""")
        names_after = [s["name"] for s in remote_after_disconnect["squads"]]
        print("squad names on the relay after disconnecting + adding another squad locally:", names_after)
        assert names_after.count("New squad") == 1, "the second squad add happened AFTER disconnecting, so it must not have reached the relay"

        print("=== ALL ERRORS:", a_errors)
        assert a_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
