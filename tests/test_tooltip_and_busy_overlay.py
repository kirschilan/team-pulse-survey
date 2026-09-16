from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_tooltip_busy.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))

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
    # -- click()/fill() auto-wait, so this chain needs no waits of its own.
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.click('.swatch.good'); page.click('#modalSave')

    # ============ Bug 1: hover/focus tooltip on grid headers (Tribe view) ============
    page.click('.view-btn[data-view="tribe"]')
    page.click('#squadBreakdown summary')
    # query_selector() below doesn't auto-wait -- wait for the label the
    # rest of this section hovers/queries to actually exist.
    page.wait_for_selector('.dim-th-label[data-dim-key="release"]', state="attached")
    print("=== tooltip test ===")
    print("tooltip hidden before hover:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    label = page.query_selector('.dim-th-label[data-dim-key="release"]')
    label.hover()
    # mouseenter's tooltip-show logic runs synchronously in the event
    # handler -- poll for it instead of guessing, tied to what's asserted
    # right below.
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === false")
    tip_hidden = page.eval_on_selector('#dimTooltip', 'el=>el.hidden')
    tip_html = page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML')
    print("tooltip hidden after hover:", tip_hidden)
    print("tooltip mentions green text:", "green release" in tip_html)
    print("tooltip mentions red text:", "red release" in tip_html)
    print("tooltip html:", tip_html)
    assert tip_hidden == False, "tooltip should be visible on hover"
    assert "green release" in tip_html and "red release" in tip_html
    page.mouse.move(5, 5)
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === true")
    print("tooltip hidden after mouse away:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))

    # keyboard focus path (accessibility)
    page.evaluate("document.querySelector('.dim-th-label[data-dim-key=\"process\"]').focus()")
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === false")
    print("tooltip hidden after keyboard focus:", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    page.evaluate("document.querySelector('.dim-th-label[data-dim-key=\"process\"]').blur()")
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === true")
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
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === false")
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    page.evaluate("""
      window.__FAKE_STORE__['dimensions/release'].green = 'green release (edited remotely)';
      window.__NOTIFY__('dimensions');
    """)
    # poll for the refreshed content itself -- the exact thing this
    # scenario exists to prove, and the same condition asserted next.
    page.wait_for_function("() => document.getElementById('dimTooltip').innerHTML.indexOf('green release (edited remotely)') !== -1")
    print("tooltip content refreshed after a re-render fires while still hovering:",
          page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML'))
    assert "green release (edited remotely)" in page.eval_on_selector('#dimTooltip', 'el=>el.innerHTML')
    page.mouse.move(5, 5)
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === true")
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
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === false")
    print("hovering release -- title:", page.eval_on_selector('#dimTooltip .tip-title', 'el=>el.textContent'))
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    process_label.hover()
    # the real thing this scenario exists to prove is the title actually
    # updating to the NEW header on a direct adjacent move -- poll for
    # that specific value rather than a generic "still visible" check.
    page.wait_for_function("() => { var t = document.querySelector('#dimTooltip .tip-title'); return t && t.textContent === 'Suitable process'; }")
    tip_title_after_adjacent_move = page.eval_on_selector('#dimTooltip .tip-title', 'el=>el.textContent')
    print("moved directly to process (no neutral gap) -- title:", tip_title_after_adjacent_move)
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    assert tip_title_after_adjacent_move == "Suitable process", "should show the NEW header's content, not stay stuck on the old one"
    page.mouse.move(5, 5)
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === true")
    tip_hidden_after_adjacent_leave = page.eval_on_selector('#dimTooltip', 'el=>el.hidden')
    print("tooltip hidden after finally leaving:", tip_hidden_after_adjacent_leave)
    assert tip_hidden_after_adjacent_leave == True
    print("errors:", errors)

    # ============ Bug 2: busy overlay during template switch ============
    print("=== busy overlay: template switch ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    page.fill('#tplNameInput', 'T-Busy')
    page.click('#tplSaveBtn')
    # synthesize a second template to switch to
    page.evaluate("""
      window.__FAKE_STORE__['templates/tpl-other'] = {
        name: 'T-Other-Busy', unit: 'Squad', unitPlural: 'Squads', attribution: '',
        dimensions: [{key:'other1', label:'Other dim', green:'g', red:'r', order:1}],
        createdAt: new Date().toISOString()
      };
      window.__NOTIFY__('templates');
    """)
    page.click('#tplCloseBtn')
    page.click('#templatesBtn')
    # eval_on_selector_all-style DOM search below doesn't auto-wait -- wait
    # for the injected template's own row, the real signal the manual
    # __NOTIFY__ above landed.
    page.wait_for_selector('#tplList .tpl-row:has-text("T-Other-Busy")', state="attached")
    page.evaluate("window.__busyHistory.length = 0;")
    busy_text_seen = page.evaluate("""
      (function(){
        Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Other-Busy')
          .querySelector('[data-action="load"]').click();
        return null;
      })();
    """)
    # #confirmOk is a click() (auto-waits for the confirm dialog to open) --
    # no wait needed before it.
    page.click('#confirmOk')
    # showBusy()/hideBusy() bracket a Promise chain that this fake store
    # resolves fast enough to complete within the SAME JS turn as the
    # click -- confirmed empirically (a wait_for_function polling for
    # hidden===false here times out 15/15, since Playwright's polling is
    # an EXTERNAL CDP call that only gets a turn once the page's own
    # microtask queue drains, by which point hideBusy() has often already
    # run too). This is exactly what the file's own opening comment warns
    # about: "polling at an arbitrary later point would otherwise likely
    # just see the already-hidden end state." __busyHistory (recorded by a
    # MutationObserver running on the PAGE's own timeline, not an external
    # poll) is the only reliable record of the transient show -- wait for
    # the cycle to fully settle, then read that recorded history rather
    # than trying to catch the shown moment live.
    page.wait_for_function("() => document.getElementById('busyOverlay').hidden === true")
    text_right_after_confirm = page.eval_on_selector('#busyText', 'el=>el.textContent')
    history = page.evaluate("window.__busyHistory")
    print("busy overlay hidden-attr history during template switch (expect [false, true] -- shown then hidden):", history)
    print("busy text shown during switch:", text_right_after_confirm)
    assert False in history and history[-1] == True, "expected the overlay to show, then hide, during the template switch"
    print("errors:", errors)

    # ---- busy overlay also covers JSON import when it has to create new squads ----
    print("=== busy overlay: JSON import creating a new squad ===")
    page.evaluate("window.__busyHistory.length = 0;")
    new_squad_json = {"formatVersion": 1, "squads": [{"name": "Brand New Squad", "dimensions": {}}]}
    new_squad_path = test_output_path("test_tooltip_busy_newsquad.json")
    new_squad_path.write_text(json.dumps(new_squad_json))
    page.set_input_files('#jsonFileInput', str(new_squad_path))
    # board-export-import.js reads the file via FileReader (genuinely async)
    # -- wait for the real modal-open signal before clicking Apply, rather
    # than guess how long the read takes.
    page.wait_for_selector('#importJsonBackdrop:not([hidden])')
    page.click('#importJsonApplyBtn')
    page.wait_for_function("() => document.getElementById('busyOverlay').hidden === true")
    history_import = page.evaluate("window.__busyHistory")
    print("busy overlay hidden-attr history during JSON import w/ new squad (expect shown then hidden):", history_import)
    assert False in history_import and history_import[-1] == True
    print("errors:", errors)

    # Bug 3 (CSV's "Dimension Key" column round-trip) removed along with CSV
    # itself -- Story 13 item 4. That column only ever existed to work
    # around CSV's flat-table format having no natural way to reference a
    # dimension by anything but its label; JSON's `dimensions[key]` shape
    # doesn't have that weakness, and the equivalent "renaming a dimension's
    # label doesn't break a JSON import matching by key" property is proven
    # directly in tests/unit/test_json_import.js instead.
    assert errors == []
    page.screenshot(path=str(test_output_path("shot_tooltip_busy.png")), full_page=True)
    browser.close()
