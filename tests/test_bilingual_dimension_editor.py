from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Bilingual dimensions: the product owner approved a proposal (a working
# mockup, reviewed and approved before this was built -- see STATUS.md) to
# make a dimension's Hebrew translation a real, editable field on the
# dimension itself, right next to the English one in Edit Dimensions --
# instead of a hardcoded, template-level shadow table only the three
# built-in starter templates could ever have (state.js's localizedDimText()
# is the underlying redesign this UI drives). Also approved: making the
# survey statements/strategies themselves editable in BOTH languages,
# closing the "not editable here yet" gap the read-only hint used to name.

out_path = build_page(out_name="_test_bilingual_dim_editor.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1000, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="admin"]')

    print("=== a genuinely custom dimension (no built-in template shares its content) has NO Hebrew yet: 'add translation' toggle, collapsed ===")
    page.click('#dimManageBtn')
    # query_selector() below doesn't auto-wait -- poll for the new
    # dimension actually landing in the store/rendering instead of guessing
    # (addDimension()'s own comment explains the DOM update comes from the
    # dimensions listener firing, not a direct call here -- but the fake
    # store's notify() invokes it synchronously either way).
    page.click('#addDimBtn')
    page.wait_for_selector('.dim-row:has(input.dim-label[value="New dimension"])', state="attached")
    custom_row = page.query_selector('.dim-row:has(input.dim-label[value="New dimension"])')
    custom_toggle = custom_row.query_selector('.i18n-toggle')
    print("toggle text (no translation, no built-in match):", custom_toggle.text_content())
    assert "Add a Hebrew translation" in custom_toggle.text_content()
    assert custom_row.query_selector('.i18n-panel').is_hidden()
    # The toggle's click handler just synchronously flips panel.hidden --
    # no store write, no re-render -- so custom_row's handle stays valid and
    # no wait is needed before reading it.
    custom_toggle.click()
    assert custom_row.query_selector('.i18n-panel').query_selector('.dim-label').input_value() == ""

    # "process" is a real regression case: it's an unmodified Spotify Squad
    # Health Check dimension (this fixture's default board) with no i18n of
    # its OWN -- exactly the shape a board that loaded this template BEFORE
    # the per-dimension i18n redesign shipped would have. Its label matches
    # the built-in default exactly, so it should show that translation as a
    # fallback (state.js's builtinDimTranslation()); its green/red here are
    # synthetic test content ("green process"/"red process", not Spotify's
    # real text -- see this fixture's own header comment), so those correctly
    # do NOT get a fallback translation -- a mismatched value must never be
    # paired with someone else's translation.
    print("=== a dimension with no i18n of its own, but whose content still matches a built-in default, shows that built-in translation as a fallback (the legacy-board regression fix) ===")
    process_row = page.query_selector('.dim-row[data-key="process"]')
    toggle = process_row.query_selector('.i18n-toggle')
    print("toggle text (built-in fallback in effect):", toggle.text_content())
    assert "added" in toggle.text_content().lower()
    assert toggle.get_attribute("aria-expanded") == "true"  # a dimension with an in-effect translation starts open
    panel = process_row.query_selector('.i18n-panel')
    assert panel.is_visible()
    he_label_input = panel.query_selector('.dim-label')
    print("pre-filled Hebrew label (built-in fallback, no i18n stored yet):", he_label_input.input_value())
    assert he_label_input.input_value() == "תהליך עבודה מתאים"
    he_green_readonly = panel.query_selector('textarea[data-field="green"]')
    print("Hebrew green (should stay blank -- English green here doesn't match the built-in default):", he_green_readonly.input_value())
    assert he_green_readonly.input_value() == ""
    assert page.evaluate("dimByKey('process').i18n") is None  # fallback is display-only -- nothing written until an actual edit

    print("=== filling in a Hebrew translation persists to dim.i18n.he (an explicit edit always wins over the fallback) and localizes live ===")
    # renderDimList() fully rebuilds #dimList's innerHTML on every change --
    # earlier element handles go stale, so re-query after each edit. No
    # wait is needed between the edit and the re-query, or before the
    # evaluate() below: updateDimensionI18nField() (dimensions.js) mutates
    # the dimension, calls renderAll()/renderDimList(), AND writes to the
    # store all SYNCHRONOUSLY inside the 'change' handler, before
    # dispatch_event() even returns.
    he_label_input.fill("קלות שחרור")
    he_label_input.dispatch_event("change")
    he_green = page.query_selector('.dim-row[data-key="process"] .i18n-panel textarea[data-field="green"]')
    he_green.fill("שחרור קל וירוק")
    he_green.dispatch_event("change")

    stored = page.evaluate("dimByKey('process').i18n")
    print("stored i18n.he after edit:", stored)
    assert stored["he"]["label"] == "קלות שחרור"
    assert stored["he"]["green"] == "שחרור קל וירוק"

    # setLocale() (i18n.js) is fully synchronous, and closeDimManager() is
    # just a hidden-attribute toggle -- no wait needed for either click.
    page.click('#dimDoneBtn')
    page.click('.lang-btn[data-lang="he"]')
    page.click('.view-btn[data-view="tribe"]')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "grid rendered" signal instead of guessing.
    page.wait_for_selector('.dim-th-label', state="attached")
    grid_labels = page.eval_on_selector_all('.dim-th-label', 'els=>els.map(e=>e.textContent)')
    print("Tribe grid dimension labels (Hebrew, should include our new translation):", grid_labels)
    assert "קלות שחרור" in grid_labels

    print("=== switching back to English + Hebrew UI, reopening Edit Dimensions ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('#dimManageBtn')
    # query_selector() below doesn't auto-wait -- wait for the real "dim
    # list rendered" signal instead of guessing.
    page.wait_for_selector('.dim-row[data-key="process"] .i18n-toggle', state="attached")
    process_row2 = page.query_selector('.dim-row[data-key="process"]')
    toggle2 = process_row2.query_selector('.i18n-toggle')
    print("toggle text now that a translation exists (Hebrew UI):", toggle2.text_content())
    assert "נוסף" in toggle2.text_content()  # "added"

    print("=== a Tuckman dimension's Hebrew panel starts pre-filled from the built-in default ===")
    page.click('#dimDoneBtn')
    page.click('#templatesBtn')
    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "Tuckman's
    # dimensions landed" signal (loadTemplate()'s own Promise chain) instead
    # of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/forming'] !== undefined")
    page.click('#dimManageBtn')
    # query_selector() below doesn't auto-wait -- wait for the real "dim
    # list rendered" signal instead of guessing.
    page.wait_for_selector('.dim-row[data-key="forming"] .i18n-toggle', state="attached")
    forming_row = page.query_selector('.dim-row[data-key="forming"]')
    forming_toggle = forming_row.query_selector('.i18n-toggle')
    print("Tuckman 'forming' toggle (should say translation added):", forming_toggle.text_content())
    assert "נוסף" in forming_toggle.text_content()
    # a dimension that ALREADY has a translation (built-in default, here)
    # starts with its panel open, not closed -- no click needed to see it.
    assert forming_toggle.get_attribute("aria-expanded") == "true"
    forming_panel = forming_row.query_selector('.i18n-panel')
    source_hint = forming_panel.query_selector('.i18n-source').text_content()
    print("source hint (should name the template):", source_hint)
    assert "Tuckman" in source_hint
    pre_filled_label = forming_panel.query_selector('.dim-label').input_value()
    print("pre-filled Hebrew label:", pre_filled_label)
    assert pre_filled_label == "התהוות"

    print("=== English statements are now editable (previously read-only) ===")
    en_stmt_inputs = forming_row.query_selector_all('[data-field="statements"][data-lang="en"]')
    print("English statement inputs found:", len(en_stmt_inputs))
    assert len(en_stmt_inputs) == 4
    first_en_stmt = en_stmt_inputs[0]
    print("first EN statement value (should be the real Tuckman text):", first_en_stmt.input_value())
    assert "still learning" in first_en_stmt.input_value()
    # No wait needed here -- updateDimensionArrayItem() (dimensions.js)
    # mutates and writes to the store synchronously, same as the i18n
    # field edits above.
    first_en_stmt.fill("Custom English statement text")
    first_en_stmt.dispatch_event("change")
    stored_stmts = page.evaluate("dimByKey('forming').statements")
    original_stmts = page.evaluate("TUCKMAN_TEMPLATE.dimensions.find(d=>d.key==='forming').statements")
    print("stored EN statements after edit:", stored_stmts)
    assert stored_stmts[0] == "Custom English statement text"
    # editing statement #0 shouldn't disturb the other three
    assert stored_stmts[1:] == original_stmts[1:]

    print("=== Hebrew statements are editable too, pre-filled, aligned by index ===")
    # renderDimList() rebuilt the DOM after the English edit above -- re-query.
    he_stmt_inputs = page.query_selector_all('.dim-row[data-key="forming"] .i18n-panel [data-field="statements"][data-lang="he"]')
    print("Hebrew statement inputs found:", len(he_stmt_inputs))
    assert len(he_stmt_inputs) == 4
    print("pre-filled first HE statement:", he_stmt_inputs[0].input_value())
    assert he_stmt_inputs[0].input_value().strip() != ""
    # Same synchronous-write reasoning as the English statement edit above.
    he_stmt_inputs[1].fill("היגד עברי מותאם אישית")
    he_stmt_inputs[1].dispatch_event("change")
    stored_he_stmts = page.evaluate("dimByKey('forming').i18n.he.statements")
    print("stored HE statements after edit:", stored_he_stmts)
    assert stored_he_stmts[1] == "היגד עברי מותאם אישית"
    # editing statement #1 (Hebrew) shouldn't have blanked out #0's pre-filled translation
    assert stored_he_stmts[0].strip() != ""

    print("=== strategies are editable in both languages too ===")
    en_strat_inputs = page.query_selector_all('.dim-row[data-key="forming"] [data-field="strategies"][data-lang="en"]')
    he_strat_inputs = page.query_selector_all('.dim-row[data-key="forming"] .i18n-panel [data-field="strategies"][data-lang="he"]')
    print("EN/HE strategy input counts:", len(en_strat_inputs), len(he_strat_inputs))
    assert len(en_strat_inputs) == 4 and len(he_strat_inputs) == 4

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_bilingual_dim_editor.png")), full_page=True)
    browser.close()
    print("=== ALL BILINGUAL DIMENSION EDITOR CHECKS PASSED ===")
