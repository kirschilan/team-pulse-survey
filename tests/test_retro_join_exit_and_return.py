from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 9: as a participant, I want the option to exit to the main Squad
# Pulse app and return to my own participation window. Before this, once a
# device entered join mode (retro-join.js's enterJoinMode()) there was no
# way back to the Tribe/Squad/Admin views at all -- confirmed as a real gap
# while testing Board sync step 6 (test_board_sync_finish_retro_convergence.py
# had to page.goto() the plain URL to simulate what a real user does today).
#
# This only toggles which section is visible -- the join session's own
# listener (retro-join.js's listenJoinSession()) keeps running underneath
# regardless, so "return" always shows current state, and nothing about a
# participant's in-progress or already-submitted answers is lost.

out_path = build_page(out_name="_test_retro_join_exit_return_sm.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ SM device: start a session for join_exit tests ============
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click("#startSessionBtn")
    page.wait_for_timeout(250)
    session_doc = page.evaluate("""() => {
      const k = Object.keys(window.__FAKE_STORE__).filter(x => x.startsWith('sessions/') && x.split('/').length===2)[0];
      return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
    }""")
    sid = session_doc["id"]
    seed_js = "STORE['sessions/" + sid + "'] = " + json.dumps(session_doc["doc"]) + ";"

    # ============ participant device: join via the header button + typed code ============
    join_out = build_page(seed_js, out_name="_test_retro_join_exit_return_participant.html")
    part = browser.new_page(viewport={"width": 420, "height": 900})
    errors = []
    part.on("pageerror", lambda e: errors.append(str(e)))
    part.goto("file://" + str(join_out.resolve()))
    part.wait_for_timeout(300)
    part.click("#joinCodeBtn")
    part.wait_for_timeout(100)
    part.fill("#joinCodeInput", sid)
    part.click("#joinCodeGo")
    part.wait_for_timeout(400)
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is False

    print("=== RAINY DAY: mid-survey (nothing submitted yet), exit preserves the draft ===")
    rows = part.query_selector_all(".direct-row")
    assert len(rows) >= 1
    rows[0].query_selector(".swatch.good").click()
    part.wait_for_timeout(50)
    draft_before = part.evaluate("JSON.stringify(state.joinDraftAnswers)")
    print("draft before exit:", draft_before)

    exit_btn = part.query_selector("#exitJoinBtn")
    print("exit button present on the join screen:", exit_btn is not None)
    assert exit_btn is not None
    exit_btn.click()
    part.wait_for_timeout(200)

    print("=== after exiting: the normal board is back, join screen is hidden ===")
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is True
    assert part.eval_on_selector(".view-switch", "el => el.hidden") is False
    tribe_or_squad_visible = (part.eval_on_selector("#viewTribe", "el => el.hidden") is False) or \
                              (part.eval_on_selector("#viewSquad", "el => el.hidden") is False)
    assert tribe_or_squad_visible, "exiting should show a real Tribe/Squad view, not a blank page"
    # the main board is genuinely usable while exited, not just visible --
    # switching views works exactly like it does for anyone else
    part.click('.view-btn[data-view="tribe"]')
    part.wait_for_timeout(150)
    assert part.eval_on_selector("#viewTribe", "el => el.hidden") is False
    print("errors so far:", errors)

    print("=== a 'back to my retro' control appears once exited, and returns to the SAME state ===")
    back_btn = part.query_selector("#backToRetroBtn")
    print("back-to-retro button present:", back_btn is not None)
    assert back_btn is not None
    assert part.eval_on_selector("#backToRetroBtn", "el => el.hidden") is False
    back_btn.click()
    part.wait_for_timeout(200)
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is False
    assert part.eval_on_selector(".view-switch", "el => el.hidden") is True
    draft_after = part.evaluate("JSON.stringify(state.joinDraftAnswers)")
    print("draft after returning:", draft_after)
    assert draft_after == draft_before, "the in-progress draft answer must survive an exit+return, not reset"

    print("=== HAPPY PATH: submit, exit, come back -- personal results are still there ===")
    rows = part.query_selector_all(".direct-row")
    for row in rows[:-1]:
        row.query_selector(".swatch.good").click()
        part.wait_for_timeout(20)
    rows[-1].query_selector(".swatch.crit").click()
    part.wait_for_timeout(50)
    part.click("#stmtSubmitBtn")
    part.wait_for_timeout(300)
    pills_before = part.eval_on_selector_all(".personal-result .pill", "els => els.map(e => e.textContent.trim())")
    print("personal result pills right after submitting:", pills_before)
    assert len(pills_before) > 0

    part.click("#exitJoinBtn")
    part.wait_for_timeout(200)
    part.click('.view-btn[data-view="squad"]')
    part.wait_for_timeout(150)
    part.click("#backToRetroBtn")
    part.wait_for_timeout(200)
    pills_after = part.eval_on_selector_all(".personal-result .pill", "els => els.map(e => e.textContent.trim())")
    print("personal result pills after exit + return:", pills_after)
    assert pills_after == pills_before, "returning to the join screen after submitting should show the SAME personal results, not lose them or re-show the survey"
    print("errors:", errors)

    print("=== RAINY DAY: a device that never joined anything never shows 'back to my retro' ===")
    fresh_out = build_page(out_name="_test_retro_join_exit_return_fresh.html")
    fresh = browser.new_page(viewport={"width": 1280, "height": 1000})
    fresh_errors = []
    fresh.on("pageerror", lambda e: fresh_errors.append(str(e)))
    fresh.goto("file://" + str(fresh_out.resolve()))
    fresh.wait_for_timeout(300)
    back_btn_fresh = fresh.query_selector("#backToRetroBtn")
    print("back-to-retro button on a device that never joined (should be None or hidden):", back_btn_fresh)
    assert back_btn_fresh is None or fresh.eval_on_selector("#backToRetroBtn", "el => el.hidden") is True
    print("Join a retro button still works normally:", fresh.query_selector("#joinCodeBtn") is not None)
    assert fresh.eval_on_selector("#joinCodeBtn", "el => el.hidden") is False
    print("errors:", fresh_errors)

    print("=== ALL ERRORS: participant=", errors, "fresh=", fresh_errors)
    assert errors == [] and fresh_errors == []
    browser.close()
