from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 10 (see STATUS.md's backlog table): the retro
# JOIN flow -- the "Join a retro" code-entry modal, the join screen's own
# connecting/ended/unreachable/not-open states, the survey form chrome
# (scale buttons, the "Squad health check" sub-heading, Submit), and the
# personal-result screen afterward. Dimension content itself (label/green/
# red/statement text) stays untranslated by design -- same principle Story 9
# applied to template names: it's the admin's own authored content,
# snapshotted onto the session at start time, not app chrome.

out_path = build_page(out_name="_test_join_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 420, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    print("=== join-code modal chrome is Hebrew ===")
    page.click('#joinCodeBtn')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('#joinCodeBackdrop', 'el=>el.getAttribute("dir")') == "rtl"
    title_he = page.eval_on_selector('#joinCodeBackdrop h3', 'el=>el.textContent')
    hint_he = page.eval_on_selector('#joinCodeBackdrop .hint', 'el=>el.textContent')
    placeholder_he = page.eval_on_selector('#joinCodeInput', 'el=>el.placeholder')
    cancel_he = page.eval_on_selector('#joinCodeCancel', 'el=>el.textContent')
    cofac_he = page.eval_on_selector('#coFacilitateGo', 'el=>el.textContent')
    join_he = page.eval_on_selector('#joinCodeGo', 'el=>el.textContent')
    print(title_he, "|", hint_he, "|", placeholder_he, "|", cancel_he, "|", cofac_he, "|", join_he)
    assert title_he != "Join a retro" and title_he.strip()
    assert hint_he.strip() and "Scrum Master" not in hint_he
    assert placeholder_he != "e.g. 7K4QXB" and placeholder_he.strip()
    assert cancel_he != "Cancel" and cancel_he.strip()
    assert cofac_he != "Co-facilitate" and cofac_he.strip()
    assert join_he != "Join" and join_he.strip()

    print("=== a bad/unknown code shows the Hebrew 'not open' state ===")
    page.fill('#joinCodeInput', 'ZZZZZZ')
    page.click('#joinCodeGo')
    page.wait_for_timeout(250)
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
    page.evaluate("state.joinUnavailable = true; renderJoinScreen();")
    page.wait_for_timeout(100)
    unavail_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    unavail_hint = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    print(unavail_h, "|", unavail_hint)
    assert unavail_h.strip() and "connect" not in unavail_h.lower()
    assert unavail_hint.strip() and "relay" not in unavail_hint.lower()
    page.evaluate("state.joinUnavailable = false;")

    print("=== a CLOSED session shows the Hebrew 'ended' state ===")
    # joinCodeBtn stays hidden forever once a device has joined once (see
    # retro-join.js's exitJoinScreen() comment) -- a real participant only
    # ever picks one session per device, so subsequent scenarios here call
    # joinSessionByCode() directly instead of re-opening the (gone) modal.
    page.evaluate("""
      window.__FAKE_STORE__['sessions/CLOSEDX'] = {
        squadId:'squad-1', squadName:'Squad 1', templateName:'Custom',
        dimensions:[], status:'closed', revealMode:'hold', overrides:{}
      };
      joinSessionByCode('CLOSEDX');
    """)
    page.wait_for_timeout(250)
    ended_h = page.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    ended_hint = page.eval_on_selector('#joinCard .hint', 'el=>el.textContent')
    print(ended_h, "|", ended_hint)
    assert ended_h.strip() and "ended" not in ended_h.lower()
    assert ended_hint.strip() and "facilitator" not in ended_hint.lower()

    print("=== a real OPEN mixed-dimension session: survey form chrome is Hebrew ===")
    page.evaluate("""
      window.__FAKE_STORE__['sessions/MIXEDXX'] = {
        squadId:'squad-1', squadName:'Squad 1', templateName:'Custom',
        status:'open', revealMode:'hold', overrides:{}, experimentNote:'',
        dimensions: [
          { key:'trust', label:'Trust', green:'', red:'', order:1,
            statements:['Statement one', 'Statement two'], scoreBands:{good:5,warn:3} },
          { key:'health', label:'Health', green:'Feels healthy', red:'Feels unhealthy', order:2 }
        ]
      };
      joinSessionByCode('MIXEDXX');
    """)
    page.wait_for_timeout(250)

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
    for btn in page.query_selector_all('.stmt-row .scale-btn[data-value="3"]'):
        btn.click()
        page.wait_for_timeout(15)
    page.click('.direct-row .swatch.good')
    page.wait_for_timeout(50)
    assert page.eval_on_selector('#stmtSubmitBtn', 'el=>el.disabled') == False
    page.click('#stmtSubmitBtn')
    page.wait_for_timeout(300)

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
    # joinCodeBtn stays hidden forever once a device has joined once, so
    # read the (hidden but still real) modal DOM directly rather than
    # re-opening it by click.
    page.click('#exitJoinBtn')
    page.wait_for_timeout(100)
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('#joinCodeBackdrop h3', 'el=>el.textContent') == "Join a retro"
    assert page.eval_on_selector('#joinCodeGo', 'el=>el.textContent') == "Join"
    assert page.eval_on_selector('#joinCodeBackdrop', 'el=>el.getAttribute("dir")') != "rtl"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_join_language.png")), full_page=True)
    browser.close()
    print("=== ALL JOIN FLOW LANGUAGE CHECKS PASSED ===")
