from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Story 6 of STATUS.md's "Board sync" plan: wire "finish retro" through the
# shared board doc -- the actual fix for the original bug report (Mac
# facilitates squad-1, iOS facilitates squad-2, each device ends up with
# only its OWN half of the picture) and the "co-facilitator finish retro"
# ownership question. "Finish & apply" already writes into the local
# `squads/<id>` doc (squads.js's persistDimensionRatings) -- and that path
# already gets pushed to a connected team's shared board by db.js's squads
# onSnapshot listener (wired in step 3), then picked up live by any other
# device subscribed to that team (step 5). Written BEFORE any new
# production code, per this repo's TDD skill, specifically to find out
# whether steps 1-5 already close this gap or whether real new plumbing is
# needed.
#
# Reproduces the ORIGINAL bug report as closely as this harness allows,
# with one addition: both devices are connected to the same team link.
#   1. Device A creates a team link; device B opens it (both team-synced).
#   2. Device A facilitates a retro for squad-1; device B joins as
#      participant and answers; device A finishes -- squad-1's result
#      should reach device B LIVE, no reload, via the open team subscription.
#   3. Reverse roles: device B facilitates a retro for squad-2; device A
#      joins and answers; device B finishes -- squad-2's result should
#      reach device A LIVE too.
#   4. Both devices now show BOTH squads' real results -- the divergence
#      from the original bug report is gone.
#
# Rainy day: a THIRD device that never connected to the team link (a plain
# session participant, exactly like today's default/disconnected use) must
# NOT receive either squad's board-wide update -- team sync only affects
# devices that opted in, never a bystander session participant.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RELAY_DIR = REPO_ROOT / "relay"
INDEX = write_plain_index(out_name="_test_finish_retro_convergence_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())
RELAY_PORT = 8792
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


def cell_color(page, squad_id, dim_key):
    classes = page.eval_on_selector(
        '.cell-btn[data-squad="%s"][data-dim="%s"]' % (squad_id, dim_key),
        "el => el.className",
    )
    for c in ("good", "warn", "crit", "unscored"):
        if c in classes.split():
            return c
    return None


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

        # ============ device A connects, creates the team link ============
        a_ctx = browser.new_context(viewport={"width": 1280, "height": 1200})
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

        # ============ device B opens the same team link ============
        b_ctx = browser.new_context(viewport={"width": 420, "height": 1400})
        b_ctx.add_init_script(point_at_test_relay)
        b = b_ctx.new_page()
        b_errors = []
        b.on("pageerror", lambda e: b_errors.append(str(e)))
        b.goto(team_link, wait_until="domcontentloaded")
        b.wait_for_timeout(500)

        print("=== round 1: device A facilitates squad-1, device B answers ===")
        a.click('.view-btn[data-view="squad"]')
        a.wait_for_timeout(100)
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.wait_for_timeout(150)
        a.click("#startSessionBtn")
        a.wait_for_timeout(400)
        code1 = a.eval_on_selector(".session-code", "el=>el.textContent")
        assert code1 and len(code1) == 6
        print("session 1 code:", code1)

        b.click("#joinCodeBtn")
        b.wait_for_timeout(100)
        b.fill("#joinCodeInput", code1)
        b.click("#joinCodeGo")
        b.wait_for_timeout(600)
        rows = b.query_selector_all(".direct-row")
        assert len(rows) > 0, "device B should see squad-1's real dimensions over the relay"
        for row in rows[:-1]:
            row.query_selector(".swatch.good").click()
            b.wait_for_timeout(20)
        rows[-1].query_selector(".swatch.crit").click()
        b.wait_for_timeout(50)
        b.click("#stmtSubmitBtn")
        b.wait_for_timeout(400)

        # Device B is a join-mode page now (no nav back to the main app --
        # that's the real, current gap story 9 is about) -- navigating back
        # to the plain URL is exactly what the ORIGINAL bug report's repro
        # steps did too ("*refreshed page on iOS*; iOS now goes to main
        # page"). Team sync survives this since the secret is in localStorage,
        # not the URL that just got left behind.
        b.goto(INDEX_URL, wait_until="domcontentloaded")
        b.wait_for_timeout(500)

        a.click('.reveal-btn[data-reveal="live"]')
        a.wait_for_timeout(400)
        a.click("#finishSessionBtn")
        a.wait_for_timeout(150)
        a.click("#confirmOk")
        a.wait_for_timeout(500)
        print("=== device A finished squad-1's retro -- checking device A's own board ===")
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.wait_for_timeout(150)
        a_squad1_release = cell_color(a, "squad-1", "release")
        print("device A, squad-1/release:", a_squad1_release)
        assert a_squad1_release in ("good", "warn", "crit")

        print("=== does device B see squad-1's finished result LIVE, via its open subscription (no SECOND reload)? ===")
        b.click('.view-btn[data-view="squad"]')
        b.wait_for_timeout(200)
        b.click('.squad-pick-btn[data-id="squad-1"]')
        b.wait_for_timeout(600)  # give the team-board push+live-subscribe round trip time
        b_squad1_release = cell_color(b, "squad-1", "release")
        print("device B, squad-1/release (live, no second reload):", b_squad1_release)
        assert b_squad1_release == a_squad1_release, "device B should see the SAME finished result A just applied, live, via the shared team board -- this is the actual fix for the original divergence bug"

        print("=== round 2: reverse roles -- device B facilitates squad-2, device A answers ===")
        b.click('.squad-pick-btn[data-id="squad-2"]')
        b.wait_for_timeout(150)
        b.click("#startSessionBtn")
        b.wait_for_timeout(400)
        code2 = b.eval_on_selector(".session-code", "el=>el.textContent")
        assert code2 and len(code2) == 6 and code2 != code1
        print("session 2 code:", code2)

        a.click("#joinCodeBtn")
        a.wait_for_timeout(100)
        a.fill("#joinCodeInput", code2)
        a.click("#joinCodeGo")
        a.wait_for_timeout(600)
        rows2 = a.query_selector_all(".direct-row")
        assert len(rows2) > 0, "device A should see squad-2's real dimensions over the relay"
        for row in rows2[:-1]:
            row.query_selector(".swatch.good").click()
            a.wait_for_timeout(20)
        rows2[-1].query_selector(".swatch.warn").click()
        a.wait_for_timeout(50)
        a.click("#stmtSubmitBtn")
        a.wait_for_timeout(400)
        # Same as device B in round 1 -- device A is stuck on the join
        # screen with no nav back (the real gap story 9 addresses), so
        # leave join mode the same way a real user would today: navigate
        # back to the plain URL. Team sync survives it (localStorage).
        a.goto(INDEX_URL, wait_until="domcontentloaded")
        a.wait_for_timeout(500)

        b.click('.reveal-btn[data-reveal="live"]')
        b.wait_for_timeout(400)
        b.click("#finishSessionBtn")
        b.wait_for_timeout(150)
        b.click("#confirmOk")
        b.wait_for_timeout(500)
        b.click('.squad-pick-btn[data-id="squad-2"]')
        b.wait_for_timeout(150)
        b_squad2_release = cell_color(b, "squad-2", "release")
        print("device B (facilitator), squad-2/release:", b_squad2_release)
        assert b_squad2_release in ("good", "warn", "crit")

        print("=== does device A see squad-2's finished result LIVE too (no second reload)? ===")
        a.click('.view-btn[data-view="squad"]')
        a.wait_for_timeout(200)
        a.click('.squad-pick-btn[data-id="squad-2"]')
        a.wait_for_timeout(600)
        a_squad2_release = cell_color(a, "squad-2", "release")
        print("device A, squad-2/release (no reload):", a_squad2_release)
        assert a_squad2_release == b_squad2_release

        print("=== the divergence from the original bug report is gone: BOTH devices show BOTH squads ===")
        a.click('.squad-pick-btn[data-id="squad-1"]')
        a.wait_for_timeout(150)
        assert cell_color(a, "squad-1", "release") == a_squad1_release, "device A still has its own squad-1 result"
        b.click('.squad-pick-btn[data-id="squad-1"]')
        b.wait_for_timeout(150)
        assert cell_color(b, "squad-1", "release") == a_squad1_release, "device B ALSO has squad-1's result (this is the fix)"
        a.click('.squad-pick-btn[data-id="squad-2"]')
        a.wait_for_timeout(150)
        assert cell_color(a, "squad-2", "release") == b_squad2_release, "device A ALSO has squad-2's result (this is the fix)"

        print("=== RAINY DAY: a third device, never opened A/B's team link, is unaffected by any of this ===")
        c_ctx = browser.new_context(viewport={"width": 420, "height": 900})
        c_ctx.add_init_script(point_at_test_relay)
        c = c_ctx.new_page()
        c_errors = []
        c.on("pageerror", lambda e: c_errors.append(str(e)))
        c.goto(INDEX_URL, wait_until="domcontentloaded")  # plain URL, NOT the team link
        c.wait_for_timeout(400)
        c.click('.view-btn[data-view="admin"]')
        c.wait_for_timeout(100)
        # Step 7: default-on means device C isn't "not connected" any more --
        # it auto-generated its OWN random team secret at boot, same as A and
        # B did. The real rainy-day invariant is that C's team link is its
        # OWN, distinct from A/B's -- proving it's a genuinely separate team,
        # not somehow onto the same one -- so it never sees A/B's board.
        c_link = c.eval_on_selector("#teamLinkInput", "el=>el.value")
        print("device C's own (different) team link:", c_link)
        assert c_link and c_link != team_link
        c.click('.view-btn[data-view="squad"]')
        c.wait_for_timeout(150)
        c.click('.squad-pick-btn[data-id="squad-1"]')
        c.wait_for_timeout(150)
        c_squad1_release = cell_color(c, "squad-1", "release")
        print("device C (never team-synced), squad-1/release:", c_squad1_release)
        assert c_squad1_release == "unscored", "a device that never connected to the team link must not receive board-wide updates from it"

        print("=== ALL ERRORS: a=", a_errors, "b=", b_errors, "c=", c_errors)
        assert a_errors == [] and b_errors == [] and c_errors == []
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
