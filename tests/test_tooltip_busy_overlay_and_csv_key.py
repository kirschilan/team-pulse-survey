from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_tooltip_busy_csvkey.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # Instrument #busyOverlay's `hidden` attribute with a MutationObserver so we
    # can detect a show-then-hide sequence even though the fake store resolves
    # promises almost instantly (unlike the real several-seconds-long platform
    # latency the bug report describes) -- polling at an arbitrary later point
    # would otherwise likely just see the already-hidden end state.
    page.evaluate("""
      window.__busyHistory = [];
      new MutationObserver(function(){
        window.__busyHistory.push(document.getElementById('busyOverlay').hidden);
      }).observe(document.getElementById('busyOverlay'), {attributes:true, attributeFilter:['hidden']});
    """)

    # rate a couple cells so export/import have content to work with (Squad view)
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(120)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(100)
    page.click('.swatch.good'); page.click('#modalSave'); page.wait_for_timeout(150)

    # ============ Bug 1: hover/focus tooltip on grid headers (Tribe view) ============
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(100)
    page.click('#squadBreakdown summary')
    page.wait_for_timeout(150)
    print("=== tooltip test ===")
    print("tooltip hidden before hover:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    label = page.query_selector('.dim-th-label[data-dim-key="release"]')
    label.hover()
    page.wait_for_timeout(100)
    tip_hidden = page.eval_on_selector('#dimTooltip', 'el=>el.hidden')
    tip_html = page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML')
    print("tooltip hidden after hover:", tip_hidden)
    print("tooltip mentions green text:", "green release" in tip_html)
    print("tooltip mentions red text:", "red release" in tip_html)
    print("tooltip html:", tip_html)
    assert tip_hidden == False, "tooltip should be visible on hover"
    assert "green release" in tip_html and "red release" in tip_html
    page.mouse.move(5, 5)
    page.wait_for_timeout(100)
    print("tooltip hidden after mouse away:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))

    # keyboard focus path (accessibility)
    page.evaluate("document.querySelector('.dim-th-label[data-dim-key=\"process\"]').focus()")
    page.wait_for_timeout(100)
    print("tooltip hidden after keyboard focus:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    page.evaluate("document.querySelector('.dim-th-label[data-dim-key=\"process\"]').blur()")
    page.wait_for_timeout(100)
    print("tooltip hidden after blur:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    print("errors:", errors)

    # ---- real bug, reported from usage: the tooltip could get stuck open
    # (with no live listener able to hide it) if a renderGrid() rebuild
    # happened while the mouse was hovering a header -- renderGrid()
    # replaces the whole <thead> via one innerHTML write, and an earlier
    # version bound mouseenter/mouseleave freshly per-node on every render,
    # so a rebuild mid-hover could destroy the very listener that would
    # hide it. Fixed by delegating to the STABLE .table-scroll wrapper
    # (never itself replaced) instead of re-binding per .dim-th-label node
    # on every render, plus an unconditional hideDimTooltip() at the top of
    # renderGrid() as defense in depth. Covered here across a re-render
    # that happens while genuinely still hovering (a live "remote"
    # dimension edit via window.__NOTIFY__, exactly the kind of re-render
    # this collaborative board does constantly): the tooltip may legitimately
    # stay open with refreshed content while the pointer never actually
    # moved, but once the pointer genuinely leaves afterward it must hide --
    # not orphaned by whatever rebuild happened while it was still open.
    print("=== tooltip survives a re-render that happens mid-hover, and still hides on a genuine leave afterward ===")
    label.hover()
    page.wait_for_timeout(100)
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    page.evaluate("""
      window.__FAKE_STORE__['dimensions/release'].green = 'green release (edited remotely)';
      window.__NOTIFY__('dimensions');
    """)
    page.wait_for_timeout(150)
    print("tooltip content refreshed after a re-render fires while still hovering:",
          page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML'))
    assert "green release (edited remotely)" in page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML')
    page.mouse.move(5, 5)
    page.wait_for_timeout(150)
    tip_hidden_after_leaving = page.eval_on_selector('#dimTooltip', 'el=>el.hidden')
    print("tooltip hidden after genuinely leaving, post-re-render (should be True, not stuck open):", tip_hidden_after_leaving)
    assert tip_hidden_after_leaving == True
    print("errors:", errors)

    # ---- gap closed here: moving the pointer DIRECTLY from one header to an
    # ADJACENT one -- no neutral "away" position in between -- is the most
    # common real scanning-across-columns usage pattern, and it's the one
    # path that specifically exercises the delegated mouseout handler's
    # relatedTarget/.contains() check added by the delegation fix above (see
    # render.js's bindGridHeaderTooltips replacement). That check had zero
    # coverage even after the fix landed: every existing scenario either
    # moved the mouse all the way to a neutral corner or used keyboard focus,
    # neither of which ever calls mouseout with another .dim-th-label as
    # relatedTarget.
    print("=== tooltip updates correctly when the pointer moves directly from one header to an adjacent one ===")
    # re-query -- the previous scenario's live dimension edit re-rendered the
    # header, detaching the earlier `label` handle from the DOM
    release_label = page.query_selector('.dim-th-label[data-dim-key="release"]')
    process_label = page.query_selector('.dim-th-label[data-dim-key="process"]')
    release_label.hover()
    page.wait_for_timeout(100)
    print("hovering release -- title:", page.eval_on_selector('#dimTooltip .tip-title', 'el=>el.textContent'))
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    process_label.hover()
    page.wait_for_timeout(100)
    tip_title_after_adjacent_move = page.eval_on_selector('#dimTooltip .tip-title', 'el=>el.textContent')
    print("moved directly to process (no neutral gap) -- title:", tip_title_after_adjacent_move)
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    assert tip_title_after_adjacent_move == "Suitable process", "should show the NEW header's content, not stay stuck on the old one"
    page.mouse.move(5, 5)
    page.wait_for_timeout(100)
    tip_hidden_after_adjacent_leave = page.eval_on_selector('#dimTooltip', 'el=>el.hidden')
    print("tooltip hidden after finally leaving:", tip_hidden_after_adjacent_leave)
    assert tip_hidden_after_adjacent_leave == True
    print("errors:", errors)

    # ============ Bug 2: busy overlay during template switch ============
    print("=== busy overlay: template switch ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn'); page.wait_for_timeout(150)
    page.fill('#tplNameInput', 'T-Busy')
    page.click('#tplSaveBtn')
    page.wait_for_timeout(200)
    # synthesize a second template to switch to
    page.evaluate("""
      window.__FAKE_STORE__['templates/tpl-other'] = {
        name: 'T-Other-Busy', unit: 'Squad', unitPlural: 'Squads', attribution: '',
        dimensions: [{key:'other1', label:'Other dim', green:'g', red:'r', order:1}],
        createdAt: new Date().toISOString()
      };
      window.__NOTIFY__('templates');
    """)
    page.wait_for_timeout(150)
    page.click('#tplCloseBtn')
    page.click('#templatesBtn'); page.wait_for_timeout(300)
    page.evaluate("window.__busyHistory.length = 0;")
    busy_text_seen = page.evaluate("""
      (function(){
        Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Other-Busy')
          .querySelector('[data-action="load"]').click();
        return null;
      })();
    """)
    page.wait_for_timeout(80)
    # grab the busy text the instant the overlay first becomes visible, before clicking confirm
    page.click('#confirmOk')
    page.wait_for_timeout(30)
    text_right_after_confirm = page.eval_on_selector('#busyText', 'el=>el.textContent')
    page.wait_for_timeout(500)
    history = page.evaluate("window.__busyHistory")
    print("busy overlay hidden-attr history during template switch (expect [false, true] -- shown then hidden):", history)
    print("busy text shown during switch:", text_right_after_confirm)
    assert False in history and history[-1] == True, "expected the overlay to show, then hide, during the template switch"
    print("errors:", errors)

    # ---- busy overlay also covers CSV import when it has to create new squads ----
    print("=== busy overlay: CSV import creating a new squad ===")
    page.evaluate("window.__busyHistory.length = 0;")
    csv_new_squad = "Squad,Dimension,Health,Trend,Note\r\nBrand New Squad,Other dim,Green,,\r\n"
    new_squad_path = test_output_path("test_tooltip_busy_csvkey_newsquad.csv")
    new_squad_path.write_text(csv_new_squad)
    page.set_input_files('#csvFileInput', str(new_squad_path))
    page.wait_for_timeout(200)
    page.click('#importApplyBtn')
    page.wait_for_timeout(400)
    history_import = page.evaluate("window.__busyHistory")
    print("busy overlay hidden-attr history during CSV import w/ new squad (expect shown then hidden):", history_import)
    assert False in history_import and history_import[-1] == True
    print("errors:", errors)

    # ============ Bug 3: CSV Dimension Key column round-trip ============
    print("=== CSV Dimension Key export/import ===")
    with page.expect_popup() as popup_info:
        page.click('#exportBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    csv_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    header = csv_text.strip().splitlines()[0].split(",")
    print("export header:", header)
    assert "Dimension Key" in header, "Dimension Key column missing from export!"
    key_col = header.index("Dimension Key")
    lines = csv_text.strip().splitlines()

    # rename the "Other dim" dimension's label (simulating a post-export
    # translation/rename) then re-import the ORIGINAL export -- it should
    # still match via the Dimension Key column instead of failing on label text
    page.evaluate("""
      window.__FAKE_STORE__['dimensions/other1'].label = 'Renamed / Translated Label';
      window.__NOTIFY__('dimensions');
    """)
    page.wait_for_timeout(150)
    print("dimension label now:", page.evaluate("window.__FAKE_STORE__['dimensions/other1'].label"))

    reimport_path = test_output_path("test_tooltip_busy_csvkey_reimport.csv")
    reimport_path.write_text(csv_text)
    page.set_input_files('#csvFileInput', str(reimport_path))
    page.wait_for_timeout(250)
    summary_html = page.eval_on_selector('#importSummary', 'el=>el.innerText')
    print("import summary after label rename (should show ratings matched, not skipped):", summary_html)
    page.click('#importCancel')

    # legacy file WITHOUT the Dimension Key column should still fall back to
    # label matching against the CURRENT (renamed) label
    legacy_rows = ["Squad,Dimension,Health,Trend,Note,Template"]
    for line in lines[1:]:
        parts = line.split(",")
        if parts[1] == "Other dim":
            parts[1] = "Renamed / Translated Label"  # legacy file must use the label as it exists NOW to match
        legacy_rows.append(",".join(parts[0:6]))
    legacy_csv = "\r\n".join(legacy_rows)
    legacy_path = test_output_path("test_tooltip_busy_csvkey_legacy.csv")
    legacy_path.write_text(legacy_csv)
    page.set_input_files('#csvFileInput', str(legacy_path))
    page.wait_for_timeout(250)
    print("import summary for legacy (no-key) file matched by current label:", page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importCancel')

    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_tooltip_busy_csvkey.png")), full_page=True)
    browser.close()
