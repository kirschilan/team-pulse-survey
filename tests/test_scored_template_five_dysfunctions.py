from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_tpl_five_dysfunctions.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))

    # ---- open Templates (Admin view) and check the starter section ----
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "templates list rendered" signal instead of guessing.
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    print("=== templates modal ===")
    labels = page.eval_on_selector_all('#tplList .field-label', 'els=>els.map(e=>e.textContent)')
    print("section labels:", labels)
    starter_row = page.query_selector('#tplList .tpl-row[data-id="starter-5dysfunctions"]')
    print("starter row found:", starter_row is not None)
    meta_text = page.eval_on_selector('#tplList .tpl-row[data-id="starter-5dysfunctions"] .tmeta', 'el=>el.textContent')
    print("starter row meta:", meta_text)
    has_delete = page.query_selector('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="delete"]')
    print("starter row has delete button (should be None):", has_delete)
    assert has_delete is None, "starter template row should not have a delete button"
    print("errors so far:", errors)

    # ---- load the Five Dysfunctions starter template ----
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    print("confirm dialog visible:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    print("confirm message:", page.eval_on_selector('#confirmMessage', 'el=>el.textContent'))
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "Five
    # Dysfunctions' dimensions landed" signal (loadTemplate()'s own Promise
    # chain) instead of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/trust'] !== undefined")

    dim_keys = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/')).sort()")
    print("=== after loading Five Dysfunctions ===")
    print("dimension keys now:", dim_keys)
    trust_doc = page.evaluate("window.__FAKE_STORE__['dimensions/trust']")
    print("trust dimension doc:", trust_doc)
    assert trust_doc is not None and trust_doc.get("statements") and len(trust_doc["statements"]) == 3
    assert trust_doc.get("scoreBands") == {"good": 8, "warn": 6}
    assert trust_doc.get("strategies") and len(trust_doc["strategies"]) == 2
    config = page.evaluate("window.__FAKE_STORE__['meta/config']")
    print("active template name:", config.get("activeTemplateName"))
    assert config.get("activeTemplateName") == "The Five Dysfunctions of a Team"
    print("errors:", errors)

    # ---- grid header shows the 5 dysfunction labels (Tribe view) ----
    page.click('.view-btn[data-view="tribe"]')
    page.click('#squadBreakdown summary')
    # eval_on_selector_all() below doesn't auto-wait, and expanding a native
    # <details> is a synchronous browser toggle -- #gridTable's rows were
    # already rendered into the collapsed-but-attached markup, not built
    # lazily on open.
    page.wait_for_selector('.dim-th-label', state="attached")
    header_labels = page.eval_on_selector_all('.dim-th-label', 'els=>els.map(e=>e.textContent)')
    print("grid header labels:", header_labels)
    assert "Absence of Trust" in header_labels and "Inattention to Results" in header_labels

    # ---- rating still works the normal (manual swatch) way for a scored dimension ----
    # Every step here is click() -- Playwright auto-waits for each target to
    # become actionable, so the chain needs no waits of its own.
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="trust"]')
    page.click('.swatch.warn')
    page.click('#modalSave')
    # evaluate() below doesn't auto-wait -- poll for the real write landing
    # instead of guessing.
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.dimensions && s.dimensions.trust && s.dimensions.trust.color === 'warn'; }")
    squad1 = page.evaluate("window.__FAKE_STORE__['squads/squad-1']")
    print("squad-1 after manual rating of 'trust':", squad1["dimensions"].get("trust"))
    assert squad1["dimensions"]["trust"]["color"] == "warn"
    print("errors:", errors)

    # ---- Edit dimensions (Admin) shows the dimension's statements, now editable ----
    page.click('.view-btn[data-view="admin"]')
    page.click('#dimManageBtn')
    # query_selector_all() below doesn't auto-wait -- wait for the real
    # "dim manager rendered" signal instead of guessing.
    page.wait_for_selector('.dim-row[data-key="trust"] [data-field="statements"][data-lang="en"]', state="attached")
    stmt_inputs = page.query_selector_all('.dim-row[data-key="trust"] [data-field="statements"][data-lang="en"]')
    print("editable statement inputs for 'trust':", len(stmt_inputs))
    assert len(stmt_inputs) == 3
    assert "quickly and genuinely apologize" in stmt_inputs[0].input_value()
    page.click('#dimDoneBtn')

    # ---- re-loading the SAME starter template again reuses the same dimension keys ----
    # Reloading the identical, already-active template writes the SAME
    # dimension keys back (loadTemplate() only deletes keys the new set
    # DOESN'T reuse), so "dimensions/trust exists" is already true before
    # this reload even starts -- not a real completion signal here, unlike
    # the first load above. meta/config.updatedAt IS stamped fresh on every
    # load regardless of content, so capture its current value and poll for
    # it to change instead.
    config_updated_before_reload = config.get("updatedAt")
    page.click('#templatesBtn')
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    page.click('#confirmOk')
    page.wait_for_function(
        "(prev) => { var c = window.__FAKE_STORE__['meta/config']; return c && c.updatedAt !== prev; }",
        arg=config_updated_before_reload,
    )
    dim_keys_2 = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/')).sort()")
    print("dimension keys after reloading same template (should be identical set):", dim_keys_2)
    assert dim_keys_2 == dim_keys
    squad1_after = page.evaluate("window.__FAKE_STORE__['squads/squad-1']")
    print("squad-1 'trust' rating survives reloading the same template (should still be 'warn'):", squad1_after["dimensions"].get("trust"))
    assert squad1_after["dimensions"]["trust"]["color"] == "warn"
    # loadTemplate() already closes the Templates modal on success -- no separate close click needed

    # ---- Edit dimensions still shows all 5 (sanity check after the reload) ----
    page.click('#dimManageBtn')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "dim manager rendered" signal instead of guessing.
    page.wait_for_selector('#dimList .dim-row', state="attached")
    n_dims_5df = page.eval_on_selector_all('#dimList .dim-row', 'els=>els.length')
    print("dim rows while on Five Dysfunctions:", n_dims_5df)
    assert n_dims_5df == 5
    page.click('#dimDoneBtn')

    # ============ Story 8: Five Dysfunctions' dimension content localizes live too ============
    # Same mechanism as Stories 5/7 (state.js's localizedDimText()/
    # localizedAttribution(), generalized to any starter template that
    # declares its own .i18n table): switching to Hebrew shows Hebrew
    # label/green/red/attribution immediately, no reload required; the
    # underlying stored dimension docs stay English always.
    print("=== Story 8: Five Dysfunctions dimension content localizes live under Hebrew ===")
    # setLocale() (i18n.js) is fully synchronous -- state, localStorage, DOM
    # re-render all happen inline in the click handler -- and this
    # evaluate() reads the store directly (unaffected by the UI's
    # language anyway), so no wait is needed here.
    page.click('.lang-btn[data-lang="he"]')

    trust_doc_he = page.evaluate("window.__FAKE_STORE__['dimensions/trust']")
    print("stored 'trust' dimension under Hebrew (should stay English):", trust_doc_he["label"])
    assert trust_doc_he["label"] == "Absence of Trust"

    page.click('.view-btn[data-view="tribe"]')
    page.click('#legendSummary')
    # eval_on_selector() below doesn't auto-wait, and expanding a native
    # <details> is a synchronous browser toggle -- the legend content was
    # already rendered (and attached, just collapsed) by renderLegend(),
    # not populated lazily on open.
    page.wait_for_selector('.legend-item .lh', state="attached")
    trust_label_he = page.eval_on_selector('.legend-item .lh', 'el=>el.textContent')
    attribution_he = page.eval_on_selector('#legendAttrib', 'el=>el.textContent')
    print("Tribe legend under Hebrew -- first dimension label / attribution:", trust_label_he, "|", attribution_he)
    assert trust_label_he.strip() and trust_label_he != "Absence of Trust"
    assert attribution_he.strip() and "Patrick Lencioni" not in attribution_he

    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')

    print("=== FINAL errors:", errors)
    page.screenshot(path=str(test_output_path("shot_tpl_five_dysfunctions.png")), full_page=True)
    browser.close()
