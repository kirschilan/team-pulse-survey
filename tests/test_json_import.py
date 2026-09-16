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

    # ---- error state: a rating with a bad field type (review finding, round
    # 2: {color:"good", note:123} passed validation, got persisted, then
    # crashed rendering -- cell.note.trim() assumes a string. Confirms the
    # malformed rating never reaches window.__FAKE_STORE__ at all -- exact
    # equality against a snapshot taken before the attempt, not just "isn't
    # literally 123", so this would also catch a partial/silent write. ----
    print("=== malformed rating (note is a number, not a string) ===")
    def squad1_dims():
        return page.evaluate("""() => {
            const sq = Object.values(window.__FAKE_STORE__).find(v => v && v.name === 'Squad 1');
            return sq ? sq.dimensions : null;
        }""")
    dims_before = squad1_dims()
    bad_rating_file = {"formatVersion": 1, "squads": [{"name": "Squad 1", "dimensions": {"release": {"color": "good", "note": 123}}}]}
    open_with_file(json.dumps(bad_rating_file), "bad_rating.json")
    page.wait_for_selector('#importJsonBody .error-state')
    err_text_rating = strip_bidi(page.eval_on_selector('#importJsonBody .error-state p', 'el => el.textContent'))
    print("error shown:", err_text_rating)
    assert "doesn't look like a Squad Pulse export" in err_text_rating
    assert errors == [], "a malformed rating must be handled, not thrown as an uncaught page error"
    dims_after = squad1_dims()
    print("Squad 1's dimensions before/after the rejected file:", dims_before, dims_after)
    assert dims_after == dims_before, "a malformed rating must never reach the persisted store, not even partially"
    page.click('#importJsonCloseErr')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    # ---- error state: a rating color that throws converting itself to a
    # property key (review finding, round 3: bracket-lookup enum checking
    # used the raw value as an object key; {toString:null} can't be coerced
    # to a primitive at all, so JS's own key-conversion throws BEFORE any
    # app validation code even runs). Most severe of the three round-3
    # findings since it's the one that could genuinely crash uncaught, same
    # class as the round-1 malformed-squad-entry bug -- the others
    # (array-coercion, inherited-property names) are pure validation-logic
    # mistakes with no throw risk, so they're covered at the unit level only. ----
    print("=== malformed rating (color is a non-primitive-coercible object) ===")
    dims_before2 = squad1_dims()
    throwing_color_file = {"formatVersion": 1, "squads": [{"name": "Squad 1", "dimensions": {"release": {"color": {"toString": None}}}}]}
    open_with_file(json.dumps(throwing_color_file), "throwing_color.json")
    page.wait_for_selector('#importJsonBody .error-state')
    err_text_throw = strip_bidi(page.eval_on_selector('#importJsonBody .error-state p', 'el => el.textContent'))
    print("error shown:", err_text_throw)
    assert "doesn't look like a Squad Pulse export" in err_text_throw
    assert errors == [], "a non-primitive-coercible rating field must be handled, not thrown as an uncaught page error"
    dims_after2 = squad1_dims()
    assert dims_after2 == dims_before2, "must never reach the persisted store"
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

    # ---- Story 13, item 3b: dimensions/templates/board-settings import,
    # extending the same file/preview/Merge-Replace toggle above to the rest
    # of what buildBoardExport() puts in the file. Matches by LABEL/NAME, not
    # key/id -- see board-export-import.js's buildDimensionImportPlan()/buildTemplateImportPlan()
    # comment for why (a custom dimension's key and a custom template's id are
    # both device-local "local-*-"+Date.now() storage artifacts, no more
    # portable across boards than a squad's own id already wasn't). The pure
    # planning/validation logic is unit-tested in tests/unit/test_json_import.js;
    # this proves the real UI is wired to it AND that what gets written really
    # lands in window.__FAKE_STORE__, same rigor as item 3a above. ----

    def store_entities(pred):
        return page.evaluate(
            "(pred) => Object.values(window.__FAKE_STORE__).filter(v => v && typeof v === 'object' && new Function('v', 'return ' + pred)(v))",
            pred,
        )

    def current_dimension_labels():
        return page.evaluate("() => window.state.dimensions.map(d => d.label)")

    def config_doc():
        return page.evaluate("() => window.__FAKE_STORE__['meta/config'] || null")

    print("=== item 3b: Apply is disabled with no scope checked at all ===")
    open_with_file(json.dumps({"formatVersion": 1, "squads": [], "dimensions": [{"label": "Psychological safety"}]}), "scope_none.json")
    page.wait_for_selector('#importJsonBody .scope-check input#importJsonScopeSquads')
    page.click('#importJsonBody input#importJsonScopeSquads')
    page.click('#importJsonBody input#importJsonScopeTemplates')
    no_scope_disabled = page.eval_on_selector('#importJsonApplyBtn', 'el => el.disabled')
    print("Apply disabled with both scopes unchecked?", no_scope_disabled)
    assert no_scope_disabled
    hint_shown = page.eval_on_selector('#importJsonBody', 'el => el.textContent').find('boxes above') != -1
    assert hint_shown, "unchecking every scope should show the 'check a box' hint"
    page.click('#importJsonCancel')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    # ---- PR #12 review finding (P1): a combined squads+dimensions import
    # dropped ratings whenever the rating's dimension key didn't literally
    # exist on THIS board -- true for every cross-board import, since
    # dimensions match by LABEL (not key, per item 3b's own design) and two
    # boards/devices never share a dimension's random "local-dim-"+Date.now()
    # key even for "the same" labeled dimension. Reproduced with the real
    # browser import UI: a file with a brand-new custom dimension AND an
    # existing dimension referenced under the SOURCE board's own (different)
    # key, both with real ratings -- both must land under the DESTINATION's
    # real key, not be silently skipped. ----
    print("=== item 3b: combined import resolves ratings for a NEW dimension and an existing dimension under a different source key ===")
    combined_file = {
        "formatVersion": 1,
        "squads": [
            {"name": "Squad 1", "dimensions": {
                "src_new_dim_key": {"color": "good", "note": "brand new dimension rating"},
                "src_release_key": {"color": "warn"},
            }},
        ],
        "dimensions": [
            {"key": "src_new_dim_key", "label": "Team autonomy"},
            {"key": "src_release_key", "label": "Easy to release"},
        ],
    }
    open_with_file(json.dumps(combined_file), "combined.json")
    page.wait_for_selector('#importJsonBody .mode-btn.active[data-mode="merge"]')

    ratings_chip_combined = strip_bidi(page.eval_on_selector('#importJsonBody .chip.ok', 'el => el.textContent'))
    print("ratings chip (must show BOTH ratings, not 0):", ratings_chip_combined)
    assert "2 ratings to import" in ratings_chip_combined

    page.click('#importJsonApplyBtn')
    page.wait_for_function("() => window.state.dimensions.some(d => d.label === 'Team autonomy')")

    new_dim_key = page.evaluate("() => (window.state.dimensions.find(d => d.label === 'Team autonomy') || {}).key")
    print("new dimension's real (destination) key:", new_dim_key)
    assert new_dim_key and "pending-dimension:" not in new_dim_key

    store_sq1_combined = store_squad_by_name("Squad 1")
    print("persisted Squad 1 after combined import:", store_sq1_combined)
    assert store_sq1_combined["dimensions"].get(new_dim_key, {}).get("color") == "good", \
        "a rating for a dimension created in the SAME import must land under its real destination key"
    assert store_sq1_combined["dimensions"].get(new_dim_key, {}).get("note") == "brand new dimension rating"
    assert store_sq1_combined["dimensions"].get("release", {}).get("color") == "warn", \
        "a rating for an EXISTING dimension referenced under a different source key must resolve by label"
    assert not any("pending-dimension:" in k for k in store_sq1_combined["dimensions"].keys()), \
        "no unresolved pending-dimension marker should ever reach the persisted store"

    print("=== item 3b: merge adds + updates a dimension, adds a saved template, changes a config field ===")
    before_labels = current_dimension_labels()
    print("board dimension labels before:", before_labels)
    assert "Psychological safety" not in before_labels
    assert "Easy to release" in before_labels

    merge_rest_file = {
        "formatVersion": 1,
        "squads": [],
        "dimensions": [
            {"label": "Psychological safety", "green": "we speak up", "red": "we stay quiet"},
            {"label": "Easy to release", "green": "updated green text"},
        ],
        "templates": [
            {"name": "Onboarding Checklist", "unit": "Squad", "unitPlural": "Squads", "attribution": "", "dimensions": []},
        ],
        "config": {"unit": "Team"},
    }
    open_with_file(json.dumps(merge_rest_file), "merge_rest.json")
    page.wait_for_selector('#importJsonBody .mode-btn.active[data-mode="merge"]')

    dim_chips = strip_bidi(page.eval_on_selector_all('#importJsonBody .import-stats', 'els => els.map(e => e.textContent).join(" | ")'))
    print("section chips:", dim_chips)
    assert "1 new dimension" in dim_chips
    assert "1 existing dimension updated" in dim_chips
    assert "1 new template" in dim_chips

    config_rows = strip_bidi(page.eval_on_selector('#importJsonBody .config-diff', 'el => el.textContent'))
    print("config diff shown:", config_rows)
    assert "Team" in config_rows

    page.click('#importJsonApplyBtn')
    page.wait_for_function("(labels) => window.state.dimensions.some(d => labels.includes(d.label))", arg=["Psychological safety"])

    labels_after = current_dimension_labels()
    print("board dimension labels after merge:", labels_after)
    assert "Psychological safety" in labels_after, "MERGE must add a dimension the board doesn't have, matched by label"

    release_doc = next((d for d in store_entities("v.label === 'Easy to release'")), None)
    print("persisted 'Easy to release' after merge:", release_doc)
    assert release_doc is not None
    assert release_doc["green"] == "updated green text", "MERGE must update a matched dimension's fields from the file"
    assert release_doc["red"] == "red release", \
        "MERGE must leave a field the file's entry didn't mention alone (the file omitted red entirely) -- fake_store.html seeds it as 'red release'"

    onboarding_docs = store_entities("v.name === 'Onboarding Checklist'")
    print("persisted 'Onboarding Checklist' template(s):", onboarding_docs)
    assert len(onboarding_docs) == 1, "MERGE must add a saved template the board doesn't have, matched by name"

    cfg = config_doc()
    print("persisted meta/config after merge:", cfg)
    assert cfg is not None and cfg.get("unit") == "Team", "board settings must apply even though the mode is Merge -- config has no removal concept"

    # ---- REPLACE: a dimension and the just-added template absent from the
    # file are removed; config still just overwrites (nothing to "clear") ----
    print("=== item 3b: replace removes a dimension and a saved template absent from the file ===")
    remaining_labels = [l for l in current_dimension_labels() if l != "Value"]
    replace_rest_file = {
        "formatVersion": 1,
        "squads": [],
        "dimensions": [{"label": l} for l in remaining_labels],
        "templates": [],
        "config": {},
    }
    open_with_file(json.dumps(replace_rest_file), "replace_rest.json")
    page.wait_for_selector('#importJsonBody .mode-btn[data-mode="replace"]')
    page.click('#importJsonBody .mode-btn[data-mode="replace"]')
    # this file's own "squads": [] is a real, explicit claim (squads is a
    # REQUIRED field, unlike the optional dimensions/templates keys) -- under
    # the already-shipped item 3a semantics that correctly means "remove
    # every squad" in Replace mode. Scoping this scenario to templates-only
    # isolates it to the dimension/template removal this scenario is
    # actually about, and doubles as proof the scope checkbox really does
    # keep squads out of an apply that has real squad-removing content in it.
    page.click('#importJsonBody input#importJsonScopeSquads')
    page.wait_for_selector('#importJsonBody .import-warning.danger')

    warning_rest = strip_bidi(page.eval_on_selector('#importJsonBody .import-warning.danger', 'el => el.textContent'))
    print("replace warning (dimensions/templates only, squads scope off):", warning_rest)
    assert "Value" in warning_rest
    assert "Onboarding Checklist" in warning_rest
    assert "Squad 1" not in warning_rest and "Squad 3" not in warning_rest, \
        "squads scope is unchecked -- the file's own \"squads\": [] must not surface a squad-removal warning"

    page.click('#importJsonApplyBtn')
    page.wait_for_function("(label) => !window.state.dimensions.some(d => d.label === label)", arg="Value")

    labels_final = current_dimension_labels()
    print("board dimension labels after replace:", labels_final)
    assert "Value" not in labels_final, "REPLACE must remove a dimension absent from the file, matched by label"

    names_untouched = page.evaluate("() => window.state.squads.map(s => s.name).sort()")
    print("squad names after a templates-only-scope replace apply:", names_untouched)
    assert names_untouched == ["Squad 1", "Squad 3"], "squads scope was off -- the file's own empty squads list must not remove any squad"

    onboarding_after = store_entities("v.name === 'Onboarding Checklist'")
    print("'Onboarding Checklist' after replace:", onboarding_after)
    assert onboarding_after == [], "REPLACE must remove a saved template absent from the file, matched by name"

    # ---- scope toggle: unchecking "Dimensions, templates & board settings"
    # leaves that whole section out of both the preview and the actual apply,
    # even though the file has real changes in it ----
    print("=== item 3b: unchecking the templates scope skips dimensions/templates/config entirely ===")
    labels_before_scope_test = current_dimension_labels()
    scoped_out_file = {
        "formatVersion": 1,
        "squads": [],
        "dimensions": [{"label": "Should never be added"}],
        "config": {"unit": "Should never apply"},
    }
    open_with_file(json.dumps(scoped_out_file), "scoped_out.json")
    page.wait_for_selector('#importJsonBody .scope-check')
    page.click('#importJsonBody input#importJsonScopeTemplates')
    scope_section_gone = page.eval_on_selector_all('#importJsonBody .import-stats', 'els => els.length')
    print("import-stats sections shown with templates scope unchecked:", scope_section_gone)
    assert scope_section_gone == 1, "only the squads section's own chips should remain once the templates scope is unchecked"
    apply_disabled_scope_out = page.eval_on_selector('#importJsonApplyBtn', 'el => el.disabled')
    print("Apply disabled (squads scope has nothing to do, templates scope unchecked)?", apply_disabled_scope_out)
    assert apply_disabled_scope_out
    page.click('#importJsonCancel')
    page.wait_for_selector('#importJsonBackdrop[hidden]', state="attached")

    labels_unchanged = current_dimension_labels()
    cfg_unchanged = config_doc()
    print("dimensions/config after cancel (must be untouched):", labels_unchanged, cfg_unchanged.get("unit") if cfg_unchanged else None)
    assert labels_unchanged == labels_before_scope_test
    assert cfg_unchanged.get("unit") == "Team", "still the value from the earlier merge, never 'Should never apply'"

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
    assert modal_title_he == "ייבוא JSON ללוח"

    print("errors:", errors)
    assert errors == []
    print("PASS")
    browser.close()
