from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Codex review finding on PR #15 (SEC-1/PERF-1 port), P1: PERF-1's upload
# dedup baseline (board-sync.js's lastPushedBoardContent, keyed off
# boardContentSignature()) only ever got updated by THIS device's own
# pushBoardSnapshotIfConnected() calls and by hydrateFromTeamIfConnected()'s
# boot-time reset -- maybeApplyRemote() (shared by boot hydrate AND the live
# subscription) applied a remote snapshot to local state without ever
# touching that baseline. So once a device had pushed content X, then later
# received a DIFFERENT remote snapshot Y live (never having pushed Y
# itself), its baseline still read "last pushed: X" -- editing the board
# back to X after that looked like "nothing changed since my last push" and
# was silently skipped, even though the actual last-known-shared content was
# Y, not X. Concretely: device A renames a squad to "Original", device B
# changes it to "Remote change" and A receives it live, A changes it back to
# "Original" -- that revert never reached B.
#
# Two REAL, separate browser contexts (only the relay in common, no shared
# localStorage) so this exercises the live-subscription path specifically,
# not the boot-time hydrate path test_board_sync_hydrate_on_boot.py already
# covers.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_board_sync_revert_after_remote_change_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8802  # distinct from every other RELAY_PORT in tests/*.py -- see run_all.sh's own comment on why each must be unique
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


def squad1_name(page):
    return page.eval_on_selector('.admin-squad-name[data-id="squad-1"]', "el => el.value")


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
        point_at_test_relay = "window.SQUAD_PULSE_RELAY_URL = %r;" % RELAY_URL

        # ============ device A: creates a team link ============
        a_ctx = browser.new_context()
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        a.click('.view-btn[data-view="admin"]')
        team_link = a.eval_on_selector("#teamLinkInput", "el=>el.value")

        # ============ device B: opens the SAME team link ============
        b_ctx = browser.new_context()
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        b.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
        b.click('.view-btn[data-view="admin"]')

        print("=== A renames squad-1 to 'Original', B sees it live ===")
        a_name = a.query_selector('.admin-squad-name[data-id="squad-1"]')
        a_name.fill("Original")
        a_name.dispatch_event("change")
        b.wait_for_function("() => document.querySelector('.admin-squad-name[data-id=\"squad-1\"]').value === 'Original'")
        assert squad1_name(b) == "Original"

        print("=== B changes it to 'Remote change', A receives it live (this is the push A never made itself) ===")
        b_name = b.query_selector('.admin-squad-name[data-id="squad-1"]')
        b_name.fill("Remote change")
        b_name.dispatch_event("change")
        a.wait_for_function("() => document.querySelector('.admin-squad-name[data-id=\"squad-1\"]').value === 'Remote change'")
        assert squad1_name(a) == "Remote change"

        print("=== A reverts it back to 'Original' -- must reach B, not get skipped as 'nothing changed since A's last push' ===")
        a_name = a.query_selector('.admin-squad-name[data-id="squad-1"]')
        a_name.fill("Original")
        a_name.dispatch_event("change")
        try:
            b.wait_for_function(
                "() => document.querySelector('.admin-squad-name[data-id=\"squad-1\"]').value === 'Original'",
                timeout=5000,
            )
        except Exception as e:
            raise AssertionError(
                "B never saw A's revert to 'Original' -- B is stuck on 'Remote change': " + str(e)
            )
        assert squad1_name(b) == "Original", "B should have converged back to 'Original' after A's revert"
        # And A's own view must actually reflect what it just typed, not just
        # its own optimistic local state independent of the round trip.
        assert squad1_name(a) == "Original"

        print("errors:", a_errors, b_errors)
        assert a_errors == [] and b_errors == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
