from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Tribe view's cross-squad rollup is the headline feature described in
# README.md ("where the same dimension keeps coming up red or yellow in more
# than one squad") but had no regression coverage before this file: nothing
# exercised renderStats()'s single "top hotspot" stat or renderHotspots()'s
# ranked hotspot list (app.js, weightScore = crit*2 + warn per dimension,
# top 6 shown). Added ahead of the planned app.js refactor so that
# aggregation logic has a safety net independent of file layout.

out_path = build_page(out_name="_test_tribe_hotspots.html")


def strip_bidi(s):
    # t()'s {word} substitutions are wrapped in U+2066/U+2069 bidi isolate
    # marks (see i18n.js's Story 4 entry in STATUS.md) so an untranslated
    # word can't scramble a future RTL sentence's word order -- invisible
    # and harmless in English too, but present in .textContent, so substring
    # checks here strip them rather than matching against plain ASCII.
    return s.replace("⁦", "").replace("⁩", "")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    print("=== nothing scored yet: no dimension is red across squads ===")
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    print("statHotspot before any ratings:", page.eval_on_selector('#statHotspot', 'el=>el.textContent'))
    assert page.eval_on_selector('#statHotspot', 'el=>el.textContent') == "None yet"
    # rows still render one per dimension (unscored counts), just with 0 red --
    # the "score a few squads" hint is only for the true zero-dimensions case
    row_texts_empty = page.eval_on_selector_all('#hotspotList .hotspot-row', 'els=>els.map(e=>e.textContent)')
    print("hotspot rows before any ratings (all 0 red):", row_texts_empty)
    assert len(row_texts_empty) == 3
    assert all("0 red" in strip_bidi(t) for t in row_texts_empty)

    # ---- add a 3rd squad (the fake store already seeds squad-1/squad-2) ----
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#addSquadBtn')
    page.wait_for_timeout(200)
    squad_ids = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('squads/'))")
    print("squads after adding a 3rd:", squad_ids)
    assert len(squad_ids) == 3
    squad3_id = next(k.split("/")[1] for k in squad_ids if k not in ("squads/squad-1", "squads/squad-2"))

    def rate(squad_id, dim_key, color):
        page.click('.view-btn[data-view="squad"]')
        page.wait_for_timeout(100)
        page.click('.squad-pick-btn[data-id="%s"]' % squad_id)
        page.wait_for_timeout(150)
        page.click('#squadDetail .cell-btn[data-squad="%s"][data-dim="%s"]' % (squad_id, dim_key))
        page.wait_for_timeout(150)
        page.click('.swatch.%s' % color)
        page.click('#modalSave')
        page.wait_for_timeout(200)

    # release: 2 of 3 squads red (squad-3 left unscored) -> weightScore 4, dimReds=2
    rate("squad-1", "release", "crit")
    rate("squad-2", "release", "crit")
    # process: 1 warn, 1 good, 1 unscored -> weightScore 1
    rate("squad-1", "process", "warn")
    rate("squad-2", "process", "good")
    # value: all good -> weightScore 0
    rate("squad-1", "value", "good")
    rate("squad-2", "value", "good")
    rate(squad3_id, "value", "good")

    print("=== Tribe view after cross-squad ratings ===")
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)

    hot_label = page.eval_on_selector('#statHotspot', 'el=>el.textContent')
    hot_sub = page.eval_on_selector('#statHotspotSub', 'el=>el.textContent')
    print("top single hotspot (should be Easy to release, 2 of 3 squads):", hot_label, "|", hot_sub)
    assert hot_label == "Easy to release"
    assert "2 of 3" in strip_bidi(hot_sub)

    row_texts = page.eval_on_selector_all('#hotspotList .hotspot-row', 'els=>els.map(e=>e.textContent)')
    print("hotspot rows, ranked by weightScore (release, process, value):", row_texts)
    assert len(row_texts) == 3
    assert "Easy to release" in row_texts[0] and "2 red / 3" in strip_bidi(row_texts[0])
    assert "Suitable process" in row_texts[1]
    assert "Value" in row_texts[2]
    print("errors:", errors)

    page.screenshot(path=str(test_output_path("shot_tribe_hotspots.png")), full_page=True)
    print("=== ALL ERRORS:", errors)
    browser.close()
