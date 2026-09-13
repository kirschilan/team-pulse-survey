from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Step 5 of STATUS.md's "Board sync" plan: live subscribe. Step 4's
# hydrate-on-load only checked the relay once, at boot (or right after
# connecting) -- seeing a teammate's later change required a RELOAD (see
# test_board_sync_hydrate_on_boot.py). This step keeps the boards/<roomId>
# relay connection open and reacts to every future update live, the same
# way a retro session already does, so two devices open AT THE SAME TIME on
# the same team link converge without either one reloading.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_live_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8796
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

        # ============ device A: creates a team link ============
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(300)
        a.click('.view-btn[data-view="admin"]')
        a.wait_for_timeout(100)
        a.wait_for_timeout(300)  # step 7: default-on -- device A already has its own team link, no click needed
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")

        # ============ device B: opens the SAME team link, both devices open
        # and live at the same time -- no reload from here on ============
        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        b.wait_for_timeout(400)
        b.click('.view-btn[data-view="admin"]')
        b.wait_for_timeout(100)

        print("=== both devices connected via the same link; device A adds a squad -- device B should see it LIVE, no reload ===")
        a.click("#addSquadBtn")
        # real relay round trip + B's live callback -- wait for the actual
        # result B is about to be checked for, not a guessed delay
        b.wait_for_function("() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).some(i => i.value === 'New squad')")

        b_squad_names = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's board, without ever reloading:", b_squad_names)
        assert "New squad" in b_squad_names, "device B should have picked up A's change live, via the open subscription"

        print("=== the reverse direction also works live: device B adds a squad, device A sees it live ===")
        b.click("#addSquadBtn")
        a.wait_for_function("() => Array.from(document.querySelectorAll('#adminSquadList input.admin-squad-name')).filter(i => i.value === 'New squad').length === 2")
        a_squad_names = a.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device A's board, without ever reloading:", a_squad_names)
        assert a_squad_names.count("New squad") == 2, "device A should now see BOTH squads (its own + B's), live"

        print("=== disconnecting stops live updates too, not just pushes ===")
        b.click("#teamDisconnectBtn")
        b.wait_for_timeout(150)
        a.click("#addSquadBtn")
        a.wait_for_timeout(600)
        b_squad_names_after_disconnect = b.eval_on_selector_all("#adminSquadList input.admin-squad-name", "els=>els.map(e=>e.value)")
        print("device B's board after disconnecting, following another change on A:", b_squad_names_after_disconnect)
        assert b_squad_names_after_disconnect.count("New squad") == 2, "B disconnected BEFORE this third squad add -- it must not have arrived"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors)
        assert a_errors == [] and b_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
