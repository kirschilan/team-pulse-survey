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
    page.wait_for_function("() => state.live === true && !!state.db")

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
    page.wait_for_function(
      "sid => state.sessions.some(s => s.id === sid)",
      arg=sid,
    )
    # Starting the session synchronously renders the session card, which
    # subscribes a FRESH responses-subcollection listener for this session
    # (retro-facilitator.js's subscribeSessionResponses(), created once per
    # new session id). The fake store (tests/fixtures/fake_store.html)
    # delivers that listener's first snapshot via setTimeout(..., 10) --
    # and its callback re-renders the whole squad view, which would
    # overwrite the textarea with the still-empty stored note if that
    # delivery lands after fill() but before Save is clicked. Wait for that
    # exact, named delivery (fake_store.html's per-path delivery counter)
    # instead of guessing at a duration -- see STATUS.md for the review
    # that caught the previous fix here waiting on the wrong listener.
    responses_path = "sessions/%s/responses" % sid
    page.wait_for_function(
      "path => window.__FAKE_STORE_DELIVERY_COUNTS__ && window.__FAKE_STORE_DELIVERY_COUNTS__[path] >= 1",
      arg=responses_path,
    )
    dim_keys = [d["key"] for d in session_info["doc"]["dimensions"]]
    print("=== session started ===", sid, dim_keys)
    print("experimentNote defaults to empty string:", repr(session_info["doc"].get("experimentNote")))
    assert session_info["doc"].get("experimentNote") == ""

    print("=== Story 8: writing and saving the sprint-experiment note ===")
    note_text = "Pair on the riskiest story every day this sprint"
    page.fill('#experimentNoteBox', note_text)
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    page.click('#saveExperimentNoteBtn')
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

    print("=== PO review follow-up: 'Saved' must be a durable state, not a timed flash that can be missed ===")
    # Deliberate real-time wait, not a guessed one -- this specifically
    # proves the ABSENCE of the old 1.8s auto-hide timer, which is not
    # something any event/state change can signal; waiting past that
    # duration is the only way to distinguish "still shown" from "about to
    # disappear on its own."
    page.wait_for_timeout(2200)
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False, \
        "'Saved' must stay visible indefinitely, not auto-hide after a fixed delay"

    print("=== an UNRELATED re-render (e.g. a live sessions update) must not wipe the 'Saved' indication ===")
    # window.__NOTIFY__() fires the sessions collection listener exactly like
    # a real remote change would -- see RETRO-3's own use of this same
    # mechanism (Codex review on PR #34) for a dimensions listener causing
    # an identical class of "hardcoded markup state lost on re-render" bug.
    page.evaluate("window.__NOTIFY__('sessions')")
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False, \
        "'Saved' must survive an unrelated re-render, derived from state rather than hardcoded in the markup"
    assert page.eval_on_selector('#experimentNoteBox', 'el => el.value') == note_text

    print("=== editing the note again (making it dirty) hides 'Saved' until the next save ===")
    page.fill('#experimentNoteBox', note_text + " -- plus more")
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    # restore the original note_text afterward -- later assertions in this
    # file check the finished retro's own lastRetro.experimentNote against
    # this same note_text, and this scenario's only job is to prove the
    # dirty/saved toggle, not to change what the rest of the test expects.
    page.fill('#experimentNoteBox', note_text)
    page.click('#saveExperimentNoteBtn')
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False

    print("=== Codex review (PR #35): a rejected save must NOT show 'Saved' ===")
    # Force exactly ONE upcoming sessions/<id>.update() call to reject, the
    # same shape a real failed relay write rejects with -- without deleting
    # the doc from the store (that would also drop the session from the
    # sessions collection listener's next snapshot, conflating "the write
    # failed" with "the session disappeared", two different things). This
    # reproduces Codex's finding: the save handler used to mark the note
    # "saved" and record it in savedExperimentNoteFor without ever awaiting
    # the write's own promise.
    page.evaluate("""
      (function(){
        var origCollection = state.db.collection.bind(state.db);
        state.db.collection = function(name){
          var c = origCollection(name);
          if(name !== "sessions") return c;
          var origDoc = c.doc.bind(c);
          c.doc = function(id){
            var d = origDoc(id);
            d.update = function(){
              state.db.collection = origCollection; // one-shot failure
              return Promise.reject({code:"unavailable", message:"simulated write failure"});
            };
            return d;
          };
          return c;
        };
      })();
    """)
    failed_text = note_text + " -- offline attempt"
    page.fill('#experimentNoteBox', failed_text)
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    page.click('#saveExperimentNoteBtn')
    # real signal for "the rejected save's own .catch() ran", not a guess
    page.wait_for_selector('#expNoteSaveErrorHint', state="visible")
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True, \
        "'Saved' must never show for a save that was never acknowledged as persisted"
    assert page.eval_on_selector('#experimentNoteBox', 'el => el.value') == failed_text
    # noteSaveFailedFor (retro-facilitator.js, next to savedExperimentNoteFor)
    # is what keeps this failure hint from being hardcoded `hidden` in the
    # markup -- read directly rather than forcing a re-render to prove it,
    # since a re-render while the box holds unsaved, un-persisted text also
    # resets the textarea to the last-persisted server value (a separate,
    # pre-existing "state lost on re-render" gap this fix doesn't extend to
    # closing -- see STATUS.md).
    assert page.evaluate("noteSaveFailedFor['%s']" % sid) == True

    print("=== once the write can succeed again, saving clears the failure and shows 'Saved' ===")
    page.fill('#experimentNoteBox', note_text)
    page.click('#saveExperimentNoteBtn')
    page.wait_for_function(
      "([sid, expected]) => window.__FAKE_STORE__['sessions/' + sid] && window.__FAKE_STORE__['sessions/' + sid].experimentNote === expected",
      arg=[sid, note_text],
    )
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False
    assert page.eval_on_selector('#expNoteSaveErrorHint', 'el => el.hidden') == True

    print("=== Codex review (PR #35, second pass): 'Saved' must not appear over newer, unsaved edits ===")
    # Hold the next sessions/<id>.update() call pending (never resolving on
    # its own) instead of letting it complete immediately, so a real edit can
    # land in the window between "save clicked" and "save acknowledged" --
    # exactly the sequence Codex reproduced: save A, edit to B before A's
    # write completes, then A's write lands. Applies the patch directly to
    # the fake store on resolution WITHOUT calling notify()/notifyDoc() --
    # a real notify() would fire the sessions listener and re-render the
    # whole card, which would (separately, and correctly per this file's
    # own "Saved" fix) reset the textarea to the just-persisted value and
    # mask the exact race this scenario exists to isolate: the completion
    # handler's own check of the box's CURRENT value, independent of
    # whether a re-render happens to intervene.
    page.evaluate("""
      (function(){
        var origCollection = state.db.collection.bind(state.db);
        state.db.collection = function(name){
          var c = origCollection(name);
          if(name !== "sessions") return c;
          var origDoc = c.doc.bind(c);
          c.doc = function(id){
            var d = origDoc(id);
            d.update = function(patch){
              state.db.collection = origCollection; // one-shot control
              return new Promise(function(resolve){
                window.__pendingSaveResolve = function(){
                  Object.assign(window.__FAKE_STORE__[d.path], patch);
                  resolve();
                };
              });
            };
            return d;
          };
          return c;
        };
      })();
    """)
    first_text = "First saved text."
    second_text = "Second unsaved text"
    page.fill('#experimentNoteBox', first_text)
    page.click('#saveExperimentNoteBtn')
    # the write is deliberately stuck pending -- edit again before it lands
    page.fill('#experimentNoteBox', second_text)
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True
    # let the first save actually complete now
    page.evaluate("window.__pendingSaveResolve()")
    page.wait_for_function(
      "([sid, expected]) => window.__FAKE_STORE__['sessions/' + sid] && window.__FAKE_STORE__['sessions/' + sid].experimentNote === expected",
      arg=[sid, first_text],
    )
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == True, \
        "'Saved' must not appear over text that was never itself acknowledged as saved"
    assert page.eval_on_selector('#experimentNoteBox', 'el => el.value') == second_text
    # saving the still-unsaved text now must work normally
    page.click('#saveExperimentNoteBtn')
    page.wait_for_function(
      "([sid, expected]) => window.__FAKE_STORE__['sessions/' + sid] && window.__FAKE_STORE__['sessions/' + sid].experimentNote === expected",
      arg=[sid, second_text],
    )
    assert page.eval_on_selector('#expNoteSavedHint', 'el => el.hidden') == False
    # restore the original note_text -- later assertions in this file check
    # the finished retro's own lastRetro.experimentNote against note_text
    page.fill('#experimentNoteBox', note_text)
    page.click('#saveExperimentNoteBtn')
    page.wait_for_function(
      "([sid, expected]) => window.__FAKE_STORE__['sessions/' + sid] && window.__FAKE_STORE__['sessions/' + sid].experimentNote === expected",
      arg=[sid, note_text],
    )

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

    # RETRO-1 (STATUS.md's "Facilitated retro backlog"): finishing also
    # snapshots this onto the squad as lastRetro -- finishedAt, the sprint
    # experiment note saved earlier, and each dimension's result INCLUDING
    # whether it was manually overridden. This is the wiring proof; the
    # JSON export/import round trip of this same field is covered
    # separately in tests/test_json_last_retro_round_trip.py.
    last_retro = page.evaluate("window.__FAKE_STORE__['squads/squad-1'].lastRetro")
    print("squad-1 lastRetro after finishing:", last_retro)
    assert last_retro is not None
    assert last_retro["experimentNote"] == note_text
    assert last_retro["dimensions"]["results"] == {"color": "warn", "trend": "up", "overridden": True}
    assert last_retro["dimensions"]["trust"] == {"color": "good", "trend": "flat", "overridden": False}
    assert isinstance(last_retro["finishedAt"], str) and len(last_retro["finishedAt"]) > 0

    # the squad-view cell buttons should visibly reflect this immediately too
    result_cell_class = page.eval_on_selector('.cell-btn[data-dim="results"]', 'el => el.className')
    print("results cell-btn class after finishing (should show 'warn'):", result_cell_class)
    assert "warn" in result_cell_class
    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_retro_note_finish.png")), full_page=True)

    print("=== ALL ERRORS:", errors)
    browser.close()
