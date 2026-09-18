from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 6: the facilitator live/hold toggle. There's no roster/headcount
# anywhere in this app, so "everyone's submitted" can't be auto-detected --
# the SM flips a manual switch on the session doc's `revealMode` field, and
# this test checks that switch actually gates what the facilitator sees
# (not just a client-side flag), persists through the shared session doc,
# and that the consolidation math still holds with several submissions in
# at once (including a real tie, resolved to the calmer bucket).

out_path = build_page(out_name="_test_retro_reveal_consolidation.html")


def strip_bidi(s):
    # Story 11 routed the held/live submission count line through t(),
    # which wraps every interpolated value (the count) in Unicode bidi
    # isolate marks (U+2066 LRI / U+2069 PDI) -- see i18n.js/STATUS.md.
    # Invisible and harmless, but present in .textContent, so exact-text
    # checks here strip them rather than matching against plain ASCII.
    return s.replace("⁦", "").replace("⁩", "")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
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

    print("=== default reveal mode is hold, stored on the session doc itself ===")
    stored_mode = page.evaluate("window.__FAKE_STORE__['sessions/%s'].revealMode" % sid)
    print("stored revealMode:", stored_mode)
    assert stored_mode == "hold"
    assert page.eval_on_selector('.reveal-btn[data-reveal="hold"]', 'el => el.className').find("active") != -1
    assert page.eval_on_selector('.reveal-btn[data-reveal="live"]', 'el => el.className').find("active") == -1
    assert page.query_selector('.live-dim-row') is None

    # seed 5 responses directly into the SM's own store (simulating 5 real
    # devices submitting), with a genuine 2-2-1 split across bands for
    # 'trust' so we can check both the majority path and this session's
    # calmer-tie behavior at a larger N
    responses = [
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,3]) for k in dim_keys}},  # trust=9 good
        {"answers": {k: ([3,3,3] if k!="trust" else [3,3,2]) for k in dim_keys}},  # trust=8 good
        {"answers": {k: ([3,3,3] if k!="trust" else [1,1,1]) for k in dim_keys}},  # trust=3 crit
        {"answers": {k: ([3,3,3] if k!="trust" else [1,1,1]) for k in dim_keys}},  # trust=3 crit
        {"answers": {k: ([3,3,3] if k!="trust" else [2,2,2]) for k in dim_keys}},  # trust=6 warn
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
    # state.sessionResponses and re-renders (subscribeSessionResponses()'s
    # listener calls renderSquadView() when the squad view is active)
    # before this evaluate() call even returns.

    print("=== still hold: 5 submissions in, but no pills shown ===")
    held_text = page.eval_on_selector('.live-block .hint', 'el => el.textContent')
    print("held hint text:", held_text)
    assert strip_bidi(held_text).strip().startswith("5")
    assert page.query_selector('.live-dim-row') is None, "hold mode must not leak the consolidated pills"
    print("errors:", errors)

    print("=== flip to live ===")
    # setRevealMode() (retro-facilitator.js) writes to the store and
    # re-renders synchronously in this local fake-store test (unlike the
    # real-relay case in test_board_sync_finish_retro_convergence.py, where
    # the write genuinely round-trips before this device's own listener
    # reflects it) -- no wait needed before the reads below.
    page.click('.reveal-btn[data-reveal="live"]')
    stored_mode2 = page.evaluate("window.__FAKE_STORE__['sessions/%s'].revealMode" % sid)
    print("stored revealMode after flip:", stored_mode2)
    assert stored_mode2 == "live", "the toggle must persist on the shared session doc, not just a local flag"

    row_texts = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    print("live rows:", row_texts)
    trust_row = next(t for t in row_texts if "Absence of Trust" in t)
    print("trust row (2 good/2 crit/1 warn -- majority good, count 2):", trust_row)
    assert "Green" in trust_row, "trust: 2 good vs 2 crit vs 1 warn -> good has the plurality (2 > 1), no tie here"
    # every OTHER dimension had all 5 submissions at [3,3,3] -> unanimous good
    for k, label in zip(["conflict","commitment","accountability","results"],
                         ["Fear of Conflict","Lack of Commitment","Avoidance of Accountability","Inattention to Results"]):
        row = next(t for t in row_texts if label in t)
        assert "Green" in row, label + " should be unanimous green"
    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_retro_reveal_consolidation.png")), full_page=True)

    print("=== exact tie (2 good / 2 crit) on a fresh dimension -- must resolve to calmer (good) ===")
    # overwrite just the trust responses to a clean 2-good/2-crit tie (drop the 5th)
    page.evaluate("""
      (function(){
        delete window.__FAKE_STORE__['sessions/%s/responses/r4'];
        window.__NOTIFY__('sessions/%s/responses');
      })();
    """ % (sid, sid))
    # No wait needed here -- same synchronous notify() reasoning as above.
    row_texts2 = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    trust_row2 = next(t for t in row_texts2 if "Absence of Trust" in t)
    print("trust row with exact 2-2 tie:", trust_row2)
    assert "Green" in trust_row2, "a 2-good/2-crit tie must default to the calmer bucket (good)"

    print("=== flip back to hold -- pills disappear again, count still shown ===")
    # Same synchronous setRevealMode() reasoning as flipping to live above.
    page.click('.reveal-btn[data-reveal="hold"]')
    stored_mode3 = page.evaluate("window.__FAKE_STORE__['sessions/%s'].revealMode" % sid)
    assert stored_mode3 == "hold"
    assert page.query_selector('.live-dim-row') is None
    held_text2 = page.eval_on_selector('.live-block .hint', 'el => el.textContent')
    print("held hint text after flipping back:", held_text2)
    assert strip_bidi(held_text2).strip().startswith("4")  # one response was deleted above
    print("errors:", errors)

    print("=== switching squads and back preserves the reveal mode (re-subscribes correctly) ===")
    page.click('.squad-pick-btn[data-id="squad-2"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    # eval_on_selector() below doesn't auto-wait. Switching squads away and
    # back re-subscribes subscribeSessionResponses() from scratch (its own
    # guard resets once squad-2's session-less view unsubscribes) -- a
    # FRESH subscription's first onSnapshot delivery is a genuine async gap
    # the fake store deliberately delays (unlike its later, synchronous
    # notify() calls), unlike the toggle reads above. The reveal-btn's
    # active class itself comes from the long-lived sessions listener
    # (never torn down across squad switches), so it should already be
    # correct, but wait for the real condition rather than assume that.
    page.wait_for_function("() => { var b = document.querySelector('.reveal-btn[data-reveal=\"hold\"]'); return b && b.className.indexOf('active') !== -1; }")
    assert page.eval_on_selector('.reveal-btn[data-reveal="hold"]', 'el => el.className').find("active") != -1
    print("errors:", errors)

    print("=== ALL ERRORS:", errors)
    browser.close()
