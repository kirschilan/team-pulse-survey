from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Real bug report: loadTemplate() (templates.js) rewrites the board's shared
# dimension set and meta/config -- board-wide, not scoped to any one squad,
# since Templates is opened from Admin with no "current squad" context --
# with no check at all for whether any squad has a retro IN PROGRESS.
#
# given a retro is in process
# when loading a template
# then 1) a confirmation pop-up appears that the current retro session will
#         be closed without saving
#      2) if confirmed, close the current retro without saving; if
#         declined, the template is not loaded
#
# actual (before the fix): the new template loaded silently and the retro
# stayed open, now running against dimensions the active template no longer
# matches -- confusing for a facilitator with no warning it happened.

out_path = build_page(out_name="_test_tpl_load_open_retro.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))

    print("=== start a retro session on squad-1 (no pacing) ===")
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#startSessionBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/')).length === 1")
    session_id = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/'))[0].split('/')[1]")
    print("session started:", session_id)
    assert page.evaluate("window.__FAKE_STORE__['sessions/%s'].status" % session_id) == "open"

    print("=== a template's Load button warns that the in-progress retro will be closed without saving ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    page.eval_on_selector('#tplList .tpl-row [data-action="load"]', 'el => el.click()')
    page.wait_for_selector('#confirmBackdrop:not([hidden])', state="attached")
    confirm_message = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message:", confirm_message)
    assert "Squad 1" in confirm_message, "the warning should name the squad whose retro is in progress"

    print("=== DECLINED: cancel leaves the session open and does not load the template ===")
    dims_before = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('dimensions/')).sort()")
    page.click('#confirmCancel')
    assert page.evaluate("window.__FAKE_STORE__['sessions/%s'].status" % session_id) == "open", \
        "declining the confirmation must leave the in-progress retro open"
    dims_after_cancel = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('dimensions/')).sort()")
    assert dims_after_cancel == dims_before, "declining the confirmation must not load the template"

    print("=== CONFIRMED: loading closes the retro without saving, then loads the template ===")
    page.eval_on_selector('#tplList .tpl-row [data-action="load"]', 'el => el.click()')
    page.wait_for_selector('#confirmBackdrop:not([hidden])', state="attached")
    page.click('#confirmOk')
    page.wait_for_function(
        "() => window.__FAKE_STORE__['sessions/%s'].status === 'closed'" % session_id
    )
    session_after = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % session_id)
    print("session after confirm:", session_after)
    assert session_after["status"] == "closed", "confirming must close the in-progress retro"
    assert "revealMode" not in session_after or session_after.get("revealMode") == "hold", \
        "closing without saving must not run finish-and-apply consolidation"

    print("errors:", errors)
    assert errors == []
    page.screenshot(path=str(test_output_path("shot_template_load_closes_open_retro.png")), full_page=True)
    browser.close()
