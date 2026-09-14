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
    page.wait_for_timeout(250)

    print("=== still hold: 5 submissions in, but no pills shown ===")
    held_text = page.eval_on_selector('.live-block .hint', 'el => el.textContent')
    print("held hint text:", held_text)
    assert strip_bidi(held_text).strip().startswith("5")
    assert page.query_selector('.live-dim-row') is None, "hold mode must not leak the consolidated pills"
    print("errors:", errors)

    print("=== flip to live ===")
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(250)
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
    page.wait_for_timeout(200)
    row_texts2 = page.eval_on_selector_all('.live-dim-row', 'els => els.map(e => e.textContent)')
    trust_row2 = next(t for t in row_texts2 if "Absence of Trust" in t)
    print("trust row with exact 2-2 tie:", trust_row2)
    assert "Green" in trust_row2, "a 2-good/2-crit tie must default to the calmer bucket (good)"

    print("=== flip back to hold -- pills disappear again, count still shown ===")
    page.click('.reveal-btn[data-reveal="hold"]')
    page.wait_for_timeout(250)
    stored_mode3 = page.evaluate("window.__FAKE_STORE__['sessions/%s'].revealMode" % sid)
    assert stored_mode3 == "hold"
    assert page.query_selector('.live-dim-row') is None
    held_text2 = page.eval_on_selector('.live-block .hint', 'el => el.textContent')
    print("held hint text after flipping back:", held_text2)
    assert strip_bidi(held_text2).strip().startswith("4")  # one response was deleted above
    print("errors:", errors)

    print("=== switching squads and back preserves the reveal mode (re-subscribes correctly) ===")
    page.click('.squad-pick-btn[data-id="squad-2"]')
    page.wait_for_timeout(150)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('.reveal-btn[data-reveal="hold"]', 'el => el.className').find("active") != -1
    print("errors:", errors)

    print("=== ALL ERRORS:", errors)
    browser.close()
