from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_v2.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # ---- rate squad-1/release (from Squad view -- rating no longer happens on the grid) ----
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(120)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(120)
    page.click('.swatch.crit')
    page.click('#modalSave')
    page.wait_for_timeout(250)
    print("=== after initial rating ===")
    print("squad-1:", page.evaluate("window.__FAKE_STORE__['squads/squad-1']"))
    print("errors:", errors)

    # ---- save current (3 dims incl 'release') as template T-Original (Admin view) ----
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn'); page.wait_for_timeout(150)
    page.fill('#tplNameInput', 'T-Original')
    page.click('#tplSaveBtn')
    page.wait_for_timeout(200)
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
    page.wait_for_timeout(150)
    page.click('#tplCloseBtn')
    page.click('#templatesBtn'); page.wait_for_timeout(300)
    rows = page.eval_on_selector_all('#tplList .tpl-row .tname', 'els=>els.map(e=>e.textContent)')
    print("template rows visible:", rows)
    # click Load on the row whose name is T-Other
    page.evaluate("""
      Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Other')
        .querySelector('[data-action="load"]').click();
    """)
    page.wait_for_timeout(150)
    page.click('#confirmOk')
    page.wait_for_timeout(400)
    print("=== after switching to T-Other ===")
    dim_keys_now = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/'))")
    print("live dimension keys:", dim_keys_now)
    print("squad-1 dimensions data still intact underneath:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions"))
    grid_cols = page.eval_on_selector_all('table.grid thead th', 'els=>els.length')
    print("grid columns now:", grid_cols)

    # ---- switch BACK to T-Original -- release rating should reappear ----
    page.click('#templatesBtn'); page.wait_for_timeout(200)
    page.evaluate("""
      Array.from(document.querySelectorAll('#tplList .tpl-row')).find(r => r.querySelector('.tname').textContent === 'T-Original')
        .querySelector('[data-action="load"]').click();
    """)
    page.wait_for_timeout(150)
    page.click('#confirmOk')
    page.wait_for_timeout(400)
    print("=== after switching BACK to T-Original ===")
    dim_keys_final = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/'))")
    print("live dimension keys:", sorted(dim_keys_final))
    cell_class = page.eval_on_selector('.cell-btn[data-squad="squad-1"][data-dim="release"]', 'el=>el ? el.className : null')
    print("squad-1/release cell class (should show crit):", cell_class)
    print("errors:", errors)

    # (loadTemplate() already closed the Templates modal on success)

    # ---- Hebrew: dir=auto sanity check ----
    print("=== dir=auto checks ===")
    print("squad-name dir:", page.eval_on_selector('.squad-name', 'el=>el.getAttribute("dir")'))
    page.click('#dimManageBtn'); page.wait_for_timeout(150)
    print("dim-label dir:", page.eval_on_selector('.dim-label', 'el=>el.getAttribute("dir")'))
    print("dim green textarea dir:", page.eval_on_selector('#dimList textarea[data-field="green"]', 'el=>el.getAttribute("dir")'))
    page.click('#dimDoneBtn')

    # ---- CSV import test ----
    print("=== CSV import ===")
    csv_text = (
        "Squad,Dimension,Health,Trend,Note\r\n"
        "Squad 1,Easy to release,Green,Improving,imported note\r\n"
        "Squad 3,Suitable process,Yellow,Steady,new squad row\r\n"
        "Squad 2,Nonexistent Dim,Red,,should be skipped\r\n"
    )
    csv_path = test_output_path("test_import.csv")
    csv_path.write_text(csv_text)
    page.set_input_files('#csvFileInput', str(csv_path))
    page.wait_for_timeout(250)
    print("import modal visible:", page.eval_on_selector('#importBackdrop', 'el=>!el.hidden'))
    print("import summary html:", page.eval_on_selector('#importSummary', 'el=>el.innerText'))
    page.click('#importApplyBtn')
    page.wait_for_timeout(300)
    print("squad-1 after import:", page.evaluate("window.__FAKE_STORE__['squads/squad-1']"))
    all_squad_names = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('squads/')).map(k=>window.__FAKE_STORE__[k].name)")
    print("all squad names after import (should include 'Squad 3'):", all_squad_names)
    print("errors:", errors)

    page.screenshot(path=str(test_output_path("shot_v2_import.png")), full_page=True)
    browser.close()
