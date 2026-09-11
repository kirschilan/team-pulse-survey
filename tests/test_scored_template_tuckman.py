from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# New starter template: Tuckman's stages of group development (forming,
# storming, norming, performing, adjourning), 20 statements (4 per stage,
# 1/2/3 scale, summed 4-12). Unlike the Five Dysfunctions template, a high
# score here isn't "healthy" -- it just means that stage is CURRENTLY
# PROMINENT, per the source assessment's own bands (10-12 prominent, 8-9
# emerging, 4-7 not characteristic). This exercises the whole existing
# pipeline (Stories 1-9) against a template with different shapes: 5
# dimensions x 4 statements (not 3) and different score thresholds
# (good:10, warn:8, not good:8, warn:6).

out_path = build_page(out_name="_test_tpl_tuckman.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    print("=== Tuckman template appears in the starter-templates list, alongside Five Dysfunctions ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    starter_rows = page.eval_on_selector_all('#tplList .tpl-row', 'els => els.map(e => e.textContent)')
    print("starter template rows:", [t[:60] for t in starter_rows])
    assert page.query_selector('#tplList .tpl-row[data-id="starter-tuckman"]') is not None
    assert page.query_selector('#tplList .tpl-row[data-id="starter-5dysfunctions"]') is not None

    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(300)
    print("errors after loading Tuckman template:", errors)

    tagline = page.eval_on_selector('#tagline', 'el => el.textContent') if page.query_selector('#tagline') else None
    print("active template name shown in header:", page.eval_on_selector('.title-block', 'el => el.textContent')[:200])

    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#startSessionBtn')
    page.wait_for_timeout(250)

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    dims = sorted(session_info["doc"]["dimensions"], key=lambda d: d.get("order", 0))
    dim_keys = [d["key"] for d in dims]
    print("session dims (should be the 5 Tuckman stages in order):", dim_keys)
    assert dim_keys == ["forming", "storming", "norming", "performing", "adjourning"]
    assert all(len(d["statements"]) == 4 for d in dims), "each stage should carry exactly 4 statements"
    assert all(d["scoreBands"] == {"good": 10, "warn": 8} for d in dims)

    # ============ participant device: full 20-statement form ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    good_out = build_page(seed_js, out_name="_test_tpl_tuckman_participant.html")

    pageA = browser.new_page(viewport={"width":420,"height":2600})
    errorsA = []
    pageA.on("pageerror", lambda e: errorsA.append(str(e)))
    pageA.goto("file://" + str(good_out.resolve()) + "?session=" + sid)
    pageA.wait_for_timeout(500)

    print("=== participant: 20 statements, one flat interleaved list, no per-stage headings ===")
    stmt_lists = pageA.query_selector_all('.stmt-list')
    assert len(stmt_lists) == 1
    stmt_rows = pageA.query_selector_all('.stmt-list .stmt-row')
    print("total statement rows (should be 20):", len(stmt_rows))
    assert len(stmt_rows) == 20
    form_field_labels = pageA.eval_on_selector_all('#stmtForm .field-label', 'els => els.map(e => e.textContent)')
    assert form_field_labels == []
    row_dims = pageA.eval_on_selector_all('.stmt-row', 'els => els.map(e => e.getAttribute("data-dim"))')
    print("dimension key per row, in display order:", row_dims)
    assert row_dims[:5] == ["forming", "storming", "norming", "performing", "adjourning"]
    assert row_dims[5:10] == ["forming", "storming", "norming", "performing", "adjourning"]
    assert len(row_dims) == 20

    # Answer to give: forming = [3,3,3,3] (sum 12, "prominent"/good);
    # storming = [1,1,1,1] (sum 4, "not characteristic"/crit);
    # norming = [2,2,2,2] (sum 8, "emerging"/warn, right at the boundary);
    # performing = [2,2,1,2] (sum 7, still crit -- one below the warn floor);
    # adjourning = [3,3,3,2] (sum 11, good)
    answer_plan = {
        "forming": [3,3,3,3],
        "storming": [1,1,1,1],
        "norming": [2,2,2,2],
        "performing": [2,2,1,2],
        "adjourning": [3,3,3,2],
    }
    for row in stmt_rows:
        dim = row.get_attribute("data-dim")
        idx = int(row.get_attribute("data-idx"))
        val = answer_plan[dim][idx]
        row.query_selector('.scale-btn[data-value="%d"]' % val).click()
    pageA.wait_for_timeout(100)
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False
    pageA.click('#stmtSubmitBtn')
    pageA.wait_for_timeout(250)

    print("=== personal results reflect the source assessment's own bands, not a health judgment ===")
    result_blocks = pageA.eval_on_selector_all('.personal-result', 'els => els.map(e => e.textContent)')
    for label, expected_score, expected_band in [
        ("Forming", "12", "Green"), ("Storming", "4", "Red"),
        ("Norming", "8", "Yellow"), ("Performing", "7", "Red"), ("Adjourning", "11", "Green"),
    ]:
        block = next(t for t in result_blocks if label in t)
        print(label, "->", block[:120])
        assert expected_score in block
        assert expected_band in block
    print("errors (participant):", errorsA)
    pageA.screenshot(path=str(test_output_path("shot_tpl_tuckman_results.png")), full_page=True)

    # ============ facilitator: mirror the response, flip to live ============
    stored = pageA.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    page.evaluate("""
      (function(){
        window.__FAKE_STORE__['sessions/%s/responses/r1'] = %s;
        window.__NOTIFY__('sessions/%s/responses');
      })();
    """ % (sid, json.dumps(stored), sid))
    page.wait_for_timeout(100)
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(200)
    row_texts = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    print("facilitator live rows:", row_texts)
    assert any("Storming" in t and "Red" in t for t in row_texts)
    assert any("Norming" in t and "Yellow" in t for t in row_texts)
    assert any("Performing" in t and "Red" in t for t in row_texts)
    assert any("Forming" in t and "Green" in t for t in row_texts)
    assert any("Adjourning" in t and "Green" in t for t in row_texts)
    print("errors (SM):", errors)
    page.screenshot(path=str(test_output_path("shot_tpl_tuckman_facilitator.png")), full_page=True)

    print("=== ALL ERRORS: SM=", errors, "participant=", errorsA)
    browser.close()
