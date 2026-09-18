from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_tpl_switch.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # No initial boot wait needed -- every action below is either click()/
    # fill() (Playwright auto-waits for the target to become actionable) or
    # gated by an explicit wait_for_*() right before the one non-auto-waiting
    # read that needs it (query_selector/eval_on_selector/evaluate don't wait).

    # ---- rate squad-1/release (from Squad view -- rating no longer happens on the grid) ----
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.click('.swatch.crit')
    page.click('#modalSave')
    # evaluate() doesn't auto-wait -- poll for the actual write landing
    # instead of guessing how long modalSave's commit takes.
    page.wait_for_function("() => window.__FAKE_STORE__['squads/squad-1'] && window.__FAKE_STORE__['squads/squad-1'].dimensions.release && window.__FAKE_STORE__['squads/squad-1'].dimensions.release.color === 'crit'")
    print("=== after initial rating ===")
    print("squad-1:", page.evaluate("window.__FAKE_STORE__['squads/squad-1']"))
    print("errors:", errors)

    # ---- save current (3 dims incl 'release') as template T-Original (Admin view) ----
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    page.fill('#tplNameInput', 'T-Original')
    page.click('#tplSaveBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).some(k => k.startsWith('templates/'))")
    tpl_store_keys = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('templates/'))")
    print("template keys:", tpl_store_keys)
    orig_tpl = page.evaluate("window.__FAKE_STORE__[Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('templates/'))[0]]")
    print("T-Original dims carry keys:", [d.get('key') for d in orig_tpl['dimensions']])

    # ---- load a DIFFERENT synthetic template (simulating switching away) ----
    page.evaluate("""
      window.__FAKE_STORE__['templates/tpl-other'] = {
        name: 'T-Other', unit: 'Squad', unitPlural: 'Squads', attribution: '',
        dimensions: [{label:'Totally different', green:'g', red:'r', order:1}],
        createdAt: new Date().toISOString()
      };
      window.__NOTIFY__('templates');
    """)
    page.click('#tplCloseBtn')
    page.click('#templatesBtn')
    # eval_on_selector_all doesn't auto-wait -- wait for the injected
    # template's own row specifically, the real signal the manual
    # __NOTIFY__ above actually landed and re-rendered the list.
    page.wait_for_selector('#tplList .tpl-row:has-text("T-Other")', state="attached")
    rows = page.eval_on_selector_all('#tplList .tpl-row .tname', 'els=>els.map(e=>e.textContent)')
    print("template rows visible:", rows)
    # click Load on the row whose name is T-Other
    page.evaluate("""
      Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Other')
        .querySelector('[data-action="load"]').click();
    """)
    page.click('#confirmOk')
    # T-Other's own (and only) dimension header landing in the grid is the
    # real signal the switch (store write + re-render) fully completed.
    page.wait_for_selector('table.grid thead th:has-text("Totally different")', state="attached")
    print("=== after switching to T-Other ===")
    dim_keys_now = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/'))")
    print("live dimension keys:", dim_keys_now)
    print("squad-1 dimensions data still intact underneath:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions"))
    grid_cols = page.eval_on_selector_all('table.grid thead th', 'els=>els.length')
    print("grid columns now:", grid_cols)

    # ---- switch BACK to T-Original -- release rating should reappear ----
    page.click('#templatesBtn')
    page.wait_for_selector('#tplList .tpl-row:has-text("T-Original")', state="attached")
    page.evaluate("""
      Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Original')
        .querySelector('[data-action="load"]').click();
    """)
    page.click('#confirmOk')
    # release's own cell reappearing in the grid is the real signal the
    # switch back fully completed (store write + re-render), not a guess.
    page.wait_for_selector('.cell-btn[data-squad="squad-1"][data-dim="release"]', state="attached")
    print("=== after switching BACK to T-Original ===")
    dim_keys_final = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/'))")
    print("live dimension keys:", sorted(dim_keys_final))
    cell_class = page.eval_on_selector('.cell-btn[data-squad="squad-1"][data-dim="release"]', 'el=>el ? el.className : null')
    print("squad-1/release cell class (should show crit):", cell_class)
    print("errors:", errors)

    # (loadTemplate() already closed the Templates modal on success)

    # Hebrew/RTL coverage (dir="auto" resolving to real rtl for actual Hebrew
    # content, not just the attribute's presence) moved to its own dedicated
    # file, test_hebrew_rtl_coverage.py, which checks it across every
    # dir="auto" surface in the app, not just these 3.

    # CSV import coverage (this file's original second half) removed along
    # with the feature itself -- Story 13 item 4. JSON import's own
    # coverage lives in tests/test_json_import.py.
    assert errors == []
    print("errors:", errors)

    page.screenshot(path=str(test_output_path("shot_template_switching.png")), full_page=True)
    browser.close()
