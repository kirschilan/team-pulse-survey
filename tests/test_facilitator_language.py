from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 11 (see STATUS.md's backlog table): the retro
# FACILITATION flow -- the session card (no-session hint + Start button,
# session code block, live/hold reveal toggle, live results / results held,
# the response-consolidation table, the sprint-experiment note, finish/close
# buttons and their confirm dialogs, the share-link and co-facilitator
# <details> sections), plus the per-dimension override editor (shares the
# rating modal's own markup -- see modals.js). Dimension content itself
# (label/green/red/statement text) stays untranslated by design, same
# principle Story 9/10 established for template/session content.

out_path = build_page(out_name="_test_facilitator_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1400})
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
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)

    print("=== no-session card: Hebrew hint + Start button, no more forced ltr opt-out ===")
    assert page.eval_on_selector('.session-card', 'el=>el.getAttribute("dir")') != "ltr"
    no_session_hint = page.eval_on_selector('.session-card .hint', 'el=>el.textContent')
    start_btn_he = page.eval_on_selector('#startSessionBtn', 'el=>el.textContent')
    print(no_session_hint, "|", start_btn_he)
    assert no_session_hint.strip() and "teammates can join" not in no_session_hint
    assert start_btn_he != "Start retro session" and start_btn_he.strip()

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

    print("=== session-in-progress card chrome is Hebrew ===")
    in_progress_h = page.eval_on_selector('.session-card h2', 'el=>el.textContent')
    retro_line = page.eval_on_selector('.session-card > .hint', 'el=>el.textContent')
    code_heading = page.eval_on_selector('.session-code-block .field-label', 'el=>el.textContent')
    code_hint = page.eval_on_selector('.session-code-block .hint', 'el=>el.textContent')
    print(in_progress_h, "|", retro_line, "|", code_heading, "|", code_hint)
    assert in_progress_h != "Retro session in progress" and in_progress_h.strip()
    assert "The Five Dysfunctions of a Team" in retro_line
    assert code_heading.strip() and code_heading != "Session code"
    assert code_hint.strip() and "Join a retro" not in code_hint

    hold_btn_he = page.eval_on_selector('.reveal-btn[data-reveal="hold"]', 'el=>el.textContent')
    live_btn_he = page.eval_on_selector('.reveal-btn[data-reveal="live"]', 'el=>el.textContent')
    held_heading_he = page.eval_on_selector('.live-block .field-label', 'el=>el.textContent')
    print("reveal toggle / held heading (Hebrew):", hold_btn_he, "|", live_btn_he, "|", held_heading_he)
    assert hold_btn_he != "Hold results" and hold_btn_he.strip()
    assert live_btn_he != "Show live" and live_btn_he.strip()
    assert held_heading_he != "Results held" and held_heading_he.strip()

    exp_headings = page.eval_on_selector_all('.session-card .field-label', 'els=>els.map(e=>e.textContent)')
    print("field-label headings (Hebrew, should include experiment + code + held):", exp_headings)
    assert not any(h in ("Sprint experiment", "Session code", "Results held") for h in exp_headings)

    note_placeholder_he = page.eval_on_selector('#experimentNoteBox', 'el=>el.placeholder')
    save_note_btn_he = page.eval_on_selector('#saveExperimentNoteBtn', 'el=>el.textContent')
    print("note placeholder / save button (Hebrew):", note_placeholder_he, "|", save_note_btn_he)
    assert note_placeholder_he != "e.g. Pair on the riskiest story each day" and note_placeholder_he.strip()
    assert save_note_btn_he != "Save note" and save_note_btn_he.strip()

    page.fill('#experimentNoteBox', 'test note')
    page.click('#saveExperimentNoteBtn')
    page.wait_for_timeout(100)
    saved_hint_he = page.eval_on_selector('#expNoteSavedHint', 'el=>el.textContent')
    print("'Saved' hint (Hebrew):", saved_hint_he)
    assert saved_hint_he != "Saved" and saved_hint_he.strip()

    detail_summaries_he = page.eval_on_selector_all('.session-card details.legend summary', 'els=>els.map(e=>e.textContent)')
    print("share-link / co-facilitator detail summaries (Hebrew):", detail_summaries_he)
    assert not any(s in ("Or scan/share a link", "Bring in a co-facilitator") for s in detail_summaries_he)

    join_link_label_he = page.eval_on_selector('.join-link-col .field-label', 'el=>el.textContent')
    copy_btn_he = page.eval_on_selector('#copyJoinLinkBtn', 'el=>el.textContent')
    print("join-link label / copy button (Hebrew):", join_link_label_he, "|", copy_btn_he)
    assert join_link_label_he != "Join link" and join_link_label_he.strip()
    assert copy_btn_he != "Copy" and copy_btn_he.strip()

    finish_btn_he = page.eval_on_selector('#finishSessionBtn', 'el=>el.textContent')
    close_btn_he = page.eval_on_selector('#closeSessionBtn', 'el=>el.textContent')
    print("finish / close buttons (Hebrew):", finish_btn_he, "|", close_btn_he)
    assert finish_btn_he != "Finish retro & apply results" and finish_btn_he.strip()
    assert close_btn_he != "Close session without applying results" and close_btn_he.strip()

    print("=== live results: dim names + pill words + response table are Hebrew chrome ===")
    responses = [{"answers": {k: [3, 3, 3] for k in dim_keys}} for _ in range(2)]
    page.evaluate("""
      (function(responses){
        responses.forEach(function(r, i){
          window.__FAKE_STORE__['sessions/%s/responses/r'+i] = r;
        });
        window.__NOTIFY__('sessions/%s/responses');
      })(%s);
    """ % (sid, sid, json.dumps(responses)))
    page.wait_for_timeout(200)
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(200)

    live_heading_he = page.eval_on_selector('.live-block .field-label', 'el=>el.textContent')
    count_line_he = page.eval_on_selector('.live-block > .hint', 'el=>el.textContent')
    print("live heading / count line (Hebrew):", live_heading_he, "|", count_line_he)
    assert live_heading_he != "Live results" and live_heading_he.strip()
    assert count_line_he.strip() and "submitted" not in count_line_he

    pill_words_he = page.eval_on_selector_all('.live-dim-row .pill', 'els=>els.map(e=>e.textContent)')
    print("pill words (Hebrew):", pill_words_he)
    assert not any(w in ("Green", "Yellow", "Red", "Waiting…") for w in pill_words_he)

    resp_summary_he = page.eval_on_selector('.resp-details summary', 'el=>el.childNodes[0].textContent')
    print("response-table summary (Hebrew):", resp_summary_he)
    assert resp_summary_he.strip() and "response" not in resp_summary_he.lower()
    page.click('.resp-details summary')
    page.wait_for_timeout(100)
    resp_row_head = page.eval_on_selector('.resp-table tbody tr th', 'el=>el.textContent')
    print("response row label (Hebrew):", resp_row_head)
    assert resp_row_head != "Response 1" and resp_row_head.strip()

    print("=== override editor: title/squadline/note-placeholder are Hebrew ===")
    page.click('.override-btn[data-override-dim="trust"]')
    page.wait_for_timeout(150)
    squadline_he = page.eval_on_selector('#modalSquadline', 'el=>el.textContent')
    note_ph_he = page.eval_on_selector('#modalNote', 'el=>el.placeholder')
    print("override squadline / note placeholder (Hebrew):", squadline_he, "|", note_ph_he)
    assert squadline_he != "Overriding this retro’s consolidated result" and squadline_he.strip()
    assert note_ph_he != "Why override this? (optional)" and note_ph_he.strip()
    page.click('#modalCancel')
    page.wait_for_timeout(100)

    print("=== close-session confirm dialog is Hebrew ===")
    page.click('#closeSessionBtn')
    page.wait_for_timeout(150)
    close_title_he = page.eval_on_selector('#confirmTitle', 'el=>el.textContent')
    close_msg_he = page.eval_on_selector('#confirmMessage', 'el=>el.textContent')
    close_ok_he = page.eval_on_selector('#confirmOk', 'el=>el.textContent')
    print("close confirm (Hebrew):", close_title_he, "|", close_msg_he, "|", close_ok_he)
    assert close_title_he != "Close this retro session?" and close_title_he.strip()
    assert "Squad 1" in close_msg_he and "existing ratings" not in close_msg_he
    assert close_ok_he.strip() and close_ok_he != "Close without applying results"
    page.click('#confirmCancel')
    page.wait_for_timeout(100)

    print("=== finish confirm dialog is Hebrew, includes the dimension summary ===")
    page.click('#finishSessionBtn')
    page.wait_for_timeout(150)
    finish_title_he = page.eval_on_selector('#confirmTitle', 'el=>el.textContent')
    finish_msg_he = page.eval_on_selector('#confirmMessage', 'el=>el.textContent')
    finish_ok_he = page.eval_on_selector('#confirmOk', 'el=>el.textContent')
    print("finish confirm (Hebrew):", finish_title_he, "|", finish_msg_he, "|", finish_ok_he)
    assert finish_title_he != "Finish this retro?" and finish_title_he.strip()
    assert "Squad 1" in finish_msg_he
    assert finish_ok_he != "Finish & apply" and finish_ok_he.strip()
    page.click('#confirmCancel')
    page.wait_for_timeout(100)

    print("=== switching back to English restores every string above ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    assert page.eval_on_selector('.session-card h2', 'el=>el.textContent') == "Retro session in progress"
    assert page.eval_on_selector('#finishSessionBtn', 'el=>el.textContent') == "Finish retro & apply results"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_facilitator_language.png")), full_page=True)
    browser.close()
    print("=== ALL FACILITATOR LANGUAGE CHECKS PASSED ===")
