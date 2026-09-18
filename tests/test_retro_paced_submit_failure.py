from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Codex review on PR #30 (RETRO-2, STATUS.md's "Facilitated retro backlog"):
# the paced flow's auto-submit (renderJoinScreen(), retro-join.js) only
# reset `joinAutoSubmitting` in its .catch() -- nothing re-rendered, so a
# participant whose write genuinely failed (relay hiccup, a real rejected
# promise) stayed stuck on the "Submitting..." screen forever, with no
# error shown and no way to retry short of reloading the page and losing
# their in-progress draft. This test drives that exact failure end to end:
# a single-question paced session (the smallest board that reaches the
# "done" sentinel in one step) whose FIRST submission attempt is made to
# fail by monkey-patching the fake store's own responses.add(), then
# confirms a real failure state with a working retry appears instead of a
# silent stall.
#
# Reduced to ONE direct-rating dimension ("release") so this test's own
# board reaches pacingSequence's "done" sentinel after a single answer --
# nothing about the failure/retry behavior itself depends on having more
# than one question.
ONE_DIM_SEED = """
delete STORE["dimensions/process"];
delete STORE["dimensions/value"];
"""

out_path = build_page(ONE_DIM_SEED, out_name="_test_retro_paced_fail_sm.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    page = browser.new_page(viewport={"width": 1280, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.check('#pacingToggle')
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
    print("=== single-dimension paced session started ===", sid, session_info["doc"]["dimensions"])
    assert len(session_info["doc"]["dimensions"]) == 1

    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    join_out = build_page(seed_js, out_name="_test_retro_paced_fail_participant.html")

    part = browser.new_page(viewport={"width": 420, "height": 1400})
    part_errors = []
    part.on("pageerror", lambda e: part_errors.append(str(e)))
    part.goto("file://" + str(join_out.resolve()) + "?session=" + secret)
    part.wait_for_selector('.direct-row', state="attached")

    print("=== monkey-patch this participant's db.doc().collection('responses').add() to fail exactly once ===")
    part.evaluate("""
      (function(){
        var origDoc = state.db.doc.bind(state.db);
        var shouldFail = true;
        window.__submitAttempts__ = 0;
        state.db.doc = function(path, secret){
          var ref = origDoc(path, secret);
          var origCollection = ref.collection.bind(ref);
          ref.collection = function(sub){
            var collRef = origCollection(sub);
            var origAdd = collRef.add.bind(collRef);
            collRef.add = function(data){
              window.__submitAttempts__++;
              if(shouldFail){
                shouldFail = false;
                return Promise.reject({ code: "unavailable", message: "simulated failure" });
              }
              return origAdd(data);
            };
            return collRef;
          };
          return ref;
        };
      })();
    """)

    print("=== participant answers the one question ===")
    part.click('.direct-row .swatch.good')

    print("=== facilitator finishes questioning -- triggers the participant's auto-submit, which fails ===")
    page.click('#pacingNextBtn')
    page.wait_for_function("() => window.__FAKE_STORE__['sessions/%s'].currentQuestionIndex === 1" % sid)
    final_doc = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % sid)
    part.evaluate("""
      (async function(){
        var db = await window.claude.use("db");
        await db.doc("sessions/%s").set(%s);
      })();
    """ % (sid, json.dumps(final_doc)))

    print("=== a real failure state appears, not a stuck 'Submitting...' screen ===")
    part.wait_for_selector('.pacing-submit-failed', state="attached")
    assert part.query_selector('.personal-result') is None
    submitting_stuck = part.eval_on_selector('#joinCard h2', 'el => el.textContent').lower()
    print("heading after failure:", submitting_stuck)
    assert "submitting" not in submitting_stuck
    assert "couldn't submit" in submitting_stuck

    print("=== retry button is present and preserves the draft (the same answer, not reset) ===")
    retry_btn = part.query_selector('#pacingRetrySubmitBtn')
    assert retry_btn is not None
    assert part.evaluate("state.joinDraftAnswers['release']") == "good", "the draft must survive a failed submit, not get cleared"

    print("=== clicking retry succeeds this time (the monkey-patch only fails the first attempt) ===")
    retry_btn.click()
    part.wait_for_selector('.personal-result', state="attached")
    attempts = part.evaluate("window.__submitAttempts__")
    print("total submit attempts (should be 2 -- one failed, one succeeded):", attempts)
    assert attempts == 2

    stored = part.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    print("stored response after retry:", stored["answers"])
    assert stored["answers"]["release"] == "good"

    print("errors (facilitator):", errors, "| errors (participant):", part_errors)
    assert errors == [] and part_errors == []
    part.screenshot(path=str(test_output_path("shot_retro_paced_submit_failure.png")), full_page=True)

    browser.close()
