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

    print("=== Tuckman template appears in the starter-templates list, alongside Five Dysfunctions ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "templates list rendered" signal instead of guessing.
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    starter_rows = page.eval_on_selector_all('#tplList .tpl-row', 'els => els.map(e => e.textContent)')
    print("starter template rows:", [t[:60] for t in starter_rows])
    assert page.query_selector('#tplList .tpl-row[data-id="starter-tuckman"]') is not None
    assert page.query_selector('#tplList .tpl-row[data-id="starter-5dysfunctions"]') is not None

    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    page.click('#confirmOk')
    # evaluate()/eval_on_selector() below don't auto-wait -- wait for the
    # real "Tuckman's dimensions landed" signal (loadTemplate()'s own
    # Promise chain) instead of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/forming'] !== undefined")
    print("errors after loading Tuckman template:", errors)

    tagline = page.eval_on_selector('#tagline', 'el => el.textContent') if page.query_selector('#tagline') else None
    print("active template name shown in header:", page.eval_on_selector('.title-block', 'el => el.textContent')[:200])

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#startSessionBtn')
    # evaluate() below doesn't auto-wait -- the fake store's set() writes
    # into __FAKE_STORE__ synchronously, but poll for the real condition
    # rather than assume that timing.
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/')).length === 1")

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    # SEC-2: joining uses the session's SECRET (?session=<secret>), not its
    # relay room id.
    secret = page.evaluate("SquadPulseRelay.secretForRoom(%r)" % sid)
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
    pageA.goto("file://" + str(good_out.resolve()) + "?session=" + secret)
    # query_selector_all() below doesn't auto-wait -- wait for the real
    # "join screen rendered the statement form" signal instead of guessing
    # how long boot + the session-doc fetch take.
    pageA.wait_for_selector('.stmt-list .stmt-row', state="attached")

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
    # eval_on_selector() below doesn't auto-wait -- poll for the real
    # "all 20 answered, submit enabled" condition, the same one asserted
    # right below, instead of guessing.
    pageA.wait_for_function("() => { var b = document.getElementById('stmtSubmitBtn'); return b && b.disabled === false; }")
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') == False
    pageA.click('#stmtSubmitBtn')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "personal results rendered" signal instead of guessing.
    pageA.wait_for_selector('.personal-result', state="attached")

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
    # No wait needed here -- window.__NOTIFY__() calls the fake store's
    # notify() SYNCHRONOUSLY (unlike a real onSnapshot's first delivery,
    # which the fixture delays), which synchronously updates
    # state.sessionResponses inside retro-facilitator.js's listener before
    # this evaluate() call even returns.
    page.click('.reveal-btn[data-reveal="live"]')
    # eval_on_selector_all() below doesn't auto-wait -- poll for the exact
    # expected content (the same condition asserted right below) instead of
    # guessing how long the click's re-render takes.
    page.wait_for_function("() => Array.from(document.querySelectorAll('.live-dim-row')).some(el => el.textContent.indexOf('Storming') !== -1 && el.textContent.indexOf('Red') !== -1)")
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

    # ============ Story 7: Tuckman's dimension content localizes live too ============
    # Same mechanism as Story 5's Spotify template (state.js's
    # localizedDimText()/localizedAttribution(), generalized in Stories 6-9
    # to look up whichever starter template is active by name): switching
    # to Hebrew shows Hebrew label/green/red/attribution immediately,
    # stored data stays English always, and the ALREADY-STARTED retro
    # session above (dimsSnapshot frozen at session start, participant-
    # facing statement survey) stays English -- the retro flow itself is
    # still untranslated (its own future story), same precedent already
    # established for the Spotify template.
    print("=== Story 7: Tuckman dimension content localizes live under Hebrew ===")
    page.click('.view-btn[data-view="admin"]')
    # setLocale() (i18n.js) is fully synchronous -- state, localStorage,
    # DOM re-render all happen inline in the click handler -- and this
    # evaluate() reads the store directly (unaffected by the UI's language
    # anyway), so no wait is needed for either click below.
    page.click('.lang-btn[data-lang="he"]')

    forming_doc_he = page.evaluate("window.__FAKE_STORE__['dimensions/forming']")
    print("stored 'forming' dimension under Hebrew (should stay English):", forming_doc_he)
    assert forming_doc_he["label"] == "Forming"

    page.click('.view-btn[data-view="tribe"]')
    page.click('#legendSummary')
    # eval_on_selector() below doesn't auto-wait, and expanding a native
    # <details> is a synchronous browser toggle -- the legend content was
    # already rendered (and attached, just collapsed) by renderLegend(),
    # not populated lazily on open.
    page.wait_for_selector('.legend-item .lh', state="attached")
    forming_label_he = page.eval_on_selector('.legend-item .lh', 'el=>el.textContent')
    attribution_he = page.eval_on_selector('#legendAttrib', 'el=>el.textContent')
    print("Tribe legend under Hebrew -- first dimension label / attribution:", forming_label_he, "|", attribution_he)
    assert forming_label_he.strip() and forming_label_he != "Forming"
    assert attribution_he.strip() and "Bruce Tuckman" not in attribution_he

    print("=== the already-started retro session stays English (its own future story) ===")
    stmt_row_dim_labels = pageA.eval_on_selector_all('.personal-result', 'els=>els.map(e=>e.textContent)')
    print("participant's personal results (should still read English -- frozen at session start):", [t[:30] for t in stmt_row_dim_labels])
    assert any("Forming" in t for t in stmt_row_dim_labels)

    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')
    print("errors:", errors)
    browser.close()
