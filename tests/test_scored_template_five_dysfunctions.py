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
    page.wait_for_timeout(400)

    # ---- open Templates (Admin view) and check the starter section ----
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
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
    page.wait_for_timeout(150)
    print("confirm dialog visible:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    print("confirm message:", page.eval_on_selector('#confirmMessage', 'el=>el.textContent'))
    page.click('#confirmOk')
    page.wait_for_timeout(400)

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
    page.wait_for_timeout(100)
    page.click('#squadBreakdown summary')
    page.wait_for_timeout(150)
    header_labels = page.eval_on_selector_all('.dim-th-label', 'els=>els.map(e=>e.textContent)')
    print("grid header labels:", header_labels)
    assert "Absence of Trust" in header_labels and "Inattention to Results" in header_labels

    # ---- rating still works the normal (manual swatch) way for a scored dimension ----
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(120)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="trust"]')
    page.wait_for_timeout(120)
    page.click('.swatch.warn')
    page.click('#modalSave')
    page.wait_for_timeout(200)
    squad1 = page.evaluate("window.__FAKE_STORE__['squads/squad-1']")
    print("squad-1 after manual rating of 'trust':", squad1["dimensions"].get("trust"))
    assert squad1["dimensions"]["trust"]["color"] == "warn"
    print("errors:", errors)

    # ---- Edit dimensions (Admin) shows the dimension's statements, now editable ----
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)
    stmt_inputs = page.query_selector_all('.dim-row[data-key="trust"] [data-field="statements"][data-lang="en"]')
    print("editable statement inputs for 'trust':", len(stmt_inputs))
    assert len(stmt_inputs) == 3
    assert "quickly and genuinely apologize" in stmt_inputs[0].input_value()
    page.click('#dimDoneBtn')

    # ---- re-loading the SAME starter template again reuses the same dimension keys ----
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_timeout(150)
    page.click('#confirmOk')
    page.wait_for_timeout(400)
    dim_keys_2 = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/')).sort()")
    print("dimension keys after reloading same template (should be identical set):", dim_keys_2)
    assert dim_keys_2 == dim_keys
    squad1_after = page.evaluate("window.__FAKE_STORE__['squads/squad-1']")
    print("squad-1 'trust' rating survives reloading the same template (should still be 'warn'):", squad1_after["dimensions"].get("trust"))
    assert squad1_after["dimensions"]["trust"]["color"] == "warn"
    # loadTemplate() already closes the Templates modal on success -- no separate close click needed

    # ---- Edit dimensions still shows all 5 (sanity check after the reload) ----
    page.click('#dimManageBtn')
    page.wait_for_timeout(100)
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
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    trust_doc_he = page.evaluate("window.__FAKE_STORE__['dimensions/trust']")
    print("stored 'trust' dimension under Hebrew (should stay English):", trust_doc_he["label"])
    assert trust_doc_he["label"] == "Absence of Trust"

    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    page.click('#legendSummary')
    page.wait_for_timeout(150)
    trust_label_he = page.eval_on_selector('.legend-item .lh', 'el=>el.textContent')
    attribution_he = page.eval_on_selector('#legendAttrib', 'el=>el.textContent')
    print("Tribe legend under Hebrew -- first dimension label / attribution:", trust_label_he, "|", attribution_he)
    assert trust_label_he.strip() and trust_label_he != "Absence of Trust"
    assert attribution_he.strip() and "Patrick Lencioni" not in attribution_he

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)

    print("=== FINAL errors:", errors)
    page.screenshot(path=str(test_output_path("shot_tpl_five_dysfunctions.png")), full_page=True)
    browser.close()
