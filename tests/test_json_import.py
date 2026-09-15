from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# t(key, vars) wraps every interpolated value in Unicode bidi isolate marks
# (U+2066 LRI / U+2069 PDI, see i18n.js) so it can't scramble a surrounding
# RTL sentence's word order -- invisible and harmless, but present in
# .textContent, so strip before comparing (see test_tribe_hotspots.py's
# identical strip_bidi()).
def strip_bidi(s):
    return s.replace("⁦", "").replace("⁩", "")

# Story 13, item 3a: JSON import for squads & ratings, additive alongside
# toCSV()'s existing CSV import. Covers the product owner's reviewed design
# (see the "Squad Import Preview" mockup): a real Merge/Replace choice at
# both the squad level and the per-squad rating level, the "download a
# backup first" offer instead of a second confirm dialog, and the two error
# states (unsupported formatVersion, malformed file). The pure planning
# logic (buildSquadImportPlan()/mergeSquadDimensions()) is unit-tested in
# tests/unit/test_json_import.js; this only proves the real UI is wired to
# it correctly AND that what gets WRITTEN really lands -- reading
# window.__FAKE_STORE__ directly (not state.squads, not the DOM) after each
# apply, since a real bug was found and fixed during this story: update()
# deep-merges additively and can't actually clear a field, so REPLACE mode
# has to use set() with the whole doc instead. This test would catch a
# regression of exactly that mistake.
#
# state.live is true under this harness (fake_store.html's window.claude
# grants a db capability, same as a real deployment), so applySquadImportPlan()
# takes its async "live" branch for new-squad creation -- every wait below
# polls window.__FAKE_STORE__ directly rather than assuming synchronous
# completion.

out_path = build_page(out_name="_test_json_import.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    # ---- seed real ratings on Squad 1 via the actual UI (release + process) ----
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.click('.swatch.good'); page.click('#modalSave')
    page.wait_for_selector('#squadDetail .cell-btn.good[data-squad="squad-1"][data-dim="release"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="process"]')
    page.click('.swatch.warn'); page.click('#modalSave')
    page.wait_for_selector('#squadDetail .cell-btn.warn[data-squad="squad-1"][data-dim="process"]')

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_selector('#importJsonBtn', state="visible")

    print("=== English button label ===")
    label = page.eval_on_selector('#importJsonBtn', 'el => el.textContent').strip()
    print("import-json button:", label)
    assert "Import JSON" in label

    def open_with_file(payload_text, filename):
        p2 = test_output_path(filename)
        p2.write_text(payload_text)
        page.set_input_files('#jsonFileInput', str(p2))
        page.wait_for_selector('#importJsonBackdrop:not([hidden])')

    # ---- error state: malformed / not valid JSON ----
    print("=== malformed file ===")
    open_with_file("not json { at all", "bad_malformed.json")
    page.wait_for_selector('#importJsonBody .error-state')
    err_text = strip_bidi(page.eval_on_selector('#importJsonBody .error-state p', 'el => el.textContent'))
    print("error shown:", err_text)
    assert "doesn't look like a Squad Pulse export" in err_text
    page.click('#importJsonCloseErr')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    # ---- error state: unsupported formatVersion ----
    print("=== unsupported formatVersion ===")
    open_with_file(json.dumps({"formatVersion": 4, "squads": []}), "bad_version.json")
    page.wait_for_selector('#importJsonBody .error-state')
    err_text2 = strip_bidi(page.eval_on_selector('#importJsonBody .error-state p', 'el => el.textContent'))
    print("error shown:", err_text2)
    assert "newer app version" in err_text2
    page.click('#importJsonCloseErr')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    # ---- MERGE: Squad 1 (release overridden, process untouched), Squad 3 new, Squad 2 untouched ----
    print("=== merge import ===")
    merge_file = {
        "formatVersion": 1,
        "squads": [
            {"name": "Squad 1", "dimensions": {"release": {"color": "crit"}, "made-up-dim": {"color": "good"}}},
            {"name": "Squad 3", "dimensions": {"value": {"color": "good"}}},
        ],
    }
    open_with_file(json.dumps(merge_file), "merge.json")
    page.wait_for_selector('#importJsonBody .mode-btn.active[data-mode="merge"]')

    ratings_chip = strip_bidi(page.eval_on_selector('#importJsonBody .chip.ok', 'el => el.textContent'))
    print("ratings chip:", ratings_chip)
    assert "2 ratings to import" in ratings_chip  # release (Squad 1) + value (Squad 3); made-up-dim skipped

    skip_text = strip_bidi(page.eval_on_selector('#importJsonBody .import-skips .srow', 'el => el.textContent'))
    print("skipped row:", skip_text)
    assert "made-up-dim" in skip_text

    page.click('#importJsonApplyBtn')

    def store_squad_by_name(name):
        return page.evaluate(
            """(name) => Object.values(window.__FAKE_STORE__)
                .find(v => v && typeof v === 'object' && v.name === name) || null""",
            name,
        )

    page.wait_for_function(
        "(name) => Object.values(window.__FAKE_STORE__).some(v => v && v.name === name)",
        arg="Squad 3",
    )
    store_sq1 = store_squad_by_name("Squad 1")
    print("persisted Squad 1 after merge:", store_sq1)
    assert store_sq1["dimensions"]["release"]["color"] == "crit", "file's rating should win"
    assert store_sq1["dimensions"]["process"]["color"] == "warn", "MERGE must keep a rating the file didn't mention"

    store_sq2 = store_squad_by_name("Squad 2")
    print("Squad 2 still present after merge (absent from file):", store_sq2 is not None)
    assert store_sq2 is not None, "MERGE must never remove a squad absent from the file"

    all_names = page.evaluate(
        "() => Object.values(window.__FAKE_STORE__).filter(v => v && v.name).map(v => v.name).sort()"
    )
    print("all persisted squad names after merge:", all_names)
    assert all_names == ["Squad 1", "Squad 2", "Squad 3"]

    # ---- REPLACE: only Squad 1 (release only, no process) and Squad 3 in the file -> Squad 2 removed, Squad 1's process cleared ----
    print("=== replace import ===")
    replace_file = {
        "formatVersion": 1,
        "squads": [
            {"name": "Squad 1", "dimensions": {"release": {"color": "good"}}},
            {"name": "Squad 3", "dimensions": {"value": {"color": "warn"}}},
        ],
    }
    open_with_file(json.dumps(replace_file), "replace.json")
    page.wait_for_selector('#importJsonBody .mode-btn[data-mode="replace"]')
    page.click('#importJsonBody .mode-btn[data-mode="replace"]')
    page.wait_for_selector('#importJsonBody .import-warning.danger')

    warning_html = strip_bidi(page.eval_on_selector('#importJsonBody .import-warning.danger', 'el => el.textContent'))
    print("replace warning:", warning_html)
    assert "Squad 2" in warning_html
    assert "Suitable process" in warning_html  # Squad 1's about-to-clear "process" rating, by its dimension label

    print("=== backup-first offer ===")
    with page.expect_popup() as popup_info:
        page.click('#importJsonBackupBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    popup_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    backup_json = json.loads(popup_text)
    assert backup_json["formatVersion"] == 1
    page.wait_for_selector('#importJsonBackupDone:not([hidden])')
    print("backup offer produced a real, parseable board export; done-state shown")

    page.click('#importJsonApplyBtn')
    page.wait_for_function(
        "() => Object.values(window.__FAKE_STORE__).every(v => !v || v.name !== 'Squad 2')"
    )

    store_sq1_after_replace = store_squad_by_name("Squad 1")
    print("persisted Squad 1 after replace:", store_sq1_after_replace)
    assert store_sq1_after_replace["dimensions"].get("release", {}).get("color") == "good"
    assert "process" not in store_sq1_after_replace["dimensions"], \
        "REPLACE must actually clear a rating the file didn't mention in the PERSISTED store, not just in-memory state"

    all_names_after = page.evaluate(
        "() => Object.values(window.__FAKE_STORE__).filter(v => v && v.name).map(v => v.name).sort()"
    )
    print("persisted squad names after replace:", all_names_after)
    assert all_names_after == ["Squad 1", "Squad 3"], "REPLACE must remove a squad absent from the file"

    # ---- Hebrew label ----
    print("=== Hebrew label ===")
    page.click('.lang-btn[data-lang="he"]')
    label_he = page.eval_on_selector('#importJsonBtn', 'el => el.textContent').strip()
    print("import-json button (he):", label_he)
    assert label_he == "ייבוא JSON (בטא)"

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
