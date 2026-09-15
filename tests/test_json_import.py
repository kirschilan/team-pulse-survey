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

    # ---- error state: structurally malformed squad entry (review finding: this
    # used to throw uncaught inside FileReader.onload instead of showing the
    # error UI) ----
    print("=== malformed squad entry (null in squads array) ===")
    open_with_file(json.dumps({"formatVersion": 1, "squads": [None]}), "bad_squad.json")
    page.wait_for_selector('#importJsonBody .error-state')
    err_text3 = strip_bidi(page.eval_on_selector('#importJsonBody .error-state p', 'el => el.textContent'))
    print("error shown:", err_text3)
    assert "doesn't look like a Squad Pulse export" in err_text3
    assert errors == [], "a malformed entry must be handled, not thrown as an uncaught page error"
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

    print("=== backup failure (blocked popup) shows an error, not a false success ===")
    # fake_store.html's window.claude.use("downloads") always resolves to
    # null, so the real code path here is the window.open() fallback --
    # returning null from it (a blocked popup) is a real, reachable failure
    # mode, not a contrived one. Review finding: the old handler showed
    # "Backup downloaded" regardless.
    page.evaluate("() => { window.__realOpen = window.open; window.open = () => null; }")
    page.click('#importJsonBackupBtn')
    page.wait_for_selector('#importJsonBackupFailed:not([hidden])')
    failed_text = strip_bidi(page.eval_on_selector('#importJsonBackupFailed', 'el => el.textContent'))
    print("backup failure shown:", failed_text)
    assert "failed" in failed_text.lower()
    done_hidden = page.eval_on_selector('#importJsonBackupDone', 'el => el.hasAttribute("hidden")')
    assert done_hidden, "the success indicator must stay hidden after a failed backup"
    page.evaluate("() => { window.open = window.__realOpen; }")

    print("=== backup-first offer (real success) ===")
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

    # ---- REPLACE plan that only clears existing ratings (every board squad
    # already named in the file, none removed, nothing new to import) must
    # still enable Apply -- review finding: the disabled condition checked
    # ratingCount/newSquadNames/squadsToRemove but not clearedRatings ----
    print("=== replace-mode ratings-only clear still enables Apply ===")
    clear_only_file = {
        "formatVersion": 1,
        "squads": [{"name": "Squad 1", "dimensions": {}}, {"name": "Squad 3", "dimensions": {}}],
    }
    open_with_file(json.dumps(clear_only_file), "clear_only.json")
    page.wait_for_selector('#importJsonBody .mode-btn[data-mode="replace"]')
    page.click('#importJsonBody .mode-btn[data-mode="replace"]')
    page.wait_for_selector('#importJsonBody .import-warning.danger')

    apply_disabled = page.eval_on_selector('#importJsonApplyBtn', 'el => el.disabled')
    print("Apply disabled?", apply_disabled)
    assert not apply_disabled, "a REPLACE plan that only clears ratings must still be applyable"

    page.click('#importJsonApplyBtn')
    page.wait_for_function("""() => {
        const sq1 = Object.values(window.__FAKE_STORE__).find(v => v && v.name === 'Squad 1');
        return sq1 && Object.keys(sq1.dimensions || {}).length === 0;
    }""")
    store_sq1_cleared = store_squad_by_name("Squad 1")
    print("Squad 1 after ratings-only replace:", store_sq1_cleared)
    assert store_sq1_cleared["dimensions"] == {}, "REPLACE must clear ratings even with no squad additions/removals"

    # ---- Hebrew label + RTL modal scoping (review finding: the modal was
    # missing from RTL_SCOPED_CONTAINERS, so its translated strings rendered
    # with dir="ltr") ----
    print("=== Hebrew label + RTL modal scoping ===")
    page.click('.lang-btn[data-lang="he"]')
    label_he = page.eval_on_selector('#importJsonBtn', 'el => el.textContent').strip()
    print("import-json button (he):", label_he)
    assert label_he == "ייבוא JSON (בטא)"

    open_with_file(json.dumps({"formatVersion": 1, "squads": []}), "he_check.json")
    backdrop_dir = page.eval_on_selector('#importJsonBackdrop', 'el => el.getAttribute("dir")')
    backdrop_lang = page.eval_on_selector('#importJsonBackdrop', 'el => el.getAttribute("lang")')
    computed_dir = page.eval_on_selector('#importJsonBody h3', 'el => getComputedStyle(el).direction')
    modal_title_he = strip_bidi(page.eval_on_selector('#importJsonBody h3', 'el => el.textContent'))
    print("modal dir/lang/computed direction/title:", backdrop_dir, backdrop_lang, computed_dir, modal_title_he)
    assert backdrop_dir == "rtl"
    assert backdrop_lang == "he"
    assert computed_dir == "rtl"
    assert modal_title_he == "ייבוא JSON — צוותים ודירוגים"

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
