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

out_path = build_page(out_name="_test_retro_note_finish.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    # eval_on_selector()/click() below don't auto-wait for a not-yet-
    # attached element -- wait for the real "templates list rendered"
    # signal instead of guessing.
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "Five
    # Dysfunctions' dimensions landed" signal (loadTemplate()'s own Promise
    # chain) instead of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/trust'] !== undefined")

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')

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
    dim_keys = [d["key"] for d in session_info["doc"]["dimensions"]]
    print("=== session started ===", sid, dim_keys)
    print("experimentNote defaults to empty string:", repr(session_info["doc"].get("experimentNote")))
    assert session_info["doc"].get("experimentNote") == ""

    print("=== Story 8: writing and saving the sprint-experiment note ===")
    note_text = "Pair on the riskiest story every day this sprint"
    page.fill('#experimentNoteBox', note_text)
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    page.click('#saveExperimentNoteBtn')
    # saveExperimentNote() (retro-facilitator.js) writes to the store
    # synchronously here -- but a report surfaced an intermittent failure of
    # this exact click/read pair on a different machine/Chromium build (see
    # STATUS.md); rather than assume the synchronous timing holds in every
    # environment, poll for the real write landing like every other write
    # in this file already does.
    page.wait_for_function(
        "([sid, expected]) => window.__FAKE_STORE__['sessions/' + sid] && window.__FAKE_STORE__['sessions/' + sid].experimentNote === expected",
        arg=[sid, note_text],
    )
    stored_note = page.evaluate("window.__FAKE_STORE__['sessions/%s'].experimentNote" % sid)
    print("stored note:", stored_note)
    assert stored_note == note_text
    hint_visible = page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False
    print("'Saved' hint shown right after clicking Save:", hint_visible)
    assert hint_visible
    # saving must NOT blow away the textarea or steal further typing --
    # the whole card wasn't re-rendered by this button, just the hint toggled
    assert page.eval_on_selector('#experimentNoteBox', 'el => el.value') == note_text
    print("errors:", errors)

    print("=== Story 9: 'Finish retro' with nothing submitted just closes, no squad changes ===")
    page.click('#finishSessionBtn')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    confirm_msg_empty = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message with zero submissions/overrides:", confirm_msg_empty)
    assert "won" in confirm_msg_empty and "change" in confirm_msg_empty
    # closeConfirm() is a synchronous hidden-attribute toggle with no store
    # write -- #closeSessionBtn's presence is unaffected by it either way,
    # so no wait is needed before the query_selector below.
    page.click('#confirmCancel')
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
    # No wait needed here -- window.__NOTIFY__() calls the fake store's
    # notify() SYNCHRONOUSLY (unlike a real onSnapshot's first delivery,
    # which the fixture delays), which synchronously updates
    # state.sessionResponses inside retro-facilitator.js's listener before
    # this evaluate() call even returns.
    #
    # Same reasoning for the reveal-mode click below: unlike a real relay
    # (where the write genuinely round-trips before this device's own
    # listener reflects it -- see test_board_sync_finish_retro_convergence.py),
    # this fake store's ongoing sessions listener (subscribed once at boot
    # in db.js) fires synchronously on every .update(), so
    # setRevealMode()'s write and the resulting re-render (including the
    # .override-btn the next click needs) are both already done by the
    # time click() returns.
    page.click('.reveal-btn[data-reveal="live"]')

    # manually override 'results' (Inattention to Results) to Yellow/improving,
    # even though every response scored it green -- this is exactly the "team
    # can choose the more severe (or different) read by hand" escape hatch
    page.click('.override-btn[data-override-dim="results"]')
    page.wait_for_selector('#backdrop', state="visible")  # real modal-open signal, not a guess
    page.click('.swatch[data-color="warn"]')
    page.click('#trendsel button[data-trend="up"]')
    # setSessionOverride() (retro-facilitator.js) writes to the store and
    # re-renders synchronously, same reasoning as above -- no wait needed
    # before the next click.
    page.click('#modalSave')

    print("=== finishing now shows a real summary and, on confirm, writes to the squad ===")
    page.click('#finishSessionBtn')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    confirm_msg = page.eval_on_selector('#confirmMessage', 'el => el.textContent')
    print("confirm message with real results:", confirm_msg)
    assert "Absence of Trust: Green" in confirm_msg
    assert "Inattention to Results: Yellow (overridden)" in confirm_msg
    page.click('#confirmOk')
    # evaluate()/eval_on_selector() below don't auto-wait -- poll for the
    # real "finishRetroAndApply() landed" signal (it writes to the squad's
    # dimensions and closes the session synchronously) instead of guessing.
    page.wait_for_function("() => { var d = window.__FAKE_STORE__['squads/squad-1'].dimensions; return d.results && d.results.color === 'warn' && d.results.trend === 'up'; }")

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
    page.screenshot(path=str(test_output_path("shot_retro_note_finish.png")), full_page=True)

    print("=== ALL ERRORS:", errors)
    browser.close()
