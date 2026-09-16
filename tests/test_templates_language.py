from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 9 (see STATUS.md's backlog table): the
# Templates modal's own chrome (title, hint, "Starter templates"/"Your
# templates" headings, Load/Delete buttons and confirm dialogs, the
# save-as-template row, Close) -- everything EXCEPT the template NAMES
# themselves and the starter templates' own dimension content (Stories
# 5/7/8's job), which stay English/whatever-the-admin-typed by design: a
# template's own name and a saved-template's dimension text are the
# admin's own content, not app chrome, same principle Story 5 established
# for a manually customized dimension.

out_path = build_page(out_name="_test_templates_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    # setView()/setLocale() are both synchronous (established across this
    # pass) -- no wait needed for either of these two clicks.
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')

    print("=== Templates modal chrome is Hebrew, template NAMES and dimension content stay as-is ===")
    page.click('#templatesBtn')
    # eval_on_selector()/click() below don't auto-wait for a not-yet-
    # attached element -- wait for the real "templates list rendered"
    # signal instead of guessing.
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    assert page.eval_on_selector('#templatesBackdrop', 'el=>el.getAttribute("dir")') == "rtl"

    title_he = page.eval_on_selector('#templatesBackdrop h3', 'el=>el.textContent')
    hint_he = page.eval_on_selector('#templatesBackdrop > .modal > .hint', 'el=>el.textContent')
    print("title / hint (Hebrew):", title_he, "|", hint_he)
    assert title_he != "Survey templates" and title_he.strip()
    assert hint_he.strip() and "reuse it later" not in hint_he

    headings_he = page.eval_on_selector_all('#tplList .field-label', 'els=>els.map(e=>e.textContent)')
    print("starter/own headings (Hebrew):", headings_he)
    assert "Starter templates" not in headings_he and "Your templates" not in headings_he
    assert all(h.strip() for h in headings_he)

    load_btn_he = page.eval_on_selector('#tplList .tpl-row[data-id="starter-spotify"] [data-action="load"]', 'el=>el.textContent')
    print("Load button (Hebrew):", load_btn_he)
    assert load_btn_he != "Load" and load_btn_he.strip()

    meta_he = page.eval_on_selector('#tplList .tpl-row[data-id="starter-spotify"] .tmeta', 'el=>el.textContent')
    name_he = page.eval_on_selector('#tplList .tpl-row[data-id="starter-spotify"] .tname', 'el=>el.textContent')
    print("Spotify row meta (Hebrew) / name (stays English, admin content):", meta_he, "|", name_he)
    assert "dimension" not in meta_he and meta_he.strip()
    assert name_he == "Spotify Squad Health Check"

    delete_title_he = page.eval_on_selector('#tplNameInput', 'el=>el.placeholder')
    print("save-name placeholder (Hebrew):", delete_title_he)
    assert delete_title_he.strip() and "checklist" not in delete_title_he

    save_btn_he = page.eval_on_selector('#tplSaveBtn', 'el=>el.textContent')
    close_btn_he = page.eval_on_selector('#tplCloseBtn', 'el=>el.textContent')
    print("save/close buttons (Hebrew):", save_btn_he, "|", close_btn_he)
    assert save_btn_he != "Save current as template" and save_btn_he.strip()
    assert close_btn_he != "Close" and close_btn_he.strip()

    print("=== Load confirm dialog is Hebrew, template name embedded as-is ===")
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    confirm_title_he = page.eval_on_selector('#confirmTitle', 'el=>el.textContent')
    confirm_msg_he = page.eval_on_selector('#confirmMessage', 'el=>el.textContent')
    confirm_btn_he = page.eval_on_selector('#confirmOk', 'el=>el.textContent')
    print("load confirm (Hebrew):", confirm_title_he, "|", confirm_msg_he, "|", confirm_btn_he)
    assert "The Five Dysfunctions of a Team" in confirm_title_he
    assert confirm_title_he.strip() and "Load" not in confirm_title_he.split("The Five")[0]
    assert confirm_msg_he.strip() and "Ratings tied to" not in confirm_msg_he
    assert confirm_btn_he != "Load template" and confirm_btn_he.strip()
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "Five
    # Dysfunctions' dimensions landed" signal (loadTemplate()'s own Promise
    # chain) instead of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/trust'] !== undefined")
    print("errors after confirming load:", errors)

    print("=== Delete confirm dialog is Hebrew too (own saved template) ===")
    page.click('#templatesBtn')
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    page.fill('#tplNameInput', 'My Own Template')
    page.click('#tplSaveBtn')
    # eval_on_selector()/query_selector() below don't auto-wait --
    # saveCurrentAsTemplate()'s live branch writes via the fake store's
    # add(), which mutates STORE and calls notify() synchronously -- the
    # long-lived "templates" listener (db.js) re-renders the list in that
    # same synchronous call since the modal is open -- but poll for the
    # real new row landing rather than assume that timing.
    page.wait_for_function("() => Array.from(document.querySelectorAll('#tplList .tname')).some(el => el.textContent === 'My Own Template')")
    own_row = page.query_selector('#tplList .tpl-row[data-id]:has(.tname:text("My Own Template"))') \
        or next(r for r in page.query_selector_all('#tplList .tpl-row') if r.eval_on_selector('.tname', 'el=>el.textContent') == 'My Own Template')
    own_row.query_selector('[data-action="delete"]').click()
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    del_title_he = page.eval_on_selector('#confirmTitle', 'el=>el.textContent')
    del_msg_he = page.eval_on_selector('#confirmMessage', 'el=>el.textContent')
    del_btn_he = page.eval_on_selector('#confirmOk', 'el=>el.textContent')
    print("delete confirm (Hebrew):", del_title_he, "|", del_msg_he, "|", del_btn_he)
    assert "My Own Template" in del_title_he
    assert del_msg_he.strip() and "won't affect" not in del_msg_he
    assert del_btn_he != "Delete" and del_btn_he.strip()
    page.click('#confirmCancel')  # don't actually delete

    print("=== switching back to English restores every string above ===")
    # closeTemplates()/closeConfirm()/setLocale() are all synchronous
    # (established across this pass) -- no wait needed for either click.
    page.click('#tplCloseBtn')
    page.click('.lang-btn[data-lang="en"]')
    page.click('#templatesBtn')
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    assert page.eval_on_selector('#templatesBackdrop h3', 'el=>el.textContent') == "Survey templates"
    assert page.eval_on_selector('#tplSaveBtn', 'el=>el.textContent') == "Save current as template"
    assert page.eval_on_selector('#templatesBackdrop', 'el=>el.getAttribute("dir")') != "rtl"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_templates_language.png")), full_page=True)
    browser.close()
    print("=== ALL TEMPLATES LANGUAGE CHECKS PASSED ===")
