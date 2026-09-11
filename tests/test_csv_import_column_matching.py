from playwright.sync_api import sync_playwright
import pathlib, re
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_csv_column_match.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # rate a couple cells so export has content (from Squad view now)
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(120)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(100)
    page.click('.swatch.good'); page.click('#modalSave'); page.wait_for_timeout(150)

    # ---- export and capture the fallback popup's CSV text (Export lives in Admin now) ----
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    with page.expect_popup() as popup_info:
        page.click('#exportBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    csv_text = popup.eval_on_selector('pre', 'el => el.textContent')
    print("=== exported CSV ===")
    print(csv_text)
    popup.close()

    csv_lines_raw = csv_text.strip().splitlines()
    header = csv_lines_raw[0].split(",")
    print("header columns:", header)
    assert "Template" in header, "Template column missing from export!"
    print("errors:", errors)

    # ---- Test 1: rename headers, keep column order -> should still import via positional fallback ----
    lines = csv_lines_raw
    renamed_header = "Team Name,Dim,Colour,Direction,Comment,SourceTemplate"
    renamed_csv = renamed_header + "\r\n" + "\r\n".join(lines[1:])
    p1 = test_output_path("test_renamed_headers.csv")
    p1.write_text(renamed_csv)
    page.set_input_files('#csvFileInput', str(p1))
    page.wait_for_timeout(250)
    print("=== renamed-headers import preview ===")
    print(page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importCancel')

    # ---- Test 2: reorder columns 1+ (col 0 must stay the entity-name column) -> should still map correctly ----
    # original data columns: Squad, Dimension, Health, Trend, Note, Template
    reordered_rows = []
    reordered_rows.append("Squad,Template,Health,Dimension,Note,Trend")
    for line in lines[1:]:
        # naive CSV split (no embedded commas/quotes in our test data)
        parts = line.split(",")
        squad, dim, health, trend, note, template = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]
        reordered_rows.append(",".join([squad, template, health, dim, note, trend]))
    reordered_csv = "\r\n".join(reordered_rows)
    p2 = test_output_path("test_reordered.csv")
    p2.write_text(reordered_csv)
    page.set_input_files('#csvFileInput', str(p2))
    page.wait_for_timeout(250)
    print("=== reordered-columns import preview ===")
    print(page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importApplyBtn')
    page.wait_for_timeout(200)
    print("squad-1 release after reordered import (should be 'good'):", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions.release"))

    # ---- Test 3: template mismatch warning ----
    mismatched_rows = [lines[0]]
    for line in lines[1:]:
        parts = line.split(",")
        parts[-1] = "Some Other Template"
        mismatched_rows.append(",".join(parts))
    mismatched_csv = "\r\n".join(mismatched_rows)
    p3 = test_output_path("test_mismatch.csv")
    p3.write_text(mismatched_csv)
    page.set_input_files('#csvFileInput', str(p3))
    page.wait_for_timeout(250)
    print("=== template-mismatch import preview ===")
    print(page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importCancel')

    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_csv_column_match.png")), full_page=True)
    browser.close()
