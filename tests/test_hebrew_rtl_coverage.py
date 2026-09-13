from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Real Hebrew script fixtures -- not just checking dir="auto" is PRESENT in
# markup (that was the entire extent of the old sanity check this file
# replaces), but that Chromium's bidi algorithm actually resolves each
# dir="auto" field to rtl once it holds real RTL content, live-typed or
# already stored. Each Hebrew check is paired with a plain-English control on
# a sibling element, so a false positive (an element that's hardcoded/always
# "rtl" no matter what) would be caught, not just an always-true assertion.
HEB_SQUAD = "יחידה א"
HEB_LABEL = "שחרור קל"
HEB_LABEL_V2 = "שחרור קל (גרסה 2)"
HEB_GREEN = "שחרורים הם שגרתיים ובטוחים"
HEB_RED = "שחרורים הם נדירים ומסוכנים"
HEB_NOTE = "הערה בעברית לבדיקה"
HEB_TPL_NAME = "התבנית שלי"

out_path = build_page(out_name="_test_hebrew_rtl.html")


def direction(pg, selector):
    return pg.eval_on_selector(selector, "el => getComputedStyle(el).direction")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # ================= 1. Admin: dimension manager (dimensions.js) =================
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)

    label_input = page.query_selector('.dim-row[data-key="release"] input.dim-label')
    label_input.fill(HEB_LABEL)
    label_input.dispatch_event("change")
    green_box = page.query_selector('.dim-row[data-key="release"] textarea[data-field="green"]')
    green_box.fill(HEB_GREEN)
    green_box.dispatch_event("change")
    red_box = page.query_selector('.dim-row[data-key="release"] textarea[data-field="red"]')
    red_box.fill(HEB_RED)
    red_box.dispatch_event("change")
    page.wait_for_timeout(200)

    print("=== dimensions.js: dim-label / green / red textareas ===")
    d1 = direction(page, '.dim-row[data-key="release"] input.dim-label')
    d2 = direction(page, '.dim-row[data-key="release"] textarea[data-field="green"]')
    d3 = direction(page, '.dim-row[data-key="release"] textarea[data-field="red"]')
    print("label:", d1, "green:", d2, "red:", d3)
    assert d1 == "rtl" and d2 == "rtl" and d3 == "rtl", "expected Hebrew dimension fields to resolve rtl"

    # English control on a sibling dimension -- proves .dim-label isn't just
    # always "rtl" regardless of what's typed into it
    other_label = page.query_selector('.dim-row[data-key="process"] input.dim-label')
    other_label.fill("Plain English Label")
    other_label.dispatch_event("change")
    page.wait_for_timeout(150)
    d_en = direction(page, '.dim-row[data-key="process"] input.dim-label')
    print("English control dim-label direction:", d_en)
    assert d_en == "ltr", "expected English dimension label to resolve ltr, got " + d_en
    page.click('#dimDoneBtn')

    # ================= 2. Admin: squad name + team-join input (squads.js / index.html) =================
    name_input = page.query_selector('#adminSquadList .admin-squad-name[data-id="squad-1"]')
    name_input.fill(HEB_SQUAD)
    name_input.dispatch_event("change")
    page.wait_for_timeout(200)
    print("=== squads.js: admin squad-name input ===")
    d = direction(page, '#adminSquadList .admin-squad-name[data-id="squad-1"]')
    print("direction:", d)
    assert d == "rtl"

    join_input = page.query_selector('#teamJoinInput')
    join_input.fill(HEB_SQUAD)
    print("=== index.html: #teamJoinInput (dir=auto on typed Hebrew) ===")
    print("direction:", direction(page, '#teamJoinInput'))
    assert direction(page, '#teamJoinInput') == "rtl"
    join_input.fill("")  # don't leave stray text behind for later steps

    # ================= 3. Squad view (squads.js) =================
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(150)
    print("=== squads.js: squad-pick-btn (Hebrew squad name) ===")
    print("direction:", direction(page, '.squad-pick-btn[data-id="squad-1"]'))
    assert direction(page, '.squad-pick-btn[data-id="squad-1"]') == "rtl"

    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    print("=== squads.js: heatmap heading, entry-label, entry-desc ===")
    print("heading:", direction(page, '.heatmap-head h2'))
    print("entry-label:", direction(page, '.entry-row:has(.cell-btn[data-dim="release"]) .entry-label'))
    print("entry-desc (green):", direction(page, '.entry-row:has(.cell-btn[data-dim="release"]) .entry-desc'))
    assert direction(page, '.heatmap-head h2') == "rtl"
    assert direction(page, '.entry-row:has(.cell-btn[data-dim="release"]) .entry-label') == "rtl"
    assert direction(page, '.entry-row:has(.cell-btn[data-dim="release"]) .entry-desc') == "rtl"

    # ================= 4. Cell rating modal (index.html) =================
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(150)
    print("=== index.html: rating modal title/squadline/green/red ===")
    print("title:", direction(page, '#modalTitle'))
    print("squadline:", direction(page, '#modalSquadline'))
    print("green:", direction(page, '#modalGreen'))
    print("red:", direction(page, '#modalRed'))
    assert direction(page, '#modalTitle') == "rtl"
    assert direction(page, '#modalSquadline') == "rtl"
    assert direction(page, '#modalGreen') == "rtl"
    assert direction(page, '#modalRed') == "rtl"

    note_box = page.query_selector('#modalNote')
    note_box.fill(HEB_NOTE)
    print("note (live-typed Hebrew):", direction(page, '#modalNote'))
    assert direction(page, '#modalNote') == "rtl"
    page.click('.swatch.crit')  # red, so hotspots below actually show it
    page.click('#trendsel button[data-trend="down"]')
    page.click('#modalSave')
    page.wait_for_timeout(250)
    print("errors so far:", errors)

    # ================= 5. Squad view's own hotspots (squads.js) =================
    print("=== squads.js: 'Your hotspots' dim label ===")
    print("direction:", direction(page, '.hotspot-row .hd .dim'))
    assert direction(page, '.hotspot-row .hd .dim') == "rtl"

    # ================= 6. Tribe view (render.js) =================
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    print("=== render.js: cross-squad hotspot dim label ===")
    print("direction:", direction(page, '#hotspotList .hotspot-row .dim'))
    assert direction(page, '#hotspotList .hotspot-row .dim') == "rtl"

    page.click('#squadBreakdown summary')
    page.wait_for_timeout(150)
    print("=== render.js: rank-row squad name, grid squad-name, dim-th-label ===")
    print("rank name:", direction(page, '.rank-row .name'))
    print("grid squad-name:", direction(page, '.squad-name'))
    print("dim-th-label:", direction(page, '.dim-th-label[data-dim-key="release"]'))
    assert direction(page, '.rank-row .name') == "rtl"
    assert direction(page, '.squad-name') == "rtl"
    assert direction(page, '.dim-th-label[data-dim-key="release"]') == "rtl"

    # header tooltip (JS-positioned, shown on focus -- see render.js's showDimTooltip)
    page.focus('.dim-th-label[data-dim-key="release"]')
    page.wait_for_timeout(100)
    print("=== render.js: dim header tooltip title/green/red ===")
    print("tip-title:", direction(page, '#dimTooltip .tip-title'))
    print("tip-row green:", direction(page, '#dimTooltip .tip-row:nth-child(2) span[dir="auto"]'))
    assert direction(page, '#dimTooltip .tip-title') == "rtl"
    assert direction(page, '#dimTooltip .tip-row:nth-child(2) span[dir="auto"]') == "rtl"

    legend_summary = page.query_selector('details.legend:not(#squadBreakdown) summary')
    legend_summary.click()
    page.wait_for_timeout(150)
    print("=== render.js: legend green/red ===")
    print("lh:", direction(page, '.legend-item:has-text("' + HEB_LABEL + '") .lh'))
    # The "Green:"/"Red:" labels are hardcoded English bold prefixes sharing
    # a <p> with the translatable content -- dir="auto" is scoped to just the
    # inner span (not the whole <p>, which would resolve ltr off the English
    # prefix's first-strong character and mis-render translated content; see
    # this file's git history for the render.js fix this test caught).
    print("green content span:", direction(page, '.legend-item:has-text("' + HEB_LABEL + '") p span[dir="auto"]'))
    assert direction(page, '.legend-item:has-text("' + HEB_LABEL + '") .lh') == "rtl"
    assert direction(page, '.legend-item:has-text("' + HEB_LABEL + '") p span[dir="auto"]') == "rtl"

    # ================= 7. Templates modal (templates.js) =================
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    tpl_input = page.query_selector('#tplNameInput')
    tpl_input.fill(HEB_TPL_NAME)
    print("=== templates.js: tplNameInput (live-typed Hebrew) ===")
    print("direction:", direction(page, '#tplNameInput'))
    assert direction(page, '#tplNameInput') == "rtl"
    page.click('#tplSaveBtn')
    page.wait_for_timeout(200)
    print("=== templates.js: saved template row name (.tname) ===")
    # scoped to the row we just saved -- the starter templates (Spotify,
    # Five Dysfunctions, Tuckman) render first and are plain English, so an
    # unscoped ".tpl-row .tname" would grab one of those instead
    saved_row = '.tpl-row:has-text("' + HEB_TPL_NAME + '") .tname'
    print("direction:", direction(page, saved_row))
    assert direction(page, saved_row) == "rtl"
    page.click('#tplCloseBtn')
    page.wait_for_timeout(100)

    # ================= 8. Retro facilitator + join flow (retro-facilitator.js / retro-join.js) =================
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(150)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#startSessionBtn')
    page.wait_for_timeout(300)
    print("=== retro-facilitator.js: live-dim-row dim-name ===")
    page.click('.reveal-btn[data-reveal="live"]')
    page.wait_for_timeout(150)
    print("direction:", direction(page, '.live-dim-row .dim-name'))
    assert direction(page, '.live-dim-row .dim-name') == "rtl"

    note = page.query_selector('#experimentNoteBox')
    note.fill(HEB_NOTE)
    print("experimentNoteBox (live-typed Hebrew):", direction(page, '#experimentNoteBox'))
    assert direction(page, '#experimentNoteBox') == "rtl"
    page.click('#saveExperimentNoteBtn')
    page.wait_for_timeout(150)

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]
    print("session started:", sid, "dims:", [d["key"] for d in session_info["doc"]["dimensions"]])

    # ---- participant device joins the same (direct-rating) retro ----
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    participant_path = build_page(seed_js, out_name="_test_hebrew_rtl_participant.html")
    pageP = browser.new_page(viewport={"width": 420, "height": 1400})
    errorsP = []
    pageP.on("pageerror", lambda e: errorsP.append(str(e)))
    pageP.goto("file://" + str(participant_path.resolve()) + "?session=" + sid)
    pageP.wait_for_timeout(400)

    print("=== retro-join.js: direct-row dim label + green/red anchors ===")
    print("stmt-text:", direction(pageP, '.direct-row[data-dim="release"] .stmt-text'))
    # Same "Green:"/"Red:" English-prefix-sharing-a-container shape as the
    # legend above (see the render.js/retro-join.js fix this test drove) --
    # dir="auto" lives on the inner spans, not the shared <p>.
    print("green anchor:", direction(pageP, '.direct-row[data-dim="release"] p span[dir="auto"]'))
    assert direction(pageP, '.direct-row[data-dim="release"] .stmt-text') == "rtl"
    anchor_dirs = pageP.eval_on_selector_all(
        '.direct-row[data-dim="release"] p span[dir="auto"]',
        "els => els.map(el => getComputedStyle(el).direction)"
    )
    print("anchor spans directions:", anchor_dirs)
    assert anchor_dirs == ["rtl", "rtl"], "expected both green and red anchor spans to resolve rtl"

    # NOTE: the join heading ("You're joining <Hebrew squad name>'s retro") is
    # a real mixed-content case worth documenting, not a bug: dir="auto"
    # resolves direction from the FIRST STRONG-DIRECTIONAL CHARACTER in the
    # element, which here is the English "Y" -- so the heading as a whole
    # stays ltr even though the embedded Hebrew squad name still displays
    # correctly (right-to-left) within it, per the Unicode bidi algorithm.
    # Asserting "rtl" here would be wrong; this print is a sanity check that
    # this expected behavior hasn't silently changed to something worse
    # (e.g. the Hebrew substring rendering reversed/mangled).
    print("join heading (expected ltr -- mixed English-first content):", direction(pageP, 'h2[dir="auto"]'))
    assert direction(pageP, 'h2[dir="auto"]') == "ltr"

    pageP.click('.direct-row[data-dim="release"] .swatch.crit')
    pageP.click('.direct-row[data-dim="process"] .swatch.good')
    pageP.click('.direct-row[data-dim="value"] .swatch.good')
    pageP.wait_for_timeout(100)
    pageP.click('#stmtSubmitBtn')
    pageP.wait_for_timeout(300)
    print("=== retro-join.js: personal result message (green/red text) ===")
    print("direction:", direction(pageP, '.personal-result p[dir="auto"]'))
    assert direction(pageP, '.personal-result p[dir="auto"]') == "rtl"
    print("participant errors:", errorsP)

    # pageP is a genuinely separate page with its own independent fake store
    # (no shared backend in this harness) -- mirror its response into the
    # facilitator's own store and fire __NOTIFY__, same as
    # test_retro_statement_survey_submission.py does, to simulate what a
    # real shared `db` would deliver automatically.
    stored_response = pageP.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.indexOf('sessions/""" + sid + """/responses/')===0; })[0];
        return window.__FAKE_STORE__[k];
      })();
    """)
    page.evaluate("""
      (function(){
        window.__FAKE_STORE__['sessions/""" + sid + """/responses/r1'] = """ + json.dumps(stored_response) + """;
        window.__NOTIFY__('sessions/""" + sid + """/responses');
      })();
    """)
    page.wait_for_timeout(150)

    # ---- back on the facilitator device: response table header ----
    page.click('.resp-details summary')
    page.wait_for_timeout(150)
    print("=== retro-facilitator.js: response table header ===")
    print("direction:", direction(page, '.resp-table thead th[dir="auto"]'))
    assert direction(page, '.resp-table thead th[dir="auto"]') == "rtl"
    print("facilitator errors:", errors)

    pageP.close()

    # ================= 9. CSV Hebrew round-trip (csv.js) =================
    # The scenario csv.js's own comments call out (lines 13, 164-166): a
    # dimension's label gets translated to Hebrew, then translated/edited
    # AGAIN later -- re-importing an OLDER export must still match by the
    # stable Dimension Key, not by the (now-stale) label text.
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    with page.expect_popup() as popup_info:
        page.click('#exportBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    csv_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    print("=== csv.js: exported CSV contains Hebrew squad/label + stable key ===")
    print(csv_text)
    assert HEB_SQUAD in csv_text, "Hebrew squad name missing/mangled in CSV export"
    assert HEB_LABEL in csv_text, "Hebrew dimension label missing/mangled in CSV export"
    assert ",release" in csv_text or "release" in csv_text.splitlines()[1], "Dimension Key column missing 'release'"

    old_csv_path = test_output_path("test_hebrew_old_export.csv")
    old_csv_path.write_text(csv_text)

    # relabel the dimension AGAIN, simulating a later re-translation
    page.click('#dimManageBtn')
    page.wait_for_timeout(150)
    label_input2 = page.query_selector('.dim-row[data-key="release"] input.dim-label')
    label_input2.fill(HEB_LABEL_V2)
    label_input2.dispatch_event("change")
    page.wait_for_timeout(150)
    page.click('#dimDoneBtn')

    # re-import the OLDER export, whose Dimension text still says HEB_LABEL
    # (now stale) -- it must still match via the Dimension Key column
    page.set_input_files('#csvFileInput', str(old_csv_path))
    page.wait_for_timeout(250)
    plan = page.evaluate("({ ratingCount: pendingImportPlan.ratingCount, skipped: pendingImportPlan.skipped })")
    print("=== csv.js: re-import after dimension re-translated (matched via Dimension Key) ===")
    print("plan:", plan)
    assert plan["ratingCount"] >= 1, "expected the Hebrew-labeled row to still match by Dimension Key"
    assert len(plan["skipped"]) == 0, "no row should be skipped -- Dimension Key should resolve despite stale label text"
    page.click('#importApplyBtn')
    page.wait_for_timeout(250)
    print("squad-1/release after Hebrew-key re-import:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions.release"))
    print("errors:", errors)

    page.screenshot(path=str(test_output_path("shot_hebrew_rtl_coverage.png")), full_page=True)
    browser.close()

    assert not errors, "unexpected JS errors: " + str(errors)
    print("=== ALL HEBREW/RTL CHECKS PASSED ===")
