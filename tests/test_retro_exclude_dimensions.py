from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# RETRO-3 (STATUS.md's "Facilitated retro backlog"): lets a facilitator
# deselect specific dimensions before starting a session -- a one-off skip
# for THIS retro only, never a template edit. The fix is deliberately
# scoped to whole-DIMENSION exclusion, not individual statements within a
# statement dimension: a statement dimension's scoreBands are calibrated
# against summing ALL of its statements, so silently dropping only some of
# them would quietly shift what "good"/"warn"/"crit" mean without anyone
# choosing that. Excluding a whole dimension has no such problem.
#
# Implementation shape: startSession() filters the dimension snapshot
# BEFORE it's ever written into the session doc, so every downstream
# consumer (the join survey, pacingSequence(), the live tally,
# finishRetroAndApply()) needs zero changes of its own -- an excluded
# dimension was simply never in sess.dimensions to begin with. This test
# exercises the checklist UI, confirms the excluded dimension never reaches
# either device, and confirms finishing only writes ratings for the
# dimensions that were actually included.

out_path = build_page(out_name="_test_retro_exclude_dims_sm.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ SM device: default (Spotify) template, three direct-rating dims ============
    page = browser.new_page(viewport={"width":1280,"height":1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')

    print("=== facilitator: a checklist checkbox exists per board dimension, all checked by default ===")
    checkboxes = page.query_selector_all('.dim-include-checkbox')
    assert len(checkboxes) == 3, "the default fixture has 3 dimensions (release/process/value)"
    keys = [cb.get_attribute('data-dim-key') for cb in checkboxes]
    print("checklist keys:", keys)
    assert set(keys) == {"release", "process", "value"}
    assert all(page.eval_on_selector('.dim-include-checkbox[data-dim-key="%s"]' % k, 'el => el.checked') for k in keys)
    assert page.eval_on_selector('#startSessionBtn', 'el => el.disabled') is False

    print("=== opening the collapsible checklist so its checkboxes are interactable ===")
    page.click('.session-card details summary')

    print("=== unchecking every dimension disables Start and shows the 'select at least one' hint ===")
    for k in keys:
        page.uncheck('.dim-include-checkbox[data-dim-key="%s"]' % k)
    assert page.eval_on_selector('#startSessionBtn', 'el => el.disabled') is True
    assert page.eval_on_selector('#dimSelectHint', 'el => el.hidden') is False

    print("=== re-checking release and process (leaving value excluded) re-enables Start ===")
    page.check('.dim-include-checkbox[data-dim-key="release"]')
    page.check('.dim-include-checkbox[data-dim-key="process"]')
    assert page.eval_on_selector('#startSessionBtn', 'el => el.disabled') is False
    assert page.eval_on_selector('#dimSelectHint', 'el => el.hidden') is True

    page.click('#startSessionBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/')).length === 1")

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    secret = page.evaluate("SquadPulseRelay.secretForRoom(%r)" % sid)
    dims = session_info["doc"]["dimensions"]
    dim_keys = [d["key"] for d in dims]
    print("=== session's own dimensions snapshot excludes 'value' entirely ===", dim_keys)
    assert set(dim_keys) == {"release", "process"}, "the excluded dimension must never reach the session doc"

    print("=== facilitator card shows a Finish button and no trace of the excluded dimension ===")
    assert page.query_selector('#finishSessionBtn') is not None

    # ============ participant device: only the two included dimensions appear ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    join_out = build_page(seed_js, out_name="_test_retro_exclude_dims_participant.html")

    pageA = browser.new_page(viewport={"width":420,"height":2000})
    errorsA = []
    pageA.on("pageerror", lambda e: errorsA.append(str(e)))
    pageA.goto("file://" + str(join_out.resolve()) + "?session=" + secret)
    pageA.wait_for_selector('.direct-row', state="attached")

    print("=== participant: exactly the two included dimensions, the excluded one is nowhere in the DOM ===")
    direct_rows = pageA.query_selector_all('.direct-row')
    row_dim_keys = [r.get_attribute('data-dim') for r in direct_rows]
    print("participant row dim keys:", row_dim_keys)
    assert set(row_dim_keys) == {"release", "process"}
    assert pageA.query_selector('.direct-row[data-dim="value"]') is None

    for row in direct_rows:
        row.query_selector('.swatch.good').click()
    assert pageA.eval_on_selector('#stmtSubmitBtn', 'el => el.disabled') is False
    pageA.click('#stmtSubmitBtn')
    pageA.wait_for_selector('.personal-result', state="attached")

    result_blocks = pageA.query_selector_all('.personal-result')
    print("participant personal-result blocks (should be 2, not 3):", len(result_blocks))
    assert len(result_blocks) == 2

    stored = pageA.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    print("stored response answer keys (should not include 'value'):", list(stored["answers"].keys()))
    assert set(stored["answers"].keys()) == {"release", "process"}

    # ============ facilitator: finishing only applies ratings for the included dimensions ============
    page.evaluate("""
      (function(){
        window.__FAKE_STORE__['sessions/%s/responses/r1'] = %s;
        window.__NOTIFY__('sessions/%s/responses');
      })();
    """ % (sid, json.dumps(stored), sid))
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_selector('.live-dim-row', state="attached")

    live_rows = page.query_selector_all('.live-dim-row')
    print("facilitator live rows (should be 2, not 3):", len(live_rows))
    assert len(live_rows) == 2
    assert page.query_selector('.override-btn[data-override-dim="value"]') is None

    page.click('#finishSessionBtn')
    page.wait_for_selector('#confirmBackdrop', state="visible")
    confirm_msg = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message (should mention only release/process):", confirm_msg)
    assert "value" not in confirm_msg.lower()
    page.click('#confirmOk')
    page.wait_for_function("() => { var d = window.__FAKE_STORE__['squads/squad-1'].dimensions['release']; return d && d.color === 'good'; }")

    final_dims = page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions")
    print("squad-1 dimensions after finishing:", final_dims)
    assert final_dims.get("release", {}).get("color") == "good"
    assert final_dims.get("process", {}).get("color") == "good"
    assert "value" not in final_dims, "the excluded dimension must not be touched at all by finishing"

    print("=== ALL ERRORS: SM=", errors, "participant=", errorsA)
    page.screenshot(path=str(test_output_path("shot_retro_exclude_dims_finished.png")), full_page=True)
    browser.close()
