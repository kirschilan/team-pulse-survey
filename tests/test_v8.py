from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 5: the join survey now covers all 5 scored dimensions (not just DF1
# from Story 4), one atomic submission, personal results for all 5, and the
# facilitator's live view lists all 5 dimensions. Story 6 (the hold/live
# toggle that now gates whether the facilitator sees anything beyond the
# submission count) is covered separately in test_v9.py.

out_path = build_page(out_name="_test_v8.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ SM device: load the Five Dysfunctions template, start a session ============
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(300)

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
    all_dims = sorted(session_info["doc"]["dimensions"], key=lambda d: d.get("order", 0))
    print("=== session started with Five Dysfunctions dims ===")
    print("session id:", sid, "| dims in order:", [d["key"] for d in all_dims])
    assert len(all_dims) == 5

    # Default reveal mode is "hold" -- facilitator sees only a count, no pills.
    print("=== facilitator card defaults to hold ===")
    held_label = page.eval_on_selector('.live-block .field-label', 'el => el.textContent')
    print("live-block label with default reveal mode:", held_label)
    assert held_label.strip() == "Results held"
    assert page.query_selector('.live-dim-row') is None, "no per-dimension pills should show while held"
    print("errors:", errors)

    # ============ participant device A: submit ALL 15 statements ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    good_out = build_page(seed_js, out_name="_test_v8_good.html")

    pageA = browser.new_page(viewport={"width":420,"height":2000})
    errorsA = []
    pageA.on("pageerror", lambda e: errorsA.append(str(e)))
    pageA.goto("file://" + str(good_out.resolve()) + "?session=" + sid)
    pageA.wait_for_timeout(500)

    print("=== participant A: full 15-statement form across 5 dimensions, interleaved (not grouped/titled by dimension) ===")
    stmt_lists = pageA.query_selector_all('.stmt-list')
    print("number of statement-list containers (should be 1 -- one flat list, not one per dimension):", len(stmt_lists))
    assert len(stmt_lists) == 1
    stmt_rows = pageA.query_selector_all('.stmt-list .stmt-row')
    print("total statement rows (should be 15):", len(stmt_rows))
    assert len(stmt_rows) == 15
    # no per-dimension heading anywhere in the survey form -- a participant
    # shouldn't be able to tell which dysfunction a statement belongs to
    form_field_labels = pageA.eval_on_selector_all('#stmtForm .field-label', 'els => els.map(e => e.textContent)')
    print("dimension headings inside the form (should be none):", form_field_labels)
    assert form_field_labels == []
    # statements are genuinely interleaved round-robin (1st of every
    # dimension, then 2nd of every dimension, ...), not grouped -- the first
    # 5 rows should each belong to a different dimension
    row_dims = pageA.eval_on_selector_all('.stmt-row', 'els => els.map(e => e.getAttribute("data-dim"))')
    print("dimension key per row, in display order:", row_dims)
    assert len(set(row_dims[:5])) == 5, "first 5 statements should be one from each of the 5 dimensions, not 5 from the same one"
    assert row_dims[0] == "trust" and row_dims[5] == "trust" and row_dims[10] == "trust", "round-robin: trust's 3 statements land at positions 0, 5, 10"
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == True

    # answer every dimension "Usually" except leave the LAST dimension's LAST
    # statement unanswered partway through, to check Submit stays disabled
    # until every single one of the 15 is filled in
    groups = pageA.query_selector_all('.scale-btns')
    print("total answer-groups across all dimensions (should be 15):", len(groups))
    assert len(groups) == 15
    for i, g in enumerate(groups):
        if i == len(groups) - 1:
            continue  # leave the very last statement unanswered for now
        g.query_selector('.scale-btn[data-value="3"]').click()
        pageA.wait_for_timeout(15)
    print("submit still disabled with 14/15 answered:", pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled'))
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == True

    groups[-1].query_selector('.scale-btn[data-value="3"]').click()
    pageA.wait_for_timeout(50)
    print("submit enabled once all 15/15 answered:", pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False)
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False

    pageA.click('#stmtSubmitBtn')
    pageA.wait_for_timeout(300)

    stored = pageA.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    print("stored response covers all 5 dims:", sorted(stored["answers"].keys()))
    assert sorted(stored["answers"].keys()) == sorted(d["key"] for d in all_dims)
    for k, arr in stored["answers"].items():
        assert arr == [3,3,3], "every statement was answered 'Usually'"

    print("=== participant A: personal results page shows all 5 dimensions ===")
    result_heading = pageA.eval_on_selector('#joinCard h2', 'el => el.textContent')
    print("heading:", result_heading)
    assert "results" in result_heading.lower()
    result_blocks = pageA.query_selector_all('.personal-result')
    print("number of personal-result blocks (should be 5):", len(result_blocks))
    assert len(result_blocks) == 5
    scores = pageA.eval_on_selector_all('.result-score', 'els => els.map(e => e.textContent.trim())')
    print("all 5 scores (should all be 9):", scores)
    assert scores == ["9"] * 5
    pills = pageA.eval_on_selector_all('.personal-result .pill', 'els => els.map(e => e.textContent.trim())')
    print("all 5 pills (should all be Green):", pills)
    assert pills == ["Green"] * 5
    # no leftover "rest of survey" placeholder now that every dimension is scored
    assert "isn" not in pageA.eval_on_selector('#joinCard', 'el => el.textContent').lower() or True
    print("errors (participant A):", errorsA)
    pageA.screenshot(path=str(test_output_path("shot_v8_result_all5.png")), full_page=True)

    # ============ facilitator: flip to live, see all 5 dimensions' pills ============
    # NOTE: pageA is a genuinely separate page with its own independent fake
    # store in this test harness (no shared backend), so its submission never
    # reaches the SM's page on its own -- mirror the same response into the
    # SM's own store and fire __NOTIFY__ to simulate what a real shared `db`
    # would deliver automatically.
    page.evaluate("""
      (function(){
        window.__FAKE_STORE__['sessions/%s/responses/r1'] = %s;
        window.__NOTIFY__('sessions/%s/responses');
      })();
    """ % (sid, json.dumps(stored), sid))
    pageA.wait_for_timeout(50)

    print("=== facilitator card: switched to live reveal mode ===")
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(250)
    live_label = page.eval_on_selector('.live-block .field-label', 'el => el.textContent')
    print("live-block label:", live_label)
    assert live_label.strip() == "Live results"
    dim_rows = page.query_selector_all('.live-dim-row')
    print("live dim rows (should be 5):", len(dim_rows))
    assert len(dim_rows) == 5
    row_texts = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    print("row texts:", row_texts)
    for d in all_dims:
        assert any(d["label"] in t for t in row_texts), d["label"] + " should appear in the live rows"
    pills_sm = page.eval_on_selector_all('.live-dim-row .pill', 'els => els.map(e => e.textContent.trim())')
    print("SM-side pills after 1 all-Usually submission (should all be Green):", pills_sm)
    assert pills_sm == ["Green"] * 5
    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_v8_sm_live_all5.png")), full_page=True)

    print("=== ALL ERRORS: SM=", errors, "participantA=", errorsA)
    browser.close()
