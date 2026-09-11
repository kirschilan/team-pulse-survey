from playwright.sync_api import sync_playwright
import pathlib, re, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_v7.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ SM device: session shell (Story 2) + join link/QR (Story 3) ============
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)

    print("=== squad-1, no session yet ===")
    start_btn = page.query_selector('#startSessionBtn')
    print("Start session button present:", start_btn is not None)
    assert start_btn is not None
    print("Close session button present (should be None):", page.query_selector('#closeSessionBtn'))
    assert page.query_selector('#closeSessionBtn') is None

    page.click('#startSessionBtn')
    page.wait_for_timeout(250)
    print("=== after starting session ===")
    session_keys = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('sessions/'))")
    print("session doc keys:", session_keys)
    assert len(session_keys) == 1
    session_id = session_keys[0].split("/")[1]
    # session id is now a 6-char human-typeable code, not an auto-generated id
    print("session id looks like a 6-char code:", session_id, len(session_id))
    assert len(session_id) == 6 and session_id.isupper()
    session_doc = page.evaluate("window.__FAKE_STORE__['sessions/" + session_id + "']")
    print("session doc:", session_doc)
    assert session_doc["squadId"] == "squad-1"
    assert session_doc["squadName"] == "Squad 1"
    assert session_doc["status"] == "open"
    assert session_doc["revealMode"] == "hold"
    assert len(session_doc["dimensions"]) == 3
    print("errors:", errors)

    print("Start session button now gone:", page.query_selector('#startSessionBtn'))
    assert page.query_selector('#startSessionBtn') is None

    # ---- session code is shown prominently, front and center (primary join method) ----
    code_text = page.eval_on_selector('.session-code', 'el=>el.textContent')
    print("session code shown on card:", code_text)
    assert code_text == session_id

    # ---- QR/link now live inside a collapsed <details> secondary fallback ----
    qr_details_open = page.eval_on_selector('#squadDetail details.legend', 'el=>el.open')
    print("QR/link details collapsed by default (should be False/None):", qr_details_open)
    assert qr_details_open in (False, None)

    join_link_value = page.eval_on_selector('#sessionJoinLink', 'el=>el.value')
    print("join link value:", join_link_value)
    assert session_id in join_link_value and "?session=" in join_link_value

    # expand the details to confirm the QR/link content is real (still present, just collapsed)
    page.click('#squadDetail details.legend summary')
    page.wait_for_timeout(100)
    svg_present = page.query_selector('#sessionQr svg') is not None
    path_d_len = page.eval_on_selector('#sessionQr svg path', 'el => el ? el.getAttribute("d").length : 0') if svg_present else 0
    print("QR svg present:", svg_present, "| path data length:", path_d_len)
    assert svg_present and path_d_len > 100, "QR code should render a non-trivial SVG path"

    # copy button shouldn't throw even without real clipboard permissions
    page.click('#copyJoinLinkBtn')
    page.wait_for_timeout(100)
    print("errors after Copy click:", errors)

    # ---- switching to squad-2 shows ITS OWN start button, unaffected by squad-1's session ----
    page.click('.squad-pick-btn[data-id="squad-2"]')
    page.wait_for_timeout(150)
    print("squad-2 has its own Start button (independent sessions):", page.query_selector('#startSessionBtn') is not None)
    assert page.query_selector('#startSessionBtn') is not None
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    print("squad-1 still shows in-progress session:", page.query_selector('#closeSessionBtn') is not None)
    assert page.query_selector('#closeSessionBtn') is not None

    # ---- close the session ----
    page.click('#closeSessionBtn')
    page.wait_for_timeout(150)
    print("confirm dialog text:", page.eval_on_selector('#confirmMessage', 'el=>el.textContent'))
    page.click('#confirmOk')
    page.wait_for_timeout(250)
    session_keys_after = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('sessions/'))")
    print("session keys after close (should be empty):", session_keys_after)
    assert session_keys_after == []
    print("Start session button reappeared:", page.query_selector('#startSessionBtn') is not None)
    assert page.query_selector('#startSessionBtn') is not None
    print("FINAL errors (SM device):", errors)

    page.screenshot(path=str(test_output_path("shot_v7_sm.png")), full_page=True)

    # ============ start a session again so we can build join-screen scenarios ============
    page.click('#startSessionBtn')
    page.wait_for_timeout(250)
    session_doc_2 = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    print("=== second session created for join-screen tests ===")
    print(session_doc_2)
    page.screenshot(path=str(test_output_path("shot_v7_sm_session_card.png")))

    sid = session_doc_2["id"]
    sdoc = json.dumps(session_doc_2["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"

    # ============ participant device A: join via the ?session= URL (fallback path) ============
    # Simulate a second device by pre-seeding a FRESH page's fake store with
    # the exact session doc the SM device just created (the two pages don't
    # share a real backend in this test harness), then loading that page at
    # its join URL. This is the QR/link path -- still supported, just no
    # longer the primary path (see the iPhone bug this story fixes).
    join_out = build_page(seed_js, out_name="_test_v7_join.html")

    page2 = browser.new_page(viewport={"width":420,"height":900})
    errors2 = []
    page2.on("pageerror", lambda e: errors2.append(str(e)))
    page2.goto("file://" + str(join_out.resolve()) + "?session=" + sid)
    page2.wait_for_timeout(500)

    print("=== participant device A (join via URL) ===")
    print("view-switch hidden:", page2.eval_on_selector('.view-switch', 'el => el.hidden'))
    print("viewTribe hidden:", page2.eval_on_selector('#viewTribe', 'el => el.hidden'))
    print("viewSquad hidden:", page2.eval_on_selector('#viewSquad', 'el => el.hidden'))
    print("viewAdmin hidden:", page2.eval_on_selector('#viewAdmin', 'el => el.hidden'))
    print("viewJoin hidden (should be False):", page2.eval_on_selector('#viewJoin', 'el => el.hidden'))
    print("joinCodeBtn hidden in join mode (should be True):", page2.eval_on_selector('#joinCodeBtn', 'el => el.hidden'))
    assert page2.eval_on_selector('.view-switch', 'el => el.hidden') == True
    assert page2.eval_on_selector('#viewJoin', 'el => el.hidden') == False
    assert page2.eval_on_selector('#joinCodeBtn', 'el => el.hidden') == True

    heading = page2.eval_on_selector('#joinCard h2', 'el => el.textContent')
    print("join screen heading:", heading)
    assert "Squad 1" in heading and "retro" in heading.lower()
    # This board's active template (Spotify Squad Health Check) has no
    # statement-based dimensions -- every dimension is direct-rating, shown
    # as an openly-labeled swatch row a teammate can actually answer (fixed
    # after this test was first written, when these just listed read-only).
    dim_labels = page2.eval_on_selector_all('#joinCard .direct-row .stmt-text', 'els => els.map(e => e.textContent)')
    print("dimensions shown as answerable direct-rating rows:", dim_labels)
    assert dim_labels == ["Easy to release", "Suitable process", "Value"]
    # direct rating uses the swatch buttons, not the squad-view's cell-btn
    print("no cell-btn on join screen:", page2.query_selector('#joinCard .cell-btn'))
    assert page2.query_selector('#joinCard .cell-btn') is None
    print("errors (participant device A):", errors2)

    page2.screenshot(path=str(test_output_path("shot_v7_join.png")), full_page=True)

    # ============ participant device B: join via the "Join a retro" header button + typed code (PRIMARY path) ============
    # This is the fix for the iPhone bug: loads the plain board (no ?session=
    # in the URL at all -- exactly like scanning a QR that dropped the query
    # string, or just opening the app fresh), then uses the header button and
    # types the session code in by hand.
    code_out = build_page(seed_js, out_name="_test_v7_joincode.html")

    page3 = browser.new_page(viewport={"width":420,"height":900})
    errors3 = []
    page3.on("pageerror", lambda e: errors3.append(str(e)))
    page3.goto("file://" + str(code_out.resolve()))  # NOTE: no ?session= query string at all
    page3.wait_for_timeout(400)

    print("=== participant device B (join via typed code, no URL) ===")
    print("joinCodeBtn visible on plain load:", page3.query_selector('#joinCodeBtn') is not None)
    assert page3.query_selector('#joinCodeBtn') is not None
    print("view-switch visible before joining:", page3.eval_on_selector('.view-switch', 'el => el.hidden') == False)
    assert page3.eval_on_selector('.view-switch', 'el => el.hidden') == False

    page3.click('#joinCodeBtn')
    page3.wait_for_timeout(100)
    print("join-code modal visible:", page3.eval_on_selector('#joinCodeBackdrop', 'el => !el.hidden'))
    assert page3.eval_on_selector('#joinCodeBackdrop', 'el => !el.hidden')

    # ---- Escape key closes the modal without submitting/joining (check first, while still easy to reopen) ----
    page3.keyboard.press("Escape")
    page3.wait_for_timeout(100)
    print("modal closed by Escape:", page3.eval_on_selector('#joinCodeBackdrop', 'el => el.hidden'))
    assert page3.eval_on_selector('#joinCodeBackdrop', 'el => el.hidden') == True
    print("still on normal board after Escape (not joined):", page3.eval_on_selector('#viewJoin', 'el => el.hidden'))
    assert page3.eval_on_selector('#viewJoin', 'el => el.hidden') == True

    # reopen and actually join -- type the code in lowercase with stray
    # whitespace, submitJoinCode() should normalize it
    page3.click('#joinCodeBtn')
    page3.wait_for_timeout(100)
    page3.fill('#joinCodeInput', "  " + sid.lower() + "  ")
    page3.click('#joinCodeGo')
    page3.wait_for_timeout(500)

    print("join-code modal closed after submit:", page3.eval_on_selector('#joinCodeBackdrop', 'el => el.hidden'))
    assert page3.eval_on_selector('#joinCodeBackdrop', 'el => el.hidden') == True
    print("view-switch hidden after joining by code:", page3.eval_on_selector('.view-switch', 'el => el.hidden'))
    print("viewJoin hidden after joining by code (should be False):", page3.eval_on_selector('#viewJoin', 'el => el.hidden'))
    assert page3.eval_on_selector('.view-switch', 'el => el.hidden') == True
    assert page3.eval_on_selector('#viewJoin', 'el => el.hidden') == False

    heading3 = page3.eval_on_selector('#joinCard h2', 'el => el.textContent')
    print("join screen heading (via typed code):", heading3)
    assert "Squad 1" in heading3 and "retro" in heading3.lower()
    dim_labels3 = page3.eval_on_selector_all('#joinCard .direct-row .stmt-text', 'els => els.map(e => e.textContent)')
    print("dimensions shown as answerable direct-rating rows (via typed code):", dim_labels3)
    assert dim_labels3 == ["Easy to release", "Suitable process", "Value"]
    print("errors (participant device B):", errors3)

    page3.screenshot(path=str(test_output_path("shot_v7_joincode.png")), full_page=True)

    # ============ bad/expired code, typed by hand ============
    badcode_out = build_page(out_name="_test_v7_badcode.html")
    page4 = browser.new_page(viewport={"width":420,"height":900})
    errors4 = []
    page4.on("pageerror", lambda e: errors4.append(str(e)))
    page4.goto("file://" + str(badcode_out.resolve()))
    page4.wait_for_timeout(400)
    page4.click('#joinCodeBtn')
    page4.wait_for_timeout(100)
    page4.fill('#joinCodeInput', "ZZZZZZ")
    page4.click('#joinCodeGo')
    page4.wait_for_timeout(500)
    heading4 = page4.eval_on_selector('#joinCard h2', 'el => el.textContent')
    print("=== bad/nonexistent typed code ===")
    print("heading:", heading4)
    assert "isn" in heading4.lower() and "open" in heading4.lower()
    print("errors (bad code device):", errors4)

    # ============ bad/expired link (?session= query string) ============
    bad_out = build_page(out_name="_test_v7_badjoin.html")
    page5 = browser.new_page(viewport={"width":420,"height":900})
    errors5 = []
    page5.on("pageerror", lambda e: errors5.append(str(e)))
    page5.goto("file://" + str(bad_out.resolve()) + "?session=does-not-exist")
    page5.wait_for_timeout(500)
    heading5 = page5.eval_on_selector('#joinCard h2', 'el => el.textContent')
    print("=== bad/nonexistent session link ===")
    print("heading:", heading5)
    assert "isn" in heading5.lower() and "open" in heading5.lower()
    print("errors (bad link device):", errors5)

    print("=== ALL ERRORS: SM=", errors, "joinA(url)=", errors2, "joinB(code)=", errors3, "badcode=", errors4, "badlink=", errors5)
    browser.close()
