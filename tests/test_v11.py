from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 8: a shared free-text "sprint experiment" note on the session,
# saved explicitly (not per-keystroke, since the sessions listener
# re-renders the whole card on every remote change and would otherwise
# steal focus mid-typing).
#
# Story 9: finishing a retro writes the (possibly overridden) consolidated
# result for each scored dimension into the squad's own rating -- the same
# field the rest of the board (including Tribe view) already reads -- then
# closes the session. A plain "Close session" with nothing to apply should
# still just close without touching the squad's ratings.

out_path = build_page(out_name="_test_v11.html")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    page = browser.new_page(viewport={"width":1280,"height":1400})
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

    # squad-1 shouldn't have any existing ratings yet on a freshly loaded
    # template -- confirm the baseline so the "did finishing actually write"
    # check later is meaningful
    baseline = page.evaluate("""
      (function(){
        var sq = window.__FAKE_STORE__['squads/squad-1'];
        return sq ? sq.dimensions : null;
      })();
    """)
    print("baseline squad-1 dimensions before any retro:", baseline)

    page.click('#startSessionBtn')
    page.wait_for_timeout(250)

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    dim_keys = [d["key"] for d in session_info["doc"]["dimensions"]]
    print("=== session started ===", sid, dim_keys)
    print("experimentNote defaults to empty string:", repr(session_info["doc"].get("experimentNote")))
    assert session_info["doc"].get("experimentNote") == ""

    print("=== Story 8: writing and saving the sprint-experiment note ===")
    page.fill('#experimentNoteBox', "Pair on the riskiest story every day this sprint")
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    page.click('#saveExperimentNoteBtn')
    page.wait_for_timeout(150)
    stored_note = page.evaluate("window.__FAKE_STORE__['sessions/%s'].experimentNote" % sid)
    print("stored note:", stored_note)
    assert stored_note == "Pair on the riskiest story every day this sprint"
    hint_visible = page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False
    print("'Saved' hint shown right after clicking Save:", hint_visible)
    assert hint_visible
    # saving must NOT blow away the textarea or steal further typing --
    # the whole card wasn't re-rendered by this button, just the hint toggled
    assert page.eval_on_selector('#experimentNoteBox', 'el => el.value') == "Pair on the riskiest story every day this sprint"
    print("errors:", errors)

    print("=== Story 9: 'Finish retro' with nothing submitted just closes, no squad changes ===")
    page.click('#finishSessionBtn')
    page.wait_for_timeout(150)
    confirm_msg_empty = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message with zero submissions/overrides:", confirm_msg_empty)
    assert "won" in confirm_msg_empty and "change" in confirm_msg_empty
    page.click('#confirmCancel')
    page.wait_for_timeout(100)
    # session should still be open since we cancelled
    assert page.query_selector('#closeSessionBtn') is not None

    print("=== seed 3 responses (trust: 2 good/1 crit) and override 'results' by hand ===")
    responses = [
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,3]) for k in dim_keys}},
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,3]) for k in dim_keys}},
        {"answers": {k: ([3,3,3] if k!="trust" else [1,1,1]) for k in dim_keys}},
    ]
    page.evaluate("""
      (function(responses){
        responses.forEach(function(r, i){
          window.__FAKE_STORE__['sessions/%s/responses/r'+i] = r;
        });
        window.__NOTIFY__('sessions/%s/responses');
      })(%s);
    """ % (sid, sid, json.dumps(responses)))
    page.wait_for_timeout(150)
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(150)

    # manually override 'results' (Inattention to Results) to Yellow/improving,
    # even though every response scored it green -- this is exactly the "team
    # can choose the more severe (or different) read by hand" escape hatch
    page.click('.override-btn[data-override-dim="results"]')
    page.wait_for_timeout(150)
    page.click('.swatch[data-color="warn"]')
    page.click('#trendsel button[data-trend="up"]')
    page.click('#modalSave')
    page.wait_for_timeout(150)

    print("=== finishing now shows a real summary and, on confirm, writes to the squad ===")
    page.click('#finishSessionBtn')
    page.wait_for_timeout(150)
    confirm_msg = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message with real results:", confirm_msg)
    assert "Absence of Trust: Green" in confirm_msg
    assert "Inattention to Results: Yellow (overridden)" in confirm_msg
    page.click('#confirmOk')
    page.wait_for_timeout(250)

    print("=== session is gone, squad's ratings now reflect the retro ===")
    assert page.query_selector('#closeSessionBtn') is None
    assert page.query_selector('#startSessionBtn') is not None

    final_dims = page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions")
    print("squad-1 dimensions after finishing:", final_dims)
    assert final_dims["trust"]["color"] == "good"
    assert final_dims["conflict"]["color"] == "good"
    assert final_dims["commitment"]["color"] == "good"
    assert final_dims["accountability"]["color"] == "good"
    assert final_dims["results"]["color"] == "warn"
    assert final_dims["results"]["trend"] == "up"

    # the squad-view cell buttons should visibly reflect this immediately too
    result_cell_class = page.eval_on_selector('.cell-btn[data-dim="results"]', 'el => el.className')
    print("results cell-btn class after finishing (should show 'warn'):", result_cell_class)
    assert "warn" in result_cell_class
    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_v11_finished_squad.png")), full_page=True)

    print("=== ALL ERRORS:", errors)
    browser.close()
