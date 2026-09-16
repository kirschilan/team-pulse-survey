from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page

# Story 13 (STATUS.md's multi-language rollout backlog -- the "design pass"
# it names, item 1): a full-board JSON export. Proves the button exists and
# is i18n-wired (English + Hebrew, same convention as every other Admin
# panel control -- see test_admin_language_switch.py), and that a real click
# produces real, parseable JSON with the shape board-export-import.js's
# buildBoardExport() is unit-tested against (tests/unit/test_json_export.js
# covers that shape in detail; this only proves the UI is wired to it).

out_path = build_page(out_name="_test_json_export.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # real boot-complete marker (same one test_main_screen_language.py and
    # test_hebrew_rtl_coverage.py use), not a guessed sleep -- Admin's squad
    # list only populates once the async store load + first render() lands.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_selector('#exportJsonBtn', state="visible")

    print("=== English label ===")
    label = page.eval_on_selector('#exportJsonBtn [data-i18n="admin.boardSetup.exportJson"]', 'el => el.textContent')
    print("export-json button label:", label)
    assert label == "Export JSON (beta)"

    print("=== click produces real, parseable JSON ===")
    with page.expect_popup() as popup_info:
        page.click('#exportJsonBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    json_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    print(json_text[:400] + ("..." if len(json_text) > 400 else ""))

    import json as jsonlib
    data = jsonlib.loads(json_text)
    assert data["formatVersion"] == 1
    assert "exportedAt" in data
    assert "sessions" not in data, "sessions are ephemeral -- must never be in a board export"
    assert isinstance(data["dimensions"], list) and len(data["dimensions"]) > 0
    assert isinstance(data["squads"], list) and len(data["squads"]) > 0
    assert isinstance(data["templates"], list)
    squad_names = [s["name"] for s in data["squads"]]
    assert "id" not in data["squads"][0], "squad ids are storage artifacts, not a portable identity -- deliberately excluded"
    print("squad names:", squad_names)
    print("first dimension:", data["dimensions"][0])

    print("=== Hebrew label ===")
    page.click('.lang-btn[data-lang="he"]')
    label_he = page.eval_on_selector('#exportJsonBtn [data-i18n="admin.boardSetup.exportJson"]', 'el => el.textContent')
    print("export-json button label (he):", label_he)
    assert label_he == "ייצוא JSON (בטא)"

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
