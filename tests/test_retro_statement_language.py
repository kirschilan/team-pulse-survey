from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Real bug report from usage (screenshots): a participant's retro join
# screen showed Hebrew chrome (heading, hint, scale button labels -- Story
# 10) but the actual survey STATEMENT text ("Team members are still
# learning about each other's roles...") stayed English, because Stories
# 5/7/8 deliberately scoped dimension-CONTENT translation to label/green/
# red/attribution only, explicitly excluding .statements/.strategies. This
# extends that translation to the retro survey content itself: the
# interleaved statement questions, a direct-rating dimension's openly-shown
# label/green/red, and the personal-result screen's label/message/
# strategies -- using localizedSessionDimText() (state.js), which (unlike
# localizedDimText()) is keyed off the SESSION's own frozen templateName
# rather than the live board's current template, and handles array fields
# (statements/strategies) with a value-based match, not the reference
# equality that would be wrong for them.

out_path = build_page(out_name="_test_retro_statement_lang.html")

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
    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(300)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

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
    forming_en = next(d for d in session_info["doc"]["dimensions"] if d["key"] == "forming")

    print("=== facilitator's own live results: dimension names are Hebrew too now ===")
    responses = [{"answers": {k: [3, 3, 3, 3] for k in [d["key"] for d in session_info["doc"]["dimensions"]]}}]
    page.evaluate("""
      window.__FAKE_STORE__['sessions/%s/responses/r0'] = %r;
      window.__NOTIFY__('sessions/%s/responses');
    """ % (sid, responses[0], sid))
    page.wait_for_timeout(200)
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(200)
    live_dim_names_he = page.eval_on_selector_all('.live-dim-row .dim-name', 'els=>els.map(e=>e.textContent)')
    print("live dimension names (Hebrew):", live_dim_names_he)
    assert "Forming" not in live_dim_names_he and any("התהוות" in n for n in live_dim_names_he)

    print("=== override editor: dimension title/green/red are Hebrew now (session-scoped template) ===")
    page.click('.override-btn[data-override-dim="forming"]')
    page.wait_for_timeout(150)
    modal_title_he = page.eval_on_selector('#modalTitle', 'el=>el.textContent')
    modal_green_he = page.eval_on_selector('#modalGreen', 'el=>el.textContent')
    print("override modal title / green (Hebrew):", modal_title_he, "|", modal_green_he)
    assert modal_title_he == "התהוות"
    assert modal_green_he.strip() and modal_green_he != forming_en["green"]
    page.click('#modalCancel')
    page.wait_for_timeout(100)

    # ============ participant device joins the SAME session, own tab (fake store shared) ============
    page.evaluate("joinSessionByCode('%s')" % sid)
    page.wait_for_timeout(300)

    print("=== participant: interleaved statement text is Hebrew, in the right order ===")
    first_stmt_he = page.eval_on_selector('.stmt-row:first-child .stmt-text', 'el=>el.textContent')
    print("first interleaved statement (Hebrew):", first_stmt_he)
    assert first_stmt_he.strip() and first_stmt_he not in [
        s for d in session_info["doc"]["dimensions"] for s in (d.get("statements") or [])
    ]

    # every dimension's Hebrew translation for its FIRST statement should be
    # among the rendered first-round rows (round-robin: dim order, idx 0 first)
    he_first_statements = page.evaluate("""
      Object.values(TUCKMAN_TEMPLATE.i18n.he.dimensions).map(function(d){ return d.statements[0]; })
    """)
    all_stmt_texts = page.eval_on_selector_all('.stmt-row .stmt-text', 'els=>els.map(e=>e.textContent)')
    print("Hebrew idx-0 statements found among rendered rows:", [s for s in he_first_statements if s in all_stmt_texts])
    assert all(s in all_stmt_texts for s in he_first_statements)

    print("=== answering and submitting shows a Hebrew personal-result screen with the right green/red message ===")
    for btn in page.query_selector_all('.stmt-row .scale-btn[data-value="3"]'):
        btn.click()
        page.wait_for_timeout(10)
    page.wait_for_timeout(50)
    page.click('#stmtSubmitBtn')
    page.wait_for_timeout(300)

    result_labels_he = page.eval_on_selector_all('.personal-result .field-label', 'els=>els.map(e=>e.textContent)')
    print("personal-result dimension labels (Hebrew):", result_labels_he)
    assert "Forming" not in result_labels_he and any("התהוות" in l for l in result_labels_he)

    forming_msg_he = page.eval_on_selector('.personal-result:has(.field-label:text("התהוות")) p.hint', 'el=>el.textContent')
    expected_green_he = page.evaluate("TUCKMAN_TEMPLATE.i18n.he.dimensions.forming.green")
    print("Forming's result message (Hebrew, matches green since all answered 'Usually'/3):", forming_msg_he)
    assert forming_msg_he == expected_green_he

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_retro_statement_language.png")), full_page=True)
    browser.close()
    print("=== ALL RETRO STATEMENT LANGUAGE CHECKS PASSED ===")
