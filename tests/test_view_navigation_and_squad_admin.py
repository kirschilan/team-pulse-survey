from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_views_admin.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # ============ default view is Tribe, aggregate-first ============
    print("=== default view ===")
    print("Tribe hidden:", page.eval_on_selector("#viewTribe", "el=>el.hidden"))
    print("Squad hidden:", page.eval_on_selector("#viewSquad", "el=>el.hidden"))
    print("Admin hidden:", page.eval_on_selector("#viewAdmin", "el=>el.hidden"))
    print("Squad breakdown <details> open by default (should be False/collapsed):", page.eval_on_selector("#squadBreakdown", "el=>el.open"))
    assert page.eval_on_selector("#viewTribe", "el=>el.hidden") == False
    assert page.eval_on_selector("#viewSquad", "el=>el.hidden") == True
    assert page.eval_on_selector("#viewAdmin", "el=>el.hidden") == True
    assert page.eval_on_selector("#squadBreakdown", "el=>el.open") in (False, None)
    print("errors:", errors)

    # Tribe grid should be READ-ONLY: no clickable cell-btn (they're divs now)
    tribe_cell_tag = page.eval_on_selector('#gridTable .cell-btn', 'el=>el.tagName')
    print("Tribe grid cell element tag (should be DIV, not BUTTON):", tribe_cell_tag)
    assert tribe_cell_tag == "DIV"
    squad_name_tag = page.eval_on_selector('#gridTable .squad-name', 'el=>el.tagName')
    print("Tribe grid squad-name element tag (should be SPAN, not INPUT):", squad_name_tag)
    assert squad_name_tag == "SPAN"
    print("Tribe grid has no del-btn:", page.query_selector('#gridTable .del-btn') is None)

    # ============ switch to Squad view, pick a squad, rate a dimension ============
    print("=== Squad view: rate a dimension ===")
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    print("Squad view visible now:", page.eval_on_selector("#viewSquad", "el=>el.hidden")==False)
    picker_buttons = page.eval_on_selector_all('.squad-pick-btn', 'els=>els.map(e=>e.textContent)')
    print("squad picker buttons:", picker_buttons)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    print("squad headings shown (session card + squad name):", page.eval_on_selector_all('#squadDetail h2', 'els=>els.map(e=>e.textContent)'))
    # rate the "release" dimension crit via the entry-list cell-btn (reuses the shared modal)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(120)
    page.click('.swatch.crit')
    page.click('#trendsel button[data-trend="down"]')
    page.click('#modalSave')
    page.wait_for_timeout(250)
    print("store squad-1 release after Squad-view rating:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions.release"))
    assert page.evaluate("window.__FAKE_STORE__['squads/squad-1'].dimensions.release.color") == "crit"

    # "Your hotspots" should now list this dimension for squad-1
    # (there's also a "Retro session" card in #squadDetail now, ahead of it --
    # check across all cards rather than assuming the first one)
    card_texts = page.eval_on_selector_all('#squadDetail .card', 'els=>els.map(e=>e.innerText)')
    hotspot_text = "\n".join(card_texts)
    print("Your hotspots panel mentions Easy to release:", "Easy to release" in hotspot_text)
    assert "Easy to release" in hotspot_text
    print("errors:", errors)

    # ============ Tribe view now reflects the rating, read-only ============
    print("=== Tribe view reflects the new rating (read-only) ===")
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(100)
    page.click('#squadBreakdown summary')
    page.wait_for_timeout(150)
    cell_class = page.eval_on_selector('#gridTable .cell-btn[aria-label*="Easy to release"]', 'el=>el.className')
    print("tribe grid cell class for squad-1/release (should include crit):", cell_class)
    assert "crit" in cell_class
    # clicking it should do nothing (no modal opens) since it's read-only
    page.click('#gridTable .cell-btn[aria-label*="Easy to release"]', force=True)
    page.wait_for_timeout(150)
    print("cell-rating modal opened by clicking read-only tribe cell (should be True/hidden):", page.eval_on_selector('#backdrop', 'el=>el.hidden'))
    assert page.eval_on_selector('#backdrop', 'el=>el.hidden') == True
    print("errors:", errors)

    # dimension header tooltip still works in Tribe's read-only grid
    label = page.query_selector('.dim-th-label[data-dim-key="release"]')
    label.hover()
    page.wait_for_timeout(120)
    print("tooltip hidden after hover on Tribe grid header (should be False):", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    page.mouse.move(5,5)
    page.wait_for_timeout(100)

    # ============ Admin view: dimensions/templates/CSV buttons + squad CRUD ============
    print("=== Admin view ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    print("Admin view visible:", page.eval_on_selector("#viewAdmin", "el=>el.hidden")==False)
    admin_rows = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows:", admin_rows)
    assert admin_rows == 2  # seeded squad-1/squad-2 from preview_v2's fake harness

    # rename squad-1 from Admin
    name_input = page.query_selector('#adminSquadList .admin-squad-name[data-id="squad-1"]')
    name_input.fill("Renamed From Admin")
    name_input.dispatch_event("change")
    page.wait_for_timeout(200)
    print("store squad-1 name after admin rename:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].name"))
    assert page.evaluate("window.__FAKE_STORE__['squads/squad-1'].name") == "Renamed From Admin"
    # squad picker in Squad view should reflect the rename too (renderAll rebroadcasts)
    picker_after_rename = page.eval_on_selector_all('.squad-pick-btn', 'els=>els.map(e=>e.textContent)')
    print("squad picker labels after admin rename:", picker_after_rename)
    assert "Renamed From Admin" in picker_after_rename

    # add a squad from Admin
    page.click('#addSquadBtn')
    page.wait_for_timeout(200)
    admin_rows_after_add = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows after add:", admin_rows_after_add)
    assert admin_rows_after_add == 3

    # delete a squad from Admin (goes through confirm modal)
    page.click('#adminSquadList .admin-squad-del[data-id="squad-2"]')
    page.wait_for_timeout(100)
    print("confirm modal visible for squad delete:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    page.click('#confirmOk')
    page.wait_for_timeout(200)
    admin_rows_after_delete = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows after delete:", admin_rows_after_delete)
    assert admin_rows_after_delete == 2
    print("errors:", errors)

    # dimension manager / templates / CSV import triggers still open their modals from Admin
    page.click('#dimManageBtn')
    page.wait_for_timeout(120)
    print("dim manager modal visible:", page.eval_on_selector('#dimBackdrop', 'el=>!el.hidden'))
    assert page.eval_on_selector('#dimBackdrop', 'el=>!el.hidden')
    page.click('#dimDoneBtn')

    page.click('#templatesBtn')
    page.wait_for_timeout(120)
    print("templates modal visible:", page.eval_on_selector('#templatesBackdrop', 'el=>!el.hidden'))
    assert page.eval_on_selector('#templatesBackdrop', 'el=>!el.hidden')
    page.click('#tplCloseBtn')

    with page.expect_popup() as popup_info:
        page.click('#exportBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    csv_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    header = csv_text.strip().splitlines()[0].split(",")
    print("CSV export header still correct from Admin view:", header)
    assert "Dimension Key" in header

    print("errors:", errors)
    page.screenshot(path=str(test_output_path("shot_views_admin.png")), full_page=True)

    # ============ view/squad selection persists across reload (localStorage) ============
    # NOTE: this fake harness's db is an in-memory JS object, so reloading the
    # page also wipes the fake STORE back to its seeded defaults -- that's a
    # limitation of the test double, not of the real db capability (which is
    # genuinely persistent). Only the localStorage-backed UI choice (which
    # view, which squad) is expected to survive here; do this check last.
    print("=== view/squad selection persists across reload (localStorage) ===")
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(120)
    page.reload()
    page.wait_for_timeout(400)
    print("Squad view hidden after reload (should be False -- remembered):", page.eval_on_selector("#viewSquad", "el=>el.hidden"))
    # #squadDetail now also contains the "Retro session" card's own h2, so
    # check across all of them rather than assuming the first is the squad name
    headings_after_reload = page.eval_on_selector_all('#squadDetail h2', 'els=>els.map(e=>e.textContent)')
    print("selected squad heading after reload:", headings_after_reload)
    assert page.eval_on_selector("#viewSquad", "el=>el.hidden") == False
    assert "Squad 1" in headings_after_reload
    print("errors:", errors)

    browser.close()
