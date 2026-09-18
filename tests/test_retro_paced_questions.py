from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# RETRO-2 (STATUS.md's "Facilitated retro backlog"): a session-level toggle,
# default off, that -- when on -- shows each participant only the CURRENT
# question (one interleaved statement or one direct-rating dimension pick
# at a time, in the same order helpers.js's pacingSequence() defines) and
# advances everyone together as the facilitator moves forward, instead of
# the whole survey at once. Core acceptance criterion this test is built
# around: revisiting an earlier question must NOT discard a participant's
# existing answer to it.
#
# Board: one statement dimension ("trust", 2 statements) plus the default
# fixture's three direct-rating dimensions (release/process/value) -- a
# deliberate mix so this test exercises pacing through BOTH question kinds,
# not just one. pacingSequence() order for this board: trust#0, trust#1,
# release, process, value (5 total).
TRUST_DIM_SEED = """
STORE["dimensions/trust"] = {
  label: "Trust", green: "green trust", red: "red trust", order: 0,
  scoreBands: { good: 5, warn: 3 },
  statements: ["S1 for trust", "S2 for trust"]
};
"""

out_path = build_page(TRUST_DIM_SEED, out_name="_test_retro_paced_sm.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ SM device: start a PACED session ============
    page = browser.new_page(viewport={"width": 1280, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')

    print("=== facilitator: 'one question at a time' toggle exists and defaults OFF ===")
    pacing_checkbox = page.query_selector('#pacingToggle')
    assert pacing_checkbox is not None, "renderSessionCardHtml()'s no-session state should offer a pacing toggle"
    assert page.eval_on_selector('#pacingToggle', 'el => el.checked') is False

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
    print("=== session started with pacing enabled, index 0 ===", sid)
    assert session_info["doc"]["pacingEnabled"] is True
    assert session_info["doc"]["currentQuestionIndex"] == 0

    print("=== facilitator card shows a Question 1 of 5 counter, Previous disabled ===")
    page.wait_for_selector('#pacingCounter', state="attached")
    counter_text = page.eval_on_selector('#pacingCounter', 'el => el.textContent')
    print("facilitator counter:", counter_text)
    assert "1" in counter_text and "5" in counter_text
    assert page.eval_on_selector('#pacingPrevBtn', 'el => el.disabled') is True
    assert page.eval_on_selector('#pacingNextBtn', 'el => el.textContent').strip() != ""

    print("=== PO review follow-up: the facilitator sees the actual question text, not just a bare counter ===")
    facilitator_q1_text = page.eval_on_selector('#pacingQuestionText', 'el => el.textContent')
    print("facilitator's question 1 text:", facilitator_q1_text)
    assert facilitator_q1_text == "S1 for trust", "the facilitator should see the SAME text being presented to participants"

    # ============ participant device: seeded with the paced session doc ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    join_out = build_page(seed_js, out_name="_test_retro_paced_participant.html")

    part = browser.new_page(viewport={"width": 420, "height": 1400})
    part_errors = []
    part.on("pageerror", lambda e: part_errors.append(str(e)))
    part.goto("file://" + str(join_out.resolve()) + "?session=" + secret)
    part.wait_for_selector('.stmt-row', state="attached")

    print("=== participant: exactly ONE question visible (question 1 of 5: trust's first statement), no Submit button ===")
    assert len(part.query_selector_all('.stmt-row')) == 1, "paced join screen should show exactly one statement row, not the whole survey"
    assert len(part.query_selector_all('.direct-row')) == 0, "the first paced question is a statement, not a direct-rating row yet"
    assert part.query_selector('#stmtSubmitBtn') is None, "submission is facilitator-paced, not participant-initiated -- no Submit button while paced"
    part_counter = part.eval_on_selector('#pacingCounter', 'el => el.textContent')
    print("participant counter:", part_counter)
    assert "1" in part_counter and "5" in part_counter
    first_stmt_text = part.eval_on_selector('.stmt-row .stmt-text', 'el => el.textContent')
    print("first question text:", first_stmt_text)
    assert first_stmt_text == "S1 for trust"

    print("=== participant answers question 1 (value 2) ===")
    part.click('.stmt-row .scale-btn[data-value="2"]')
    assert part.eval_on_selector('.stmt-row .scale-btn[data-value="2"]', 'el => el.classList.contains("selected")') is True

    # Mirrors the facilitator's session-doc write into the participant's own,
    # independent fake store by calling the SAME real db.doc(...).set() API
    # a live relay push would resolve into on that device -- this fires the
    # participant's already-registered onSnapshot listener (listenJoinSession(),
    # retro-join.js) synchronously, exactly like window.__NOTIFY__() does for
    # a collection listener elsewhere in this suite, just at the single-doc
    # level fake_store.html's own set()/notifyDoc() already wires up.
    def mirror_session_to_participant(new_doc):
        payload = json.dumps(new_doc)
        part.evaluate("""
          (async function(){
            var db = await window.claude.use("db");
            await db.doc("sessions/%s").set(%s);
          })();
        """ % (sid, payload))

    print("=== facilitator advances to question 2 (trust's second statement) ===")
    page.click('#pacingNextBtn')
    page.wait_for_function("() => window.__FAKE_STORE__['sessions/%s'].currentQuestionIndex === 1" % sid)
    advanced_doc = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % sid)
    assert advanced_doc["currentQuestionIndex"] == 1
    facilitator_q2_text = page.eval_on_selector('#pacingQuestionText', 'el => el.textContent')
    print("facilitator's question 2 text:", facilitator_q2_text)
    assert facilitator_q2_text == "S2 for trust"
    mirror_session_to_participant(advanced_doc)
    part.wait_for_function("() => document.querySelector('#pacingCounter') && document.querySelector('#pacingCounter').textContent.indexOf('2') !== -1")

    second_stmt_text = part.eval_on_selector('.stmt-row .stmt-text', 'el => el.textContent')
    print("second question text:", second_stmt_text)
    assert second_stmt_text == "S2 for trust"
    print("=== question 2 is fresh -- nothing pre-selected ===")
    assert len(part.query_selector_all('.stmt-row .scale-btn.selected')) == 0

    print("=== participant answers question 2 (value 3) ===")
    part.click('.stmt-row .scale-btn[data-value="3"]')

    print("=== CORE ACCEPTANCE CRITERION: facilitator goes BACK to question 1 -- participant's earlier answer must still be there ===")
    page.click('#pacingPrevBtn')
    page.wait_for_function("() => window.__FAKE_STORE__['sessions/%s'].currentQuestionIndex === 0" % sid)
    back_doc = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % sid)
    assert back_doc["currentQuestionIndex"] == 0
    assert page.eval_on_selector('#pacingQuestionText', 'el => el.textContent') == "S1 for trust"
    mirror_session_to_participant(back_doc)
    part.wait_for_function("() => document.querySelector('#pacingCounter') && document.querySelector('#pacingCounter').textContent.indexOf('1') !== -1")
    revisited_text = part.eval_on_selector('.stmt-row .stmt-text', 'el => el.textContent')
    assert revisited_text == "S1 for trust"
    still_selected = part.eval_on_selector('.stmt-row .scale-btn[data-value="2"]', 'el => el.classList.contains("selected")')
    print("question 1's earlier answer (value 2) still selected on revisit:", still_selected)
    assert still_selected is True, "revisiting an earlier question must not discard the participant's existing answer to it"

    print("=== facilitator advances through the remaining questions (2, then the three direct-rating dims) ===")
    for target_idx in (1, 2, 3, 4):
        page.click('#pacingNextBtn')
        page.wait_for_function("() => window.__FAKE_STORE__['sessions/%s'].currentQuestionIndex === %d" % (sid, target_idx))
        doc_now = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % sid)
        mirror_session_to_participant(doc_now)
        part.wait_for_function("() => document.querySelector('#pacingCounter') && document.querySelector('#pacingCounter').textContent.indexOf('%d') !== -1" % (target_idx + 1))
        if target_idx == 1:
            # question 2 again -- answer stayed selected from before, no
            # need to re-click; just move on.
            continue
        # questions 3/4/5 (indices 2/3/4) are the three direct-rating
        # dimensions (release/process/value, in that order) -- pick a
        # non-uniform color per dimension so the stored payload below can
        # be checked field-by-field, not just "something truthy".
        row = part.query_selector('.direct-row')
        assert row is not None, "question index %d should be a direct-rating row" % target_idx
        dim_label = part.eval_on_selector('.direct-row .stmt-text', 'el => el.textContent')
        facilitator_text = page.eval_on_selector('#pacingQuestionText', 'el => el.textContent')
        print("direct-rating question %d -- participant label: %r, facilitator text: %r" % (target_idx, dim_label, facilitator_text))
        assert facilitator_text == dim_label, "a direct-rating question shows the facilitator the same label a participant sees"
        color = ["good", "warn", "crit"][target_idx - 2]
        row.query_selector('.swatch.' + color).click()

    print("=== facilitator finishes questioning (advances past the last index) -- participant auto-submits ===")
    page.click('#pacingNextBtn')
    page.wait_for_function("() => window.__FAKE_STORE__['sessions/%s'].currentQuestionIndex === 5" % sid)
    final_doc = page.evaluate("window.__FAKE_STORE__['sessions/%s']" % sid)
    mirror_session_to_participant(final_doc)
    part.wait_for_selector('.personal-result', state="attached")

    stored = part.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """ % sid)
    print("auto-submitted response:", stored["answers"])
    assert stored["answers"]["trust"] == [2, 3]
    assert stored["answers"]["release"] == "good"
    assert stored["answers"]["process"] == "warn"
    assert stored["answers"]["value"] == "crit"

    print("=== facilitator's Previous still works even after questioning is finished ===")
    assert page.eval_on_selector('#pacingPrevBtn', 'el => el.disabled') is False

    print("errors (facilitator):", errors, "| errors (participant):", part_errors)
    assert errors == [] and part_errors == []
    page.screenshot(path=str(test_output_path("shot_retro_paced_questions.png")), full_page=True)

    # ============ a SEPARATE, late-joining participant who never finishes
    # answering must not crash when the facilitator finishes questioning --
    # a friendly waiting state instead of a silent submit of incomplete data ============
    late_seed = "STORE['sessions/" + sid + "'] = " + json.dumps(back_doc) + ";"
    late_out = build_page(late_seed, out_name="_test_retro_paced_participant_late.html")
    late = browser.new_page(viewport={"width": 420, "height": 1400})
    late_errors = []
    late.on("pageerror", lambda e: late_errors.append(str(e)))
    late.goto("file://" + str(late_out.resolve()) + "?session=" + secret)
    late.wait_for_selector('.stmt-row', state="attached")
    # never answers anything, then the facilitator finishes questioning:
    late.evaluate("""
      (async function(){
        var db = await window.claude.use("db");
        await db.doc("sessions/%s").set(%s);
      })();
    """ % (sid, json.dumps(final_doc)))
    late.wait_for_selector('.pacing-waiting', state="attached")
    print("=== a participant who never finished answering sees a waiting state, not a crash or a bad submit ===")
    assert late.query_selector('.personal-result') is None
    # `late` has its own independent fake store (seeded only with the
    # session doc, no responses collection -- see fake_store.html's own
    # header comment: each page's store is isolated, there's no real
    # network in this harness) -- 0, not 1, is the correct "didn't submit"
    # count here.
    stored_after_incomplete = late.evaluate("""
      (function(){
        var keys = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/%s/responses/')===0; });
        return keys.length;
      })();
    """ % sid)
    assert stored_after_incomplete == 0, "an incomplete participant must not submit a partial response when the facilitator finishes questioning"
    print("errors (late participant):", late_errors)
    assert late_errors == []

    browser.close()
