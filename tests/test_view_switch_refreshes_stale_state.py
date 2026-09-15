from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page

# Real bug report: a facilitator clicked "Start retro session", then
# switched to Admin to check the Diagnostics log while the relay connected
# (a real few-second wait -- e.g. a Render free-tier relay waking from
# sleep). The session actually started successfully (confirmed in their own
# diag log: "Started retro session ... Sessions snapshot #4: 1 doc(s)"),
# but Squad view still showed the button stuck disabled as "Starting..."
# after switching back.
#
# Root cause: every db snapshot listener gates its own re-render on
# state.ui.view === "<that view>" (see db.js) -- a snapshot that arrives
# while a view is hidden updates `state` correctly but never touches that
# view's DOM, since nothing was watching. setView() (app.js) used to only
# toggle `hidden` attributes, so switching back just un-hid whatever HTML
# was already there from before -- stale. Fixed by having setView() call
# renderAll() on every switch, so returning to a view always reflects
# current state instead of whatever was last rendered while it was visible.

out_path = build_page(out_name="_test_view_switch_refresh.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280, "height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== start a session, then navigate away BEFORE the snapshot updates the DOM ===")
    # setView() (app.js) and selectSquad() (squads.js) are both synchronous
    # (established across this pass) -- no wait needed for either click.
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    assert page.query_selector('#startSessionBtn') is not None

    # Simulate the real timing: the write is in flight, the button already
    # reads "Starting...", and the facilitator switches away before the
    # session doc's snapshot ever reaches Squad view.
    page.evaluate("""
      () => {
        var btn = document.getElementById('startSessionBtn');
        btn.disabled = true;
        btn.textContent = 'Starting…';
      }
    """)
    page.click('.view-btn[data-view="admin"]')
    print("now on Admin, Squad view is hidden but still shows the disabled button underneath")

    print("=== the session doc lands while Squad view is hidden ===")
    # window.__NOTIFY__() below calls the fake store's notify() SYNCHRONOUSLY
    # (unlike a real onSnapshot's first delivery, which the fixture delays),
    # which synchronously updates state.sessions via the long-lived sessions
    # listener (db.js) -- but that listener only re-renders Squad view when
    # it's the active view (the exact bug this test exists to catch), so
    # nothing here needs a wait either way.
    page.evaluate("""
      () => {
        window.__FAKE_STORE__['sessions/ABC123'] = {
          squadId: 'squad-1', squadName: 'Squad 1', templateName: 'Spotify Squad Health Check',
          dimensions: [{key:'release', label:'Easy to release', green:'g', red:'r', order:1}],
          status: 'open', revealMode: 'hold', overrides: {}, experimentNote: '', createdAt: new Date().toISOString()
        };
        window.__NOTIFY__('sessions');
      }
    """)

    print("=== switching back to Squad view must show the real, current state ===")
    page.click('.view-btn[data-view="squad"]')
    start_btn = page.query_selector('#startSessionBtn')
    close_btn = page.query_selector('#closeSessionBtn')
    print("startSessionBtn present (should be None -- a session is open):", start_btn)
    print("closeSessionBtn present (should exist -- the in-progress card):", close_btn is not None)
    assert start_btn is None, "returning to Squad view still showed the stale disabled button instead of the session that actually started"
    assert close_btn is not None
    session_code_shown = page.eval_on_selector('.session-code', 'el => el.textContent')
    print("session code shown on card:", session_code_shown)
    assert session_code_shown == "ABC123"
    print("errors:", errors)

    print("=== ALL VIEW-SWITCH REFRESH TESTS PASSED ===")
    browser.close()
