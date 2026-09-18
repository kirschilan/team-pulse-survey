from playwright.sync_api import sync_playwright
import pathlib, json
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
    # eval_on_selector() below doesn't auto-wait -- renderAdminSquadList()
    # only populates this once the async store load + first render() pass
    # lands, so this is the real boot-complete marker (same one
    # test_hebrew_rtl_coverage.py uses), not a guessed sleep. state=
    # "attached" since Admin isn't necessarily the default active view.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

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
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "squad picker rendered" signal instead of guessing.
    page.wait_for_selector('.squad-pick-btn', state="attached")
    print("Squad view visible now:", page.eval_on_selector("#viewSquad", "el=>el.hidden")==False)
    picker_buttons = page.eval_on_selector_all('.squad-pick-btn', 'els=>els.map(e=>e.textContent)')
    print("squad picker buttons:", picker_buttons)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "squad-1's own detail rendered" signal instead of guessing.
    page.wait_for_selector('#startSessionBtn', state="attached")
    print("squad headings shown (session card + squad name):", page.eval_on_selector_all('#squadDetail h2', 'els=>els.map(e=>e.textContent)'))
    # rate the "release" dimension crit via the entry-list cell-btn (reuses
    # the shared modal) -- every step here is click(), which auto-waits, so
    # no wait is needed between them.
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.click('.swatch.crit')
    page.click('#trendsel button[data-trend="down"]')
    page.click('#modalSave')
    # evaluate() below doesn't auto-wait -- poll for the real write landing
    # instead of guessing.
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.dimensions && s.dimensions.release && s.dimensions.release.color === 'crit'; }")
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
    page.click('#squadBreakdown summary')
    # eval_on_selector() below doesn't auto-wait, and expanding a native
    # <details> is a synchronous browser toggle -- #gridTable's rows were
    # already rendered into the collapsed-but-attached markup, not built
    # lazily on open.
    page.wait_for_selector('#gridTable .cell-btn[aria-label*="Easy to release"]', state="attached")
    cell_class = page.eval_on_selector('#gridTable .cell-btn[aria-label*="Easy to release"]', 'el=>el.className')
    print("tribe grid cell class for squad-1/release (should include crit):", cell_class)
    assert "crit" in cell_class
    # clicking it should do nothing (no modal opens) since it's read-only --
    # confirmed structurally, not just by timing: Tribe's grid renders these
    # cells as plain <div>s (render.js) with no click listener bound
    # anywhere (squads.js only binds .cell-btn's rating-modal click inside
    # Squad view's own container). There's nothing that could ever open the
    # modal here, delayed or not, so no wait is needed before checking it
    # stayed closed.
    page.click('#gridTable .cell-btn[aria-label*="Easy to release"]', force=True)
    print("cell-rating modal opened by clicking read-only tribe cell (should be True/hidden):", page.eval_on_selector('#backdrop', 'el=>el.hidden'))
    assert page.eval_on_selector('#backdrop', 'el=>el.hidden') == True
    print("errors:", errors)

    # dimension header tooltip still works in Tribe's read-only grid.
    # eval_on_selector() below doesn't auto-wait -- poll for the real
    # "tooltip shown" condition (showDimTooltip() is bound via a delegated
    # mouseover listener) instead of guessing.
    label = page.query_selector('.dim-th-label[data-dim-key="release"]')
    label.hover()
    page.wait_for_function("() => document.getElementById('dimTooltip').hidden === false")
    print("tooltip hidden after hover on Tribe grid header (should be False):", page.eval_on_selector('#dimTooltip', 'el=>el.hidden'))
    assert page.eval_on_selector('#dimTooltip', 'el=>el.hidden') == False
    # No wait needed after this -- nothing reads the tooltip's state again,
    # this just moves the mouse away before switching views below.
    page.mouse.move(5,5)

    # ============ Admin view: dimensions/templates/JSON export buttons + squad CRUD ============
    print("=== Admin view ===")
    page.click('.view-btn[data-view="admin"]')
    # eval_on_selector_all() below doesn't auto-wait -- wait for the real
    # "admin squad list rendered" signal instead of guessing.
    page.wait_for_selector('#adminSquadList .tpl-row', state="attached")
    print("Admin view visible:", page.eval_on_selector("#viewAdmin", "el=>el.hidden")==False)
    admin_rows = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows:", admin_rows)
    assert admin_rows == 2  # seeded squad-1/squad-2 from preview_v2's fake harness

    # rename squad-1 from Admin
    name_input = page.query_selector('#adminSquadList .admin-squad-name[data-id="squad-1"]')
    name_input.fill("Renamed From Admin")
    # evaluate() below doesn't auto-wait -- renameSquad() (squads.js) calls
    # renderAll() and writes to the store SYNCHRONOUSLY inside the 'change'
    # handler, but poll for the real condition rather than assume that
    # timing.
    name_input.dispatch_event("change")
    page.wait_for_function("() => { var s = window.__FAKE_STORE__['squads/squad-1']; return s && s.name === 'Renamed From Admin'; }")
    print("store squad-1 name after admin rename:", page.evaluate("window.__FAKE_STORE__['squads/squad-1'].name"))
    assert page.evaluate("window.__FAKE_STORE__['squads/squad-1'].name") == "Renamed From Admin"
    # squad picker in Squad view should reflect the rename too (renderAll rebroadcasts)
    picker_after_rename = page.eval_on_selector_all('.squad-pick-btn', 'els=>els.map(e=>e.textContent)')
    print("squad picker labels after admin rename:", picker_after_rename)
    assert "Renamed From Admin" in picker_after_rename

    # add a squad from Admin. evaluate()/eval_on_selector_all() below don't
    # auto-wait -- poll for the 3rd squad actually landing in the store
    # instead of guessing (addSquad()'s own comment explains why the DOM
    # update comes from the squads listener firing, not a direct call here
    # -- but the fake store's notify() invokes it synchronously either way).
    page.click('#addSquadBtn')
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('squads/')).length === 3")
    admin_rows_after_add = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows after add:", admin_rows_after_add)
    assert admin_rows_after_add == 3

    # delete a squad from Admin (goes through confirm modal)
    page.click('#adminSquadList .admin-squad-del[data-id="squad-2"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")  # real modal-open signal, not a guess
    print("confirm modal visible for squad delete:", page.eval_on_selector('#confirmBackdrop', 'el=>!el.hidden'))
    page.click('#confirmOk')
    # evaluate()/eval_on_selector_all() below don't auto-wait -- poll for
    # the real write landing (removeSquad() calls renderAll() synchronously)
    # instead of guessing.
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('squads/')).length === 2")
    admin_rows_after_delete = page.eval_on_selector_all('#adminSquadList .tpl-row', 'els=>els.length')
    print("admin squad rows after delete:", admin_rows_after_delete)
    assert admin_rows_after_delete == 2
    print("errors:", errors)

    # dimension manager / templates / JSON export triggers still open their modals from Admin
    page.click('#dimManageBtn')
    page.wait_for_selector('#dimBackdrop', state="visible")  # real modal-open signal, not a guess
    print("dim manager modal visible:", page.eval_on_selector('#dimBackdrop', 'el=>!el.hidden'))
    assert page.eval_on_selector('#dimBackdrop', 'el=>!el.hidden')
    page.click('#dimDoneBtn')

    page.click('#templatesBtn')
    page.wait_for_selector('#templatesBackdrop', state="visible")  # real modal-open signal, not a guess
    print("templates modal visible:", page.eval_on_selector('#templatesBackdrop', 'el=>!el.hidden'))
    assert page.eval_on_selector('#templatesBackdrop', 'el=>!el.hidden')
    page.click('#tplCloseBtn')

    with page.expect_popup() as popup_info:
        page.click('#exportJsonBtn')
    popup = popup_info.value
    popup.wait_for_load_state()
    json_text = popup.eval_on_selector('pre', 'el => el.textContent')
    popup.close()
    exported = json.loads(json_text)
    print("JSON export still correct from Admin view, formatVersion:", exported.get("formatVersion"))
    assert exported.get("formatVersion") == 1

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
    # selectSquad() (squads.js) writes to localStorage SYNCHRONOUSLY -- a
    # blocking browser API, not an async one -- so by the time this click()
    # returns, the persisted value reload() below reads back is already
    # written. No wait is needed before reloading.
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.reload()
    # eval_on_selector()/eval_on_selector_all() below don't auto-wait --
    # wait for the same real boot-complete marker used at the top of this
    # file, then the specific "squad-1's own detail rendered" signal.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")
    page.wait_for_selector('#startSessionBtn', state="attached")
    print("Squad view hidden after reload (should be False -- remembered):", page.eval_on_selector("#viewSquad", "el=>el.hidden"))
    # #squadDetail now also contains the "Retro session" card's own h2, so
    # check across all of them rather than assuming the first is the squad name
    headings_after_reload = page.eval_on_selector_all('#squadDetail h2', 'els=>els.map(e=>e.textContent)')
    print("selected squad heading after reload:", headings_after_reload)
    assert page.eval_on_selector("#viewSquad", "el=>el.hidden") == False
    assert "Squad 1" in headings_after_reload
    print("errors:", errors)

    browser.close()
