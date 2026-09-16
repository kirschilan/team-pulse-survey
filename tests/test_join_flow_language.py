from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 10 (see STATUS.md's backlog table): the retro
# JOIN flow -- the join screen's own connecting/ended/unreachable/not-open
# states, the survey form chrome (scale buttons, the "Squad health check"
# sub-heading, Submit), and the personal-result screen afterward. Dimension
# content itself (label/green/red/statement text) stays untranslated by
# design -- same principle Story 9 applied to template names: it's the
# admin's own authored content, snapshotted onto the session at start time,
# not app chrome. SEC-2 later removed the typed join-code modal this file
# used to also cover (link/QR only now -- see joinSessionByCode()'s own
# comment in retro-join.js); every scenario below enters join mode directly
# via that function instead, exactly like a real ?session=<secret> link
# would.

out_path = build_page(out_name="_test_join_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 420, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== English baseline: bad/unknown secret shows the 'not open' state ===")
    page.evaluate("joinSessionByCode('ZZZZZZ')")
    not_open_h_en = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    not_open_hint_en = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    page.click('#exitJoinBtn')

    # setView()/setLocale() are both synchronous (established across this
    # pass) -- no wait needed for either click.
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')

    print("=== a bad/unknown secret shows the Hebrew 'not open' state ===")
    # joinSessionByCode() (retro-join.js) is itself fully synchronous --
    # it sets state.joinSession=null then calls enterJoinMode(), which
    # renders synchronously -- and for a secret whose derived room never
    # existed, that FIRST synchronous render already shows the "not open"
    # state (sess is null both before and after listenJoinSession()'s own
    # async first delivery, since the doc never exists either way), so no
    # wait is needed here, unlike the two scenarios below that pre-seed a
    # real doc.
    page.evaluate("joinSessionByCode('ZZZZZZ')")
    assert page.eval_on_selector('#viewJoin', 'el=>el.getAttribute("dir")') == "rtl"
    not_open_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    not_open_hint = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    print(not_open_h, "|", not_open_hint)
    assert not_open_h != "This retro session isn’t open" and not_open_h.strip()
    assert not_open_hint.strip() and "out of date" not in not_open_hint

    back_btn_he = page.eval_on_selector('#exitJoinBtn', 'el=>el.textContent')
    print("back button (Hebrew):", back_btn_he)
    assert back_btn_he != "← Back to Squad Pulse" and back_btn_he.strip()

    diag_summary_he = page.eval_on_selector('#joinDiagPanel summary', 'el=>el.childNodes[0].textContent')
    print("diag summary (Hebrew):", diag_summary_he)
    assert diag_summary_he.strip() and "diagnostics" not in diag_summary_he.lower()

    print("=== forcing the 'unavailable' (never reached relay) state shows its own Hebrew message ===")
    # evaluate() awaits the full synchronous execution of the given script --
    # renderJoinScreen() is called directly, inline, so the render is
    # already done by the time evaluate() returns. No wait needed.
    page.evaluate("state.joinUnavailable = true; renderJoinScreen();")
    unavail_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    unavail_hint = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    print(unavail_h, "|", unavail_hint)
    assert unavail_h.strip() and "connect" not in unavail_h.lower()
    assert unavail_hint.strip() and "relay" not in unavail_hint.lower()
    page.evaluate("state.joinUnavailable = false;")

    print("=== a CLOSED session shows the Hebrew 'ended' state ===")
    # SEC-2: joinSessionByCode() takes a SECRET, not a relay room id any
    # more -- the fake store is keyed by the room id the real app would
    # derive via SquadPulseCrypto.roomIdFor(), so seed it under THAT, not
    # under the literal secret string.
    page.evaluate("""
      SquadPulseCrypto.roomIdFor('CLOSEDX').then(function(roomId){
        window.__FAKE_STORE__['sessions/' + roomId] = {
          squadId:'squad-1', squadName:'Squad 1', templateName:'Custom',
          dimensions:[], status:'closed', revealMode:'hold', overrides:{}
        };
        joinSessionByCode('CLOSEDX');
      });
    """)
    # evaluate() above doesn't auto-wait -- unlike the bad-code scenario
    # above, this doc DOES exist, so listenJoinSession()'s FIRST onSnapshot
    # delivery (a genuine async gap this pass has established everywhere)
    # is what actually lands the "closed" status into state.joinSession;
    # wait for that real condition instead of guessing.
    page.wait_for_function("() => state.joinSession && state.joinSession.status === 'closed'")
    ended_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    ended_hint = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    print(ended_h, "|", ended_hint)
    assert ended_h.strip() and "ended" not in ended_h.lower()
    assert ended_hint.strip() and "facilitator" not in ended_hint.lower()

    print("=== a real OPEN mixed-dimension session: survey form chrome is Hebrew ===")
    page.evaluate("""
      SquadPulseCrypto.roomIdFor('MIXEDXX').then(function(roomId){
        window.__FAKE_STORE__['sessions/' + roomId] = {
          squadId:'squad-1', squadName:'Squad 1', templateName:'Custom',
          status:'open', revealMode:'hold', overrides:{}, experimentNote:'',
          dimensions: [
            { key:'trust', label:'Trust', green:'', red:'', order:1,
              statements:['Statement one', 'Statement two'], scoreBands:{good:5,warn:3} },
            { key:'health', label:'Health', green:'Feels healthy', red:'Feels unhealthy', order:2 }
          ]
        };
        joinSessionByCode('MIXEDXX');
      });
    """)
    # Same genuine-async-gap reasoning as the CLOSEDX scenario above.
    page.wait_for_function("() => state.joinSession && state.joinSession.status === 'open'")

    joining_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    form_hint = page.eval_on_selector('#joinCard > .hint', 'el=>el.textContent')
    print("heading / hint (Hebrew):", joining_h, "|", form_hint)
    assert "Squad 1" in joining_h and "retro" not in joining_h.lower()
    assert form_hint.strip() and "anonymous" not in form_hint.lower()

    scale_labels = page.eval_on_selector_all('.stmt-row:first-child .scale-btn', 'els=>els.map(e=>e.textContent)')
    print("scale button labels (Hebrew):", scale_labels)
    assert all(l.strip() for l in scale_labels)
    assert "Rarely" not in scale_labels and "Sometimes" not in scale_labels and "Usually" not in scale_labels

    squad_health_headings = page.eval_on_selector_all('#stmtForm .field-label', 'els=>els.map(e=>e.textContent)')
    print("'Squad health check' sub-heading (Hebrew):", squad_health_headings)
    assert squad_health_headings and "Squad health check" not in squad_health_headings[0]

    green_label_he = page.eval_on_selector('.direct-row b', 'el=>el.textContent')
    print("Green: label (Hebrew, reused from Tribe legend):", green_label_he)
    assert green_label_he not in ("Green:", "Red:") and green_label_he.strip()

    swatch_title_he = page.eval_on_selector('.direct-row .swatch.good', 'el=>el.getAttribute("title")')
    print("swatch title (Hebrew):", swatch_title_he)
    assert swatch_title_he != "Green" and swatch_title_he.strip()

    submit_text_he = page.eval_on_selector('#stmtSubmitBtn', 'el=>el.textContent')
    print("Submit button (Hebrew):", submit_text_he)
    assert submit_text_he != "Submit" and submit_text_he.strip()

    print("=== answering and submitting shows the Hebrew personal-result screen ===")
    # refreshSubmitEnabled() (retro-join.js) runs synchronously inside each
    # scale-btn/swatch's own click handler, so no wait is needed between
    # clicks or before reading it right after (same finding as
    # test_retro_direct_rating_flow.py's identical loop).
    for btn in page.query_selector_all('.stmt-row .scale-btn[data-value="3"]'):
        btn.click()
    page.click('.direct-row .swatch.good')
    assert page.eval_on_selector('#stmtSubmitBtn', 'el=>el.disabled') == False
    page.click('#stmtSubmitBtn')
    # eval_on_selector() below doesn't auto-wait -- the submit handler's
    # store write resolves via a real (if already-settled) Promise chain
    # before afterSubmit() renders the personal-result screen, so wait for
    # that real signal instead of guessing.
    page.wait_for_selector('.personal-result', state="attached")

    thanks_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    retro_line = page.eval_on_selector('#joinCard > .hint', 'el=>el.textContent')
    print("thanks heading / retro line (Hebrew):", thanks_h, "|", retro_line)
    assert thanks_h.strip() and "results" not in thanks_h.lower()
    assert "Custom" in retro_line

    band_words_he = page.eval_on_selector_all('.personal-result .pill', 'els=>els.map(e=>e.textContent)')
    print("band words (Hebrew):", band_words_he)
    assert not any(w in ("Green", "Yellow", "Red") for w in band_words_he)

    print("=== switching back to English restores every string above ===")
    # Admin is hidden while in join mode -- exit first, THEN switch language.
    # exitJoinScreen() (retro-join.js) is fully synchronous (established
    # across this pass), same as setView()/setLocale() -- no wait needed
    # for any of these three clicks.
    page.click('#exitJoinBtn')
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')
    page.evaluate("joinSessionByCode('ZZZZZZ')")
    assert page.eval_on_selector('#viewJoin', 'el=>el.getAttribute("dir")') != "rtl"
    assert page.eval_on_selector('#joinCard h2', 'el=>el.textContent') == not_open_h_en
    assert page.eval_on_selector('#joinCard .hint', 'el=>el.textContent') == not_open_hint_en

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_join_language.png")), full_page=True)
    browser.close()
    print("=== ALL JOIN FLOW LANGUAGE CHECKS PASSED ===")
