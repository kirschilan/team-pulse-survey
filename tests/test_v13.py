from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Bug fix: the Spotify Squad Health Check dimensions (the board's own default
# set -- no `statements`, just a direct green/yellow/red pick) were never
# actually answerable by a teammate in Retro mode. scoredDimensions() only
# ever returned dimensions WITH statements, so the join screen fell through
# to a permanent read-only listing ("Your Scrum Master will let you know
# when to answer") for any template built entirely of direct-rating
# dimensions -- only the facilitator could rate those, by hand, on the squad
# view. This test exercises the fix end to end: a teammate submits direct
# swatch picks for every dimension, responses consolidate the same way
# statement-based ones do, the facilitator can override and finish the
# retro, and the result lands in the squad's real ratings.

out_path = build_page(out_name="_test_v13.html")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")

    # ============ SM device: default (Spotify) template, start a session ============
    page = browser.new_page(viewport={"width":1280,"height":1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

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
    dims = session_info["doc"]["dimensions"]
    dim_keys = [d["key"] for d in dims]
    print("=== session started on the default Spotify-style template ===", sid, dim_keys)
    assert session_info["doc"]["templateName"] == "Spotify Squad Health Check"
    assert all(not d.get("statements") for d in dims), "every dimension here should be direct-rating (no statements)"

    print("=== facilitator card now shows live/hold + a Finish button even though nothing has statements ===")
    assert page.query_selector('.reveal-toggle') is not None
    assert page.query_selector('#finishSessionBtn') is not None

    # ============ participant device: full direct-rating form ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    join_out = build_page(seed_js, out_name="_test_v13_join.html")

    pageA = browser.new_page(viewport={"width":420,"height":2600})
    errorsA = []
    pageA.on("pageerror", lambda e: errorsA.append(str(e)))
    pageA.goto("file://" + str(join_out.resolve()) + "?session=" + sid)
    pageA.wait_for_timeout(500)

    print("=== participant: no statement list at all, one direct-rating row per dimension, openly labeled ===")
    assert pageA.query_selector('.stmt-list') is None, "this template has no statement dimensions -- no blind survey block should render"
    direct_rows = pageA.query_selector_all('.direct-row')
    print("direct-rating rows (should be", len(dim_keys), "):", len(direct_rows))
    assert len(direct_rows) == len(dim_keys)
    row_labels = pageA.eval_on_selector_all('.direct-row .stmt-text', 'els => els.map(e => e.textContent)')
    print("row labels (should be the real dimension names, not hidden):", row_labels)
    assert set(row_labels) == set(d["label"] for d in dims)
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == True

    # answer every dimension except leave the last one blank, to confirm
    # Submit stays disabled until every direct pick is made too
    for row in direct_rows[:-1]:
        row.query_selector('.swatch.good').click()
        pageA.wait_for_timeout(15)
    print("submit still disabled with one dimension unanswered:", pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled'))
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == True

    # last dimension: pick red instead of green, so the response isn't just uniform
    last_row = direct_rows[-1]
    last_dim_key = last_row.get_attribute("data-dim")
    last_row.query_selector('.swatch.crit').click()
    pageA.wait_for_timeout(50)
    print("submit enabled once every dimension has a pick:", pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False)
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False

    pageA.click('#stmtSubmitBtn')
    pageA.wait_for_timeout(250)

    stored = pageA.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    print("stored response answers (each value should be a plain color, not an array):", stored["answers"])
    for k, v in stored["answers"].items():
        assert v in ("good", "warn", "crit")
    assert stored["answers"][last_dim_key] == "crit"

    print("=== participant: personal results show a pill but no numeric score for a direct-rating dimension ===")
    result_blocks = pageA.query_selector_all('.personal-result')
    print("personal-result blocks (should be", len(dim_keys), "):", len(result_blocks))
    assert len(result_blocks) == len(dim_keys)
    scores = pageA.eval_on_selector_all('.personal-result .result-score', 'els => els.map(e => e.textContent)')
    print("numeric score badges present (should be none):", scores)
    assert scores == []
    pills = pageA.eval_on_selector_all('.personal-result .pill', 'els => els.map(e => e.textContent.trim())')
    print("pills:", pills)
    assert pills.count("Green") == len(dim_keys) - 1
    assert pills.count("Red") == 1
    print("errors (participant):", errorsA)
    pageA.screenshot(path=str(test_output_path("shot_v13_direct_results.png")), full_page=True)

    # ============ facilitator: mirror the response, flip to live, override, finish ============
    page.evaluate("""
      (function(){
        window.__FAKE_STORE__['sessions/%s/responses/r1'] = %s;
        window.__NOTIFY__('sessions/%s/responses');
      })();
    """ % (sid, json.dumps(stored), sid))
    page.wait_for_timeout(100)
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(200)

    print("=== facilitator sees consolidated direct-rating results, can still override by hand ===")
    row_texts = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    print("facilitator live rows:", row_texts)
    assert len(row_texts) == len(dim_keys)
    last_dim_label = [d["label"] for d in dims if d["key"]==last_dim_key][0]
    assert any(last_dim_label in t and "Red" in t for t in row_texts)

    page.click('.override-btn[data-override-dim="' + last_dim_key + '"]')
    page.wait_for_timeout(150)
    squadline = page.eval_on_selector('#modalSquadline', 'el => el.textContent')
    print("override modal squadline:", squadline)
    assert "overrid" in squadline.lower()
    page.click('.swatch[data-color="warn"]')
    page.click('#modalSave')
    page.wait_for_timeout(150)
    row_texts_after_override = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    print("row after override:", [t for t in row_texts_after_override if last_dim_label in t])
    assert any(last_dim_label in t and "Overridden" in t and "Yellow" in t for t in row_texts_after_override)
    print("errors (SM):", errors)

    print("=== finishing the retro writes the direct-rating results into the squad's real ratings ===")
    page.click('#finishSessionBtn')
    page.wait_for_timeout(150)
    confirm_msg = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message:", confirm_msg)
    assert last_dim_label + ": Yellow (overridden)" in confirm_msg
    page.click('#confirmOk')
    page.wait_for_timeout(250)

    final_dims = page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions")
    print("squad-1 dimensions after finishing:", final_dims)
    assert final_dims[last_dim_key]["color"] == "warn"
    other_keys = [k for k in dim_keys if k != last_dim_key]
    assert all(final_dims[k]["color"] == "good" for k in other_keys)
    result_cell_class = page.eval_on_selector('.cell-btn[data-dim="' + last_dim_key + '"]', 'el => el.className')
    print("overridden dimension's cell-btn class on the squad view (should show 'warn'):", result_cell_class)
    assert "warn" in result_cell_class
    print("errors (SM):", errors)
    page.screenshot(path=str(test_output_path("shot_v13_finished_squad.png")), full_page=True)

    print("=== ALL ERRORS: SM=", errors, "participant=", errorsA)
    browser.close()
