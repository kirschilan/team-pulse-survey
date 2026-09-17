from playwright.sync_api import sync_playwright
import pathlib, json, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# RETRO-1 (STATUS.md's "Facilitated retro backlog"): a squad's most
# recently finished retro (finishedAt, the sprint experiment note, and each
# dimension's result INCLUDING whether it was overridden -- see
# finishRetroAndApply(), retro-facilitator.js) now round-trips through the
# JSON board export/import format, not just the resulting ratings.
#
# The actual "finishing a retro writes lastRetro to the squad" wiring is
# proven in tests/test_retro_experiment_note_and_finish.py (extended for
# this backlog item) -- seeding it directly here via the fake store keeps
# THIS file focused on what's actually new: buildBoardExport()/
# buildSquadImportPlan()/applySquadImportPlan()'s own handling of the field,
# end to end through a real export click and a real import+apply.

out_path = build_page(out_name="_test_json_last_retro_round_trip.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== seed squad-1 with a lastRetro that references one REAL dimension (release) and one that no longer exists (ghost-dim) ===")
    page.evaluate("""() => {
      var sq = window.__FAKE_STORE__['squads/squad-1'];
      sq.lastRetro = {
        finishedAt: "2026-09-17T10:00:00.000Z",
        experimentNote: "Pair on the riskiest story every sprint",
        dimensions: {
          release: { color: "warn", trend: "down", overridden: true },
          "ghost-dim": { color: "crit", trend: "flat", overridden: false }
        }
      };
      window.__NOTIFY__("squads");
    }""")
    page.wait_for_function("() => state.squads.filter(s => s.id === 'squad-1')[0].lastRetro !== undefined")

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_selector('#exportJsonBtn', state="visible")

    print("=== export: the JSON carries lastRetro for squad-1, verbatim ===")
    with page.expect_popup() as popup_info:
        page.click('#exportJsonBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    json_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    exported = json.loads(json_text)
    squad1_export = [s for s in exported["squads"] if s["name"] == "Squad 1"][0]
    print("exported squad-1 lastRetro:", squad1_export.get("lastRetro"))
    assert squad1_export["lastRetro"]["experimentNote"] == "Pair on the riskiest story every sprint"
    assert squad1_export["lastRetro"]["dimensions"]["release"] == {"color": "warn", "trend": "down", "overridden": True}
    assert "ghost-dim" in squad1_export["lastRetro"]["dimensions"], "the export must carry the file verbatim -- validation/matching happens on IMPORT, not export"
    # the board's own dimensions section must NOT contain ghost-dim -- it was
    # never a real dimension, only ever a stray key inside this squad's
    # lastRetro (simulating "a dimension got deleted after this retro
    # finished, before exporting")
    assert not any(d.get("key") == "ghost-dim" for d in exported["dimensions"])

    print("=== re-import that same file: preview shows the last-retro chip and reports the missing dimension ===")
    import_path = test_output_path("last_retro_reimport.json")
    import_path.write_text(json.dumps(exported))
    page.click('#importJsonBtn')
    page.set_input_files('#jsonFileInput', str(import_path))
    page.wait_for_selector('#importJsonBackdrop:not([hidden])')

    chips_text = page.eval_on_selector('#importJsonBody', 'el => el.textContent')
    assert "last retro" in chips_text.lower(), "the preview must surface that this file includes a saved retro result, not just apply it silently"
    skip_rows = page.eval_on_selector_all('.import-skips .srow', 'els => els.map(e => e.textContent)')
    print("skipped rows:", skip_rows)
    assert any("ghost-dim" in row for row in skip_rows), "a lastRetro dimension no longer on the board must be REPORTED, not silently dropped or misapplied"

    print("=== apply: squad-1's real backend doc gets the resolved lastRetro (ghost-dim excluded, release kept) ===")
    page.click('#importJsonApplyBtn')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")
    applied = page.evaluate("window.__FAKE_STORE__['squads/squad-1'].lastRetro")
    print("squad-1 lastRetro after re-import:", applied)
    assert applied["experimentNote"] == "Pair on the riskiest story every sprint"
    assert applied["dimensions"]["release"] == {"color": "warn", "trend": "down", "overridden": True}
    assert "ghost-dim" not in applied["dimensions"], "a dimension that no longer exists must not silently persist forever"

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
