from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 12 (see STATUS.md's backlog table): the Edit
# Dimensions modal (Admin) -- title/hint, the per-row move/remove controls,
# the name input, the Green/Red looks-like labels + placeholders, the
# statement-count hint, Add/Done, the empty-state hint, and the remove
# confirm dialog. Dimension content itself (the name typed into the input,
# and its green/red text) stays untranslated by design -- same principle
# Stories 9/10/11 applied to template/session content and Story 4 already
# applied to a freshly-added squad's default name.

out_path = build_page(out_name="_test_dim_manager_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 900, "height": 1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    print("=== Edit Dimensions modal chrome is Hebrew ===")
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('#dimBackdrop', 'el=>el.getAttribute("dir")') == "rtl"
    title_he = page.eval_on_selector('#dimBackdrop h3', 'el=>el.textContent')
    hint_he = page.eval_on_selector('#dimBackdrop > .modal > .hint', 'el=>el.textContent')
    print(title_he, "|", hint_he)
    assert title_he != "Edit dimensions" and title_he.strip()
    assert hint_he.strip() and "everyone viewing" not in hint_he

    print("=== per-row controls are Hebrew, dimension NAME/content stays as-is ===")
    row = page.query_selector('.dim-row[data-key="release"]')
    up_title_he = row.query_selector('.dim-up').get_attribute('title')
    down_title_he = row.query_selector('.dim-down').get_attribute('title')
    del_title_he = row.query_selector('.dim-del').get_attribute('title')
    print("move/remove titles (Hebrew):", up_title_he, "|", down_title_he, "|", del_title_he)
    assert up_title_he != "Move up" and up_title_he.strip()
    assert down_title_he != "Move down" and down_title_he.strip()
    assert del_title_he != "Remove dimension" and del_title_he.strip()

    name_input = row.query_selector('input.dim-label')
    name_aria_he = name_input.get_attribute('aria-label')
    name_placeholder_he = name_input.get_attribute('placeholder')
    name_value = name_input.get_attribute('value')
    print("name aria-label / placeholder (Hebrew) / value (stays English):", name_aria_he, "|", name_placeholder_he, "|", name_value)
    assert name_aria_he != "Dimension name" and name_aria_he.strip()
    assert name_placeholder_he != "Dimension name" and name_placeholder_he.strip()
    assert name_value == "Easy to release"

    green_label_he = row.query_selector('label.grn').text_content()
    red_label_he = row.query_selector('label.rd').text_content()
    green_ph_he = row.query_selector('textarea[data-field="green"]').get_attribute('placeholder')
    red_ph_he = row.query_selector('textarea[data-field="red"]').get_attribute('placeholder')
    print("green/red labels (Hebrew):", green_label_he, "|", red_label_he)
    print("green/red placeholders (Hebrew):", green_ph_he, "|", red_ph_he)
    assert green_label_he != "Green looks like" and green_label_he.strip()
    assert red_label_he != "Red looks like" and red_label_he.strip()
    assert green_ph_he != "What healthy looks like" and green_ph_he.strip()
    assert red_ph_he != "What unhealthy looks like" and red_ph_he.strip()

    add_btn_he = page.eval_on_selector('#addDimBtn', 'el=>el.textContent')
    done_btn_he = page.eval_on_selector('#dimDoneBtn', 'el=>el.textContent')
    print("Add/Done buttons (Hebrew):", add_btn_he, "|", done_btn_he)
    assert add_btn_he != "+ Add dimension" and add_btn_he.strip()
    assert done_btn_he != "Done" and done_btn_he.strip()

    print("=== remove confirm dialog is Hebrew, dimension name embedded as-is ===")
    row.query_selector('.dim-del').click()
    page.wait_for_timeout(150)
    confirm_title_he = page.eval_on_selector('#confirmTitle', 'el=>el.textContent')
    confirm_msg_he = page.eval_on_selector('#confirmMessage', 'el=>el.textContent')
    confirm_btn_he = page.eval_on_selector('#confirmOk', 'el=>el.textContent')
    print("remove confirm (Hebrew):", confirm_title_he, "|", confirm_msg_he, "|", confirm_btn_he)
    assert confirm_title_he != "Remove dimension?" and confirm_title_he.strip()
    assert "Easy to release" in confirm_msg_he and "hidden (not deleted)" not in confirm_msg_he
    assert confirm_btn_he != "Remove" and confirm_btn_he.strip()
    page.click('#confirmCancel')  # don't actually remove
    page.wait_for_timeout(100)

    print("=== statement-scored dimension shows a Hebrew hint with the count interpolated ===")
    page.click('#dimDoneBtn')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(300)
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)
    stmt_count = page.evaluate("dimByKey('trust').statements.length")
    stmt_hint_he = page.eval_on_selector('.dim-row[data-key="trust"] .hint', 'el=>el.textContent')
    print("statement-count hint (Hebrew, expecting count", stmt_count, "):", stmt_hint_he)
    assert stmt_hint_he.strip() and "self-assessment statements" not in stmt_hint_he
    assert str(stmt_count) in stmt_hint_he

    print("=== switching back to English restores every string above ===")
    page.click('#dimDoneBtn')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('#dimBackdrop h3', 'el=>el.textContent') == "Edit dimensions"
    assert page.eval_on_selector('#addDimBtn', 'el=>el.textContent') == "+ Add dimension"
    assert page.eval_on_selector('#dimBackdrop', 'el=>el.getAttribute("dir")') != "rtl"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_dim_manager_language.png")), full_page=True)
    browser.close()
    print("=== ALL DIM MANAGER LANGUAGE CHECKS PASSED ===")
