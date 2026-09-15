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
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click("#startSessionBtn")
    # evaluate() below doesn't auto-wait -- the fake store's set() writes
    # into __FAKE_STORE__ synchronously, but poll for the real condition
    # rather than assume that timing.
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/')).length === 1")
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
    # click()/fill() below auto-wait for their own targets to become
    # actionable -- no separate wait needed for either step.
    part.click("#joinCodeBtn")
    part.fill("#joinCodeInput", sid)
    part.click("#joinCodeGo")
    part.wait_for_selector(".direct-row")  # wait for the real signal, not a guessed delay
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is False

    print("=== RAINY DAY: mid-survey (nothing submitted yet), exit preserves the draft ===")
    rows = part.query_selector_all(".direct-row")
    assert len(rows) >= 1
    # No wait needed here -- the swatch click handler (retro-join.js)
    # updates state.joinDraftAnswers synchronously.
    rows[0].query_selector(".swatch.good").click()
    draft_before = part.evaluate("JSON.stringify(state.joinDraftAnswers)")
    print("draft before exit:", draft_before)

    # Opening help during an actual live survey preserves the selected answer.
    part.click("#aboutHelpBtn")
    part.click("#aboutCloseBtn")
    assert part.evaluate("JSON.stringify(state.joinDraftAnswers)") == draft_before
    assert part.locator(".direct-row .swatch.good").first.is_visible()

    exit_btn = part.query_selector("#exitJoinBtn")
    print("exit button present on the join screen:", exit_btn is not None)
    assert exit_btn is not None
    # exitJoinScreen() (retro-join.js) is fully synchronous -- no wait
    # needed before reading the resulting view state below.
    exit_btn.click()

    print("=== after exiting: the normal board is back, join screen is hidden ===")
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is True
    assert part.eval_on_selector(".view-switch", "el => el.hidden") is False
    tribe_or_squad_visible = (part.eval_on_selector("#viewTribe", "el => el.hidden") is False) or \
                              (part.eval_on_selector("#viewSquad", "el => el.hidden") is False)
    assert tribe_or_squad_visible, "exiting should show a real Tribe/Squad view, not a blank page"
    # the main board is genuinely usable while exited, not just visible --
    # switching views works exactly like it does for anyone else
    # View switching is a synchronous DOM toggle -- no wait needed before
    # reading it back.
    part.click('.view-btn[data-view="tribe"]')
    assert part.eval_on_selector("#viewTribe", "el => el.hidden") is False
    print("errors so far:", errors)

    print("=== a 'back to my retro' control appears once exited, and returns to the SAME state ===")
    back_btn = part.query_selector("#backToRetroBtn")
    print("back-to-retro button present:", back_btn is not None)
    assert back_btn is not None
    assert part.eval_on_selector("#backToRetroBtn", "el => el.hidden") is False
    # returnToJoinScreen() (retro-join.js) is fully synchronous -- it
    # re-renders from already-cached state.joinSession/joinSubmittedResults,
    # no new fetch involved -- so no wait is needed before reading below.
    back_btn.click()
    assert part.eval_on_selector("#viewJoin", "el => el.hidden") is False
    assert part.eval_on_selector(".view-switch", "el => el.hidden") is True
    draft_after = part.evaluate("JSON.stringify(state.joinDraftAnswers)")
    print("draft after returning:", draft_after)
    assert draft_after == draft_before, "the in-progress draft answer must survive an exit+return, not reset"

    print("=== HAPPY PATH: submit, exit, come back -- personal results are still there ===")
    # Every step here is click() -- Playwright auto-waits for each target to
    # become actionable, and joinDraftAnswers/refreshSubmitEnabled()
    # (retro-join.js) update synchronously in the click handler, so the
    # loop needs no waits of its own.
    rows = part.query_selector_all(".direct-row")
    for row in rows[:-1]:
        row.query_selector(".swatch.good").click()
    rows[-1].query_selector(".swatch.crit").click()
    part.click("#stmtSubmitBtn")
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "personal results rendered" signal instead of guessing.
    part.wait_for_selector('.personal-result', state="attached")
    pills_before = part.eval_on_selector_all(".personal-result .pill", "els => els.map(e => e.textContent.trim())")
    print("personal result pills right after submitting:", pills_before)
    assert len(pills_before) > 0

    # exitJoinScreen()/returnToJoinScreen() are both fully synchronous
    # (established above), so no wait is needed between these clicks.
    part.click("#exitJoinBtn")
    part.click('.view-btn[data-view="squad"]')
    part.click("#backToRetroBtn")
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "personal results rendered" signal instead of guessing.
    part.wait_for_selector('.personal-result', state="attached")
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
    # query_selector() below doesn't auto-wait -- wait for the real "app
    # booted" signal instead of guessing.
    fresh.wait_for_selector('#joinCodeBtn', state="attached")
    back_btn_fresh = fresh.query_selector("#backToRetroBtn")
    print("back-to-retro button on a device that never joined (should be None or hidden):", back_btn_fresh)
    assert back_btn_fresh is None or fresh.eval_on_selector("#backToRetroBtn", "el => el.hidden") is True
    print("Join a retro button still works normally:", fresh.query_selector("#joinCodeBtn") is not None)
    assert fresh.eval_on_selector("#joinCodeBtn", "el => el.hidden") is False
    print("errors:", fresh_errors)

    print("=== ALL ERRORS: participant=", errors, "fresh=", fresh_errors)
    assert errors == [] and fresh_errors == []
    browser.close()
