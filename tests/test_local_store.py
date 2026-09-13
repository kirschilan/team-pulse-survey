from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import write_plain_index

# Coverage for public/local-store.js -- the localStorage-backed replacement
# for the Claude-Artifact-only `db`/`downloads` capabilities that makes the
# app work standalone (e.g. on Vercel). Every other test in this suite runs
# through tests/fixtures/build_page.py, which splices in fake_store.html and
# so *always* has a real window.claude before local-store.js gets a chance to
# install itself -- meaning local-store.js itself had zero coverage. This
# file loads a plain copy of index.html (unmodified but for stripping the
# Google Fonts <link> -- see write_plain_index -- no fake store spliced in)
# so local-store.js is the thing actually driving the app, the same way it
# runs for a real visitor. All three loads below use this SAME file so
# localStorage persistence across reloads behaves exactly as it would
# navigating the real index.html repeatedly.

INDEX = write_plain_index(out_name="_test_local_store_index.html")
INDEX_URL = "file://" + str(INDEX.resolve())

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- first load: seeds a starter board ----
    # explicit context (rather than the browser.new_page() shortcut) so a
    # second page can be opened into the SAME context/localStorage later,
    # simulating two tabs of one browser.
    ctx = browser.new_context(viewport={"width":1280,"height":1000})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(INDEX_URL)
    # #syncText starts as the static "Connecting..." placeholder until
    # db.js's setSyncStatus() resolves it one way or the other -- wait for
    # that real transition instead of a guessed delay
    page.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")

    print("=== first load: local-store.js resolves the db capability and seeds a board ===")
    sync_text = page.eval_on_selector("#syncText", "el=>el.textContent")
    print("sync text:", sync_text)
    assert "Live" in sync_text

    squad_count = page.eval_on_selector_all(".squad-pick-btn", "els=>els.length")
    print("seeded squads:", squad_count)
    assert squad_count == 3

    ls_raw = page.evaluate("localStorage.getItem('squadpulse:db:v1')")
    print("localStorage populated:", bool(ls_raw))
    assert ls_raw

    # ---- rate a cell, then reload: the rating must survive via localStorage ----
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(150)
    page.click('.swatch.crit')
    page.click('#modalSave')
    page.wait_for_timeout(300)

    print("=== reload: rating persists ===")
    page.reload()
    # .squad-pick-btn is rendered from state.squads, not static HTML -- its
    # existence is the real signal that post-reload boot (db.js's squads
    # listener) has fired at least once, not a guessed delay
    page.wait_for_selector('.squad-pick-btn[data-id="squad-1"]', state="attached")
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    cell_class = page.eval_on_selector('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]', 'el=>el.className')
    print("release cell class after reload (should include crit):", cell_class)
    assert "crit" in cell_class
    print("errors:", errors)

    # ---- a second tab of the SAME browser context shares localStorage, and
    # picks up a live write from tab 1 via the native `storage` event ----
    print("=== second tab: sees the same board immediately, and live-updates on write ===")
    page2 = ctx.new_page()
    errors2 = []
    page2.on("pageerror", lambda e: errors2.append(str(e)))
    page2.goto(INDEX_URL)
    page2.wait_for_selector('.squad-pick-btn[data-id="squad-1"]', state="attached")
    page2.click('.view-btn[data-view="squad"]')
    page2.wait_for_timeout(100)
    page2.click('.squad-pick-btn[data-id="squad-1"]')
    page2.wait_for_timeout(150)
    cell_class2 = page2.eval_on_selector('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]', 'el=>el.className')
    print("tab 2 sees tab 1's rating on load:", cell_class2)
    assert "crit" in cell_class2

    page2.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page2.wait_for_timeout(150)
    page2.click('.swatch.good')
    page2.click('#modalSave')
    page2.wait_for_timeout(300)
    page.wait_for_timeout(300)
    cell_class_live = page.eval_on_selector('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]', 'el=>el.className')
    print("tab 1 live-updates after tab 2's write (storage event):", cell_class_live)
    assert "good" in cell_class_live
    print("errors2:", errors2)

    # ---- CSV export triggers a real browser download, not the old fallback tab ----
    print("=== CSV export downloads a real file ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    with page.expect_download() as dl_info:
        page.click("#exportBtn")
    download = dl_info.value
    print("download filename:", download.suggested_filename)
    assert download.suggested_filename == "squad-pulse-snapshot.csv"

    # ---- a real window.claude (Claude Artifact-shaped) must be left alone ----
    print("=== local-store.js does not override a real window.claude ===")
    page3 = browser.new_page()
    page3.add_init_script("window.claude = { use: function(name){ return Promise.resolve(null); } };")
    errors3 = []
    page3.on("pageerror", lambda e: errors3.append(str(e)))
    page3.goto(INDEX_URL)
    page3.wait_for_function("() => !document.getElementById('syncText').textContent.includes('Connecting')")
    claude_use_src = page3.evaluate("window.claude.use.toString()")
    print("window.claude.use still the injected stub:", "Promise.resolve(null)" in claude_use_src)
    assert "Promise.resolve(null)" in claude_use_src
    sync_text3 = page3.eval_on_selector("#syncText", "el=>el.textContent")
    print("sync text with null db capability (should be local-only preview):", sync_text3)
    assert "Preview only" in sync_text3
    print("errors3:", errors3)

    print("=== ALL ERRORS:", errors, errors2, errors3)
    browser.close()
