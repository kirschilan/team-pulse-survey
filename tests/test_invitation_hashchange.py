from playwright.sync_api import sync_playwright
from urllib.parse import urlparse, parse_qs
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Codex review on PR #14 (P2 follow-up, after the P1/P2/P3 fixes in commit
# 624e7b7): a fragment-only URL change -- opening a DIFFERENT session/
# co-facilitate invitation link in the SAME already-open tab -- is a same-
# document "fragment navigation" per the HTML spec (true in every real
# browser, not a Playwright quirk): the address bar updates, but nothing
# reruns, so state.js's boot-time fragment parsing never sees the new
# invitation and the OLD session/co-facilitate secret stays active. The
# earlier fix's own regression tests (test_cofacilitator_join.py,
# test_board_sync_finish_retro_convergence.py) used an intermediate
# about:blank navigation specifically to dodge this -- valid for THOSE
# tests' own actual subject (the co-facilitator flow, board convergence),
# but it masked this gap rather than covering it, per the review. This file
# navigates DIRECTLY between two different real invitations, no detour, and
# proves the app now picks up the new one for real -- covering both a
# participant link and a co-facilitator link (bad, then corrected).

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_invitation_hashchange_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8800  # distinct from every other RELAY_PORT in tests/*.py
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

        # ============ facilitator device: start TWO real sessions ============
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
        a_ctx.add_init_script(point_at_test_relay)
        a = a_ctx.new_page()
        a_errors = []
        a.on("pageerror", lambda e: a_errors.append(str(e)))
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_selector(".admin-squad-name", state="attached")

        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.click("#startSessionBtn")
        a.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")
        join_link1 = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        cofac_link1 = a.eval_on_selector("#coFacilitateLink", "el=>el.value")

        a.click('.view-btn[data-view="squad"]')
        a.click('.squad-pick-btn[data-id="squad-2"]')
        a.click("#startSessionBtn")
        a.wait_for_function(
            "prev => { var el = document.getElementById('sessionJoinLink'); return el && el.value.length > 0 && el.value !== prev; }",
            arg=join_link1,
        )
        join_link2 = a.eval_on_selector("#sessionJoinLink", "el=>el.value")
        cofac_link2 = a.eval_on_selector("#coFacilitateLink", "el=>el.value")

        assert join_link1 != join_link2
        assert cofac_link1 != cofac_link2
        print("join link 1 (squad-1):", join_link1)
        print("join link 2 (squad-2):", join_link2)
        print("errors so far:", a_errors)

        # ============ PARTICIPANT: direct navigation between two different
        # invitations, same tab, no about:blank detour ============
        print("=== participant opens invitation 1, then DIRECTLY opens invitation 2 (no detour) ===")
        part_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        part_ctx.add_init_script(point_at_test_relay)
        part = part_ctx.new_page()
        part_errors = []
        part.on("pageerror", lambda e: part_errors.append(str(e)))
        part.goto(join_link1, wait_until="domcontentloaded")
        part.wait_for_selector("#joinCard .direct-row")
        heading1 = part.eval_on_selector("#joinCard h2", "el=>el.textContent")
        print("heading after invitation 1:", heading1)
        assert "Squad 1" in heading1

        # THE regression under test: a plain goto() straight from one
        # invitation to a DIFFERENT one, sharing the same page path -- these
        # differ only by fragment, so this is exactly the same-document
        # navigation the fix has to handle.
        part.goto(join_link2, wait_until="domcontentloaded")
        part.wait_for_function("() => document.querySelector('#joinCard h2') && document.querySelector('#joinCard h2').textContent.indexOf('Squad 2') !== -1")
        part.wait_for_selector("#joinCard .direct-row")
        heading2 = part.eval_on_selector("#joinCard h2", "el=>el.textContent")
        print("heading after DIRECT navigation to invitation 2:", heading2)
        assert "Squad 2" in heading2, "opening a second invitation in the same tab must switch to it, not silently keep the first session"

        rows = part.query_selector_all(".direct-row")
        assert len(rows) > 0, "should see squad-2's real dimensions, not squad-1's stale session"
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
        rows[-1].query_selector(".swatch.crit").click()
        part.click("#stmtSubmitBtn")
        part.wait_for_selector(".personal-result .pill")
        print("errors:", part_errors)
        assert part_errors == []

        # ============ CO-FACILITATOR: a bad link, then DIRECTLY a corrected
        # one, same tab, no about:blank detour ============
        print("=== co-facilitator opens a BAD link, then DIRECTLY the corrected one (no detour) ===")
        cofac_secret2 = parse_qs(urlparse(cofac_link2).fragment)["cofacilitate"][0]
        bad_cofac_link2 = cofac_link2.replace("cofacilitate=" + cofac_secret2, "cofacilitate=ZZZZZZ-bad-secret")

        cofac_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
        cofac_ctx.add_init_script(point_at_test_relay)
        cofac = cofac_ctx.new_page()
        cofac_errors = []
        cofac.on("pageerror", lambda e: cofac_errors.append(str(e)))
        cofac.goto(bad_cofac_link2, wait_until="domcontentloaded")
        cofac.wait_for_selector("#confirmBackdrop", state="visible")
        assert cofac.eval_on_selector("#confirmBackdrop", "el=>!el.hidden")
        cofac.click("#confirmOk")

        # THE regression under test: the corrected link opened DIRECTLY,
        # same tab, right after the bad one -- both differ only by fragment.
        cofac.goto(cofac_link2, wait_until="domcontentloaded")
        cofac.wait_for_selector(".session-card")
        print("co-facilitator landed on the normal board after the corrected link:", cofac.eval_on_selector("#viewJoin", "el=>el.hidden"))
        assert cofac.eval_on_selector("#viewJoin", "el=>el.hidden") is True
        assert cofac.eval_on_selector("#viewSquad", "el=>el.hidden") is False
        assert cofac.query_selector(".session-card") is not None
        print("errors:", cofac_errors)
        assert cofac_errors == []

        print("=== ALL ERRORS: a=", a_errors, "participant=", part_errors, "cofacilitator=", cofac_errors)
        browser.close()
        print("Direct same-tab navigation between two different invitations (participant and co-facilitator) switches session state correctly: passed")
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
