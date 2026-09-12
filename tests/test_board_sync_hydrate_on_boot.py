from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Step 4 of STATUS.md's "Board sync" plan: hydrate-on-load. A device that
# already has a team code configured (board-sync.js's opt-in setting from
# step 3) now pulls the latest board snapshot for that code from the relay
# BEFORE its local squads/dimensions/config listeners register (db.js's
# initDb()), and applies it if the remote is newer than what this device
# already knows about -- last-write-wins by the payload's own `updatedAt`.
#
# This proves the real round trip end to end, over the real relay:
#   1. Device A connects a team code and adds a squad -- pushes.
#   2. Device B, freshly booting with that SAME team code already set (as
#      if it had connected in an earlier session), hydrates A's board on
#      boot -- sees A's added squad without ever clicking anything.
#   3. Device B then adds its OWN squad, producing a newer push.
#   4. Device A reloads -- hydrates B's newer state on its next boot, and
#      now sees B's squad too. Last-write-wins works both directions, not
#      just "second device catches up once".

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_hydrate_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8795
RELAY_URL = "ws://localhost:%d" % RELAY_PORT
TEAM_CODE = "HYDRATE1"


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

        # ============ device A: connects, adds a squad, pushes ============
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)
        a.fill("#teamCodeInput", TEAM_CODE)
        a.click("#teamCodeConnectBtn")
        a.wait_for_timeout(200)
        a.click("#addSquadBtn")
        a.wait_for_timeout(300)
        a_squad_names = a.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("=== device A's board after adding a squad ===")
        print(a_squad_names)
        assert "New squad" in a_squad_names
        print("errors so far:", a_errors)

        # ============ device B: boots FRESH but with the team code already
        # set (as if connected in an earlier session) -- hydrate-on-load
        # should pull A's board with no click at all ============
        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b_ctx.add_init_script("localStorage.setItem('squadpulse:teamCode', %r);" % TEAM_CODE)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_timeout(600)
        b.click('.view-btn[data-view="admin"]')
        b.wait_for_timeout(100)

        print("=== device B, booting with the team code pre-set, hydrates A's board automatically ===")
        b_status = b.eval_on_selector("#teamSyncStatus", "el=>el.textContent")
        print("B's team sync status:", b_status)
        assert "connected" in b_status.lower()
        b_squad_names = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's board after boot-time hydrate:", b_squad_names)
        assert "New squad" in b_squad_names, "device B should have pulled device A's board on boot, with no click"
        print("errors so far:", b_errors)

        # ============ device B adds its own squad -- a newer push ============
        print("=== device B adds its own squad, producing a newer push ===")
        b.click("#addSquadBtn")
        b.wait_for_timeout(300)
        b_squad_names_2 = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's board after adding its own squad:", b_squad_names_2)
        assert b_squad_names_2.count("New squad") == 2

        # ============ device A reloads -- should hydrate B's newer state ============
        print("=== device A reloads, hydrates B's newer state on its next boot ===")
        a.reload(wait_until="domcontentloaded")
        a.wait_for_timeout(700)
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)
        a_squad_names_after_reload = a.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device A's board after reload:", a_squad_names_after_reload)
        assert a_squad_names_after_reload.count("New squad") == 2, "A should now see BOTH squads named 'New squad' -- its own original push, plus B's later one"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
