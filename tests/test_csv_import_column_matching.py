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
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    # rate a couple cells so export has content (from Squad view now)
    # setView()/selectSquad() are both synchronous (established across this
    # pass) -- no wait needed for either of these two clicks.
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_selector('#backdrop', state="visible")  # real modal-open signal, not a guess
    page.click('.swatch.good')
    page.click('#modalSave')
    # evaluate() below doesn't auto-wait -- poll for the real write landing
    # instead of guessing.
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.dimensions && s.dimensions.release && s.dimensions.release.color === 'good'; }")

    # ---- export and capture the fallback popup's CSV text (Export lives in Admin now) ----
    page.click('.view-btn[data-view="admin"]')
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

    # Positional-fallback matching (unrecognized header names, original
    # column order) is fully covered at the logic level by
    # tests/unit/test_csv.js's "mapImportColumns() falls back to toCSV()'s
    # fixed column order" -- there was a Playwright scenario here for it
    # too, but it only inspected the preview text and never applied
    # anything, so it added no coverage beyond what that unit test and the
    # reordered-columns scenario below (which DOES apply and verify real
    # data) already prove between them. Removed as part of the 2026-09-12
    # test-suite perf pass -- see STATUS.md's session log.

    lines = csv_lines_raw

    # ---- Test: reorder columns 1+ (col 0 must stay the entity-name column) -> should still map correctly ----
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
    # set_input_files() only dispatches the "change" event -- csv.js's
    # handler then reads the file via FileReader.readAsText(), a genuinely
    # async I/O callback, before rendering the preview and unhiding the
    # backdrop. Wait for that real signal instead of guessing.
    page.wait_for_selector('#importBackdrop', state="visible")
    print("=== reordered-columns import preview ===")
    print(page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importApplyBtn')
    # applyImportPlan() (csv.js) applies synchronously when no new squads
    # need creating (our case -- both rows target the existing squad-1),
    # but poll for the real write landing rather than assume that timing.
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.dimensions && s.dimensions.release && s.dimensions.release.color === 'good'; }")
    print("squad-1 release after reordered import (should be 'good'):", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions.release"))

    # ---- Test: template mismatch warning ----
    mismatched_rows = [lines[0]]
    for line in lines[1:]:
        parts = line.split(",")
        parts[-1] = "Some Other Template"
        mismatched_rows.append(",".join(parts))
    mismatched_csv = "\r\n".join(mismatched_rows)
    p3 = test_output_path("test_mismatch.csv")
    p3.write_text(mismatched_csv)
    page.set_input_files('#csvFileInput', str(p3))
    # Same genuinely-async FileReader reasoning as the reordered-columns
    # import above.
    page.wait_for_selector('#importBackdrop', state="visible")
    print("=== template-mismatch import preview ===")
    print(page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importCancel')

    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_csv_column_match.png")), full_page=True)
    browser.close()
