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
# strategies -- using localizedDimText() (state.js), which reads a
# dimension's own `i18n.he` field directly (the bilingual-dimensions
# redesign -- see STATUS.md) and works identically whether `dim` is a live
# board dimension or a retro session's frozen snapshot copy, since the
# `i18n` field travels with the dimension wherever it's copied (see
# startSession() in retro-facilitator.js).

out_path = build_page(out_name="_test_retro_statement_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1400})
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
    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    page.click('#confirmOk')
    # evaluate() below doesn't auto-wait -- wait for the real "Tuckman's
    # dimensions landed" signal (loadTemplate()'s own Promise chain) instead
    # of guessing how long it takes.
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/forming'] !== undefined")
    # setLocale() (i18n.js) is fully synchronous -- no wait needed here.
    page.click('.lang-btn[data-lang="he"]')

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
    forming_en = next(d for d in session_info["doc"]["dimensions"] if d["key"] == "forming")

    print("=== facilitator's own live results: dimension names are Hebrew too now ===")
    responses = [{"answers": {k: [3, 3, 3, 3] for k in [d["key"] for d in session_info["doc"]["dimensions"]]}}]
    page.evaluate("""
      window.__FAKE_STORE__['sessions/%s/responses/r0'] = %r;
      window.__NOTIFY__('sessions/%s/responses');
    """ % (sid, responses[0], sid))
    # No wait needed here -- window.__NOTIFY__() calls the fake store's
    # notify() SYNCHRONOUSLY (unlike a real onSnapshot's first delivery,
    # which the fixture delays), which synchronously updates
    # state.sessionResponses inside retro-facilitator.js's listener before
    # this evaluate() call even returns.
    page.click('.reveal-btn[data-reveal="live"]')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "live rows rendered" signal instead of guessing.
    page.wait_for_selector('.live-dim-row', state="attached")
    live_dim_names_he = page.eval_on_selector_all('.live-dim-row .dim-name', 'els=>els.map(e=>e.textContent)')
    print("live dimension names (Hebrew):", live_dim_names_he)
    assert "Forming" not in live_dim_names_he and any("התהוות" in n for n in live_dim_names_he)

    print("=== override editor: dimension title/green/red are Hebrew now (session-scoped template) ===")
    page.click('.override-btn[data-override-dim="forming"]')
    page.wait_for_selector('#backdrop', state="visible")  # real modal-open signal, not a guess
    modal_title_he = page.eval_on_selector('#modalTitle', 'el=>el.textContent')
    modal_green_he = page.eval_on_selector('#modalGreen', 'el=>el.textContent')
    print("override modal title / green (Hebrew):", modal_title_he, "|", modal_green_he)
    assert modal_title_he == "התהוות"
    assert modal_green_he.strip() and modal_green_he != forming_en["green"]
    # No wait needed here -- closing the modal doesn't affect the
    # unrelated joinSessionByCode() call below.
    page.click('#modalCancel')

    # ============ participant device joins the SAME session, own tab (fake store shared) ============
    # joinSessionByCode() renders the "Connecting..." placeholder
    # synchronously (state.joinSession starts null), and only shows the
    # real statement form once listenJoinSession()'s onSnapshot listener
    # delivers its FIRST snapshot -- a genuine async gap the fake store
    # deliberately delays (unlike its later, synchronous notify() calls) --
    # so wait for the real "form rendered" signal instead of guessing.
    page.evaluate("joinSessionByCode('%s')" % sid)
    page.wait_for_selector('.stmt-row', state="attached")

    print("=== participant: interleaved statement text is Hebrew, in the right order ===")
    first_stmt_he = page.eval_on_selector('.stmt-row:first-child .stmt-text', 'el=>el.textContent')
    print("first interleaved statement (Hebrew):", first_stmt_he)
    assert first_stmt_he.strip() and first_stmt_he not in [
        s for d in session_info["doc"]["dimensions"] for s in (d.get("statements") or [])
    ]

    # every dimension's Hebrew translation for its FIRST statement should be
    # among the rendered first-round rows (round-robin: dim order, idx 0 first)
    he_first_statements = page.evaluate("""
      TUCKMAN_TEMPLATE.dimensions.map(function(d){ return d.i18n.he.statements[0]; })
    """)
    all_stmt_texts = page.eval_on_selector_all('.stmt-row .stmt-text', 'els=>els.map(e=>e.textContent)')
    print("Hebrew idx-0 statements found among rendered rows:", [s for s in he_first_statements if s in all_stmt_texts])
    assert all(s in all_stmt_texts for s in he_first_statements)

    print("=== answering and submitting shows a Hebrew personal-result screen with the right green/red message ===")
    # refreshSubmitEnabled() (retro-join.js) runs synchronously inside each
    # scale-btn's own click handler, so no wait is needed between clicks.
    for btn in page.query_selector_all('.stmt-row .scale-btn[data-value="3"]'):
        btn.click()
    page.click('#stmtSubmitBtn')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "personal results rendered" signal instead of guessing.
    page.wait_for_selector('.personal-result', state="attached")

    result_labels_he = page.eval_on_selector_all('.personal-result .field-label', 'els=>els.map(e=>e.textContent)')
    print("personal-result dimension labels (Hebrew):", result_labels_he)
    assert "Forming" not in result_labels_he and any("התהוות" in l for l in result_labels_he)

    forming_msg_he = page.eval_on_selector('.personal-result:has(.field-label:text("התהוות")) p.hint', 'el=>el.textContent')
    expected_green_he = page.evaluate("TUCKMAN_TEMPLATE.dimensions.find(d=>d.key==='forming').i18n.he.green")
    print("Forming's result message (Hebrew, matches green since all answered 'Usually'/3):", forming_msg_he)
    assert forming_msg_he == expected_green_he

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_retro_statement_language.png")), full_page=True)
    browser.close()
    print("=== ALL RETRO STATEMENT LANGUAGE CHECKS PASSED ===")
