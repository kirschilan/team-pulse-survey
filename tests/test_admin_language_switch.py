from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 1 of the multi-language roadmap (see STATUS.md): the Admin panel's
# language switcher, persisted to localStorage, English-fallback for any gap,
# and scoped RTL/lang attributes on #viewAdmin only. Story 4 later added
# Tribe view, Squad view, and the rating modal as their own i18n-supported
# screens with their own dir/lang scoping -- see test_main_screen_language.py
# -- but every OTHER modal, and the retro flow, are still untranslated,
# so this test also proves the switch does NOT leak into them.

out_path = build_page(out_name="_test_admin_lang_switch.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(150)

    print("=== defaults to English on first load ===")
    heading = page.eval_on_selector('.card h2[data-i18n="admin.boardSetup.heading"]', 'el => el.textContent')
    print("board setup heading:", heading)
    assert heading == "Board setup"
    add_btn_text = page.eval_on_selector('#addSquadBtn', 'el => el.textContent')
    print("add-squad button:", repr(add_btn_text))
    # t()'s {unit}/{unitPlural} substitutions are wrapped in U+2066/U+2069
    # bidi isolate marks (see i18n.js) so an untranslated word embedded in a
    # future RTL sentence can't scramble that sentence's word order -- see
    # STATUS.md's Story 4 entry. Invisible and harmless in English too, but
    # present in .textContent, so assertions strip them rather than
    # asserting exact equality against plain ASCII.
    assert add_btn_text.replace("⁦", "").replace("⁩", "") == "+ Add squad"
    print("English lang button starts active:", page.eval_on_selector('.lang-btn[data-lang="en"]', 'el => el.classList.contains("active")'))
    assert page.eval_on_selector('.lang-btn[data-lang="en"]', 'el => el.classList.contains("active")')

    # ---- switch to Hebrew ----
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(200)

    print("=== switched to Hebrew ===")
    heading_he = page.eval_on_selector('.card h2[data-i18n="admin.boardSetup.heading"]', 'el => el.textContent')
    print("board setup heading:", heading_he)
    assert heading_he == "הגדרות לוח"

    add_btn_he = page.eval_on_selector('#addSquadBtn', 'el => el.textContent')
    print("add-squad button (interpolated {unit}):", add_btn_he)
    assert "squad" in add_btn_he and add_btn_he != add_btn_text, "expected the Hebrew template with the English unit name interpolated in"

    placeholder_he = page.eval_on_selector('#teamJoinInput', 'el => el.placeholder')
    print("team-join placeholder:", placeholder_he)
    assert placeholder_he != "Paste a team link" and placeholder_he

    status_he = page.eval_on_selector('#teamSyncStatus', 'el => el.textContent')
    print("team sync connected status (board-sync.js, not static markup):", status_he)
    assert status_he and "Connected" not in status_he

    print("Hebrew lang button now active:", page.eval_on_selector('.lang-btn[data-lang="he"]', 'el => el.classList.contains("active")'))
    assert page.eval_on_selector('.lang-btn[data-lang="he"]', 'el => el.classList.contains("active")')
    assert not page.eval_on_selector('.lang-btn[data-lang="en"]', 'el => el.classList.contains("active")')

    print("=== #viewAdmin flips to rtl, scoped -- rest of the app stays ltr ===")
    admin_dir = page.eval_on_selector('#viewAdmin', 'el => el.getAttribute("dir")')
    print("viewAdmin dir:", admin_dir)
    assert admin_dir == "rtl"
    html_dir = page.eval_on_selector('html', 'el => el.getAttribute("dir")')
    print("document root dir (should be untouched):", html_dir)
    assert html_dir != "rtl"

    # ---- squads.js dynamic admin strings: aria-label, remove title, confirm dialog ----
    aria = page.eval_on_selector('.admin-squad-name', 'el => el.getAttribute("aria-label")')
    print("squad name input aria-label:", aria)
    assert "squad" in aria and aria != "squad name"

    del_title = page.eval_on_selector('.admin-squad-del', 'el => el.getAttribute("title")')
    print("delete button title:", del_title)
    assert "squad" in del_title and del_title != "Remove squad"

    page.click('.admin-squad-del')
    page.wait_for_timeout(150)
    confirm_title = page.eval_on_selector('#confirmTitle', 'el => el.textContent')
    confirm_msg = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    confirm_btn = page.eval_on_selector('#confirmOk', 'el => el.textContent')
    print("confirm dialog:", confirm_title, "|", confirm_msg, "|", confirm_btn)
    assert confirm_title != "Remove squad?"
    assert "squad" in confirm_title
    page.click('#confirmCancel')  # don't actually delete -- just checking the strings
    page.wait_for_timeout(100)

    print("=== rest of the app is untouched by the Admin-only switch ===")
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    tribe_heading = page.eval_on_selector('h1', 'el => el.textContent')
    print("Tribe view h1 (should still be English):", tribe_heading)
    assert tribe_heading == "Squad Pulse"
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(150)

    # ---- persists across reload ----
    page.reload()
    page.wait_for_timeout(400)
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(150)
    heading_after_reload = page.eval_on_selector('.card h2[data-i18n="admin.boardSetup.heading"]', 'el => el.textContent')
    print("=== Hebrew persists across reload ===")
    print("heading after reload:", heading_after_reload)
    assert heading_after_reload == heading_he
    lang_stored = page.evaluate("localStorage.getItem('squadpulse:lang')")
    print("localStorage squadpulse:lang:", lang_stored)
    assert lang_stored == "he"

    # ---- switch back to English ----
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(200)
    heading_back = page.eval_on_selector('.card h2[data-i18n="admin.boardSetup.heading"]', 'el => el.textContent')
    print("=== switched back to English ===")
    print("heading:", heading_back)
    assert heading_back == "Board setup"
    assert page.eval_on_selector('#viewAdmin', 'el => el.getAttribute("dir")') == "ltr"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_admin_lang_switch.png")), full_page=True)
    browser.close()
    print("=== ALL ADMIN LANGUAGE SWITCH CHECKS PASSED ===")
