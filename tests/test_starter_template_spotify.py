from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# The board's own default dimension set (Spotify Squad Health Check) was
# never itself a loadable starter template -- only the seed data for a
# fresh board. Switching to Five Dysfunctions or Tuckman and back left no
# way to reload it from the Templates modal. Fixed by registering it as a
# proper starter template (state.js's SPOTIFY_TEMPLATE), same shape as the
# other two. Reported from real usage on a deployed preview.

out_path = build_page(out_name="_test_starter_spotify.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width":1280,"height":1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    print("=== Spotify appears as a starter template, alongside the other two ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    starter_row = page.query_selector('#tplList .tpl-row[data-id="starter-spotify"]')
    print("starter-spotify row found:", starter_row is not None)
    assert starter_row is not None
    has_delete = page.query_selector('#tplList .tpl-row[data-id="starter-spotify"] [data-action="delete"]')
    print("starter row has no delete button (like the other starters):", has_delete is None)
    assert has_delete is None
    meta = page.eval_on_selector('#tplList .tpl-row[data-id="starter-spotify"] .tmeta', 'el=>el.textContent')
    print("meta line:", meta)
    assert "12 dimension" in meta

    print("=== switch away to Five Dysfunctions, then load Spotify back ===")
    page.click('#tplList .tpl-row[data-id="starter-5dysfunctions"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(400)
    dim_keys_5df = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/')).sort()")
    print("dimension keys on Five Dysfunctions:", dim_keys_5df)
    assert len(dim_keys_5df) == 5

    page.click('#templatesBtn')
    page.wait_for_timeout(150)
    page.click('#tplList .tpl-row[data-id="starter-spotify"] [data-action="load"]')
    page.wait_for_timeout(100)
    page.click('#confirmOk')
    page.wait_for_timeout(400)

    dim_keys_back = page.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('dimensions/')).sort()")
    print("dimension keys after loading Spotify back:", dim_keys_back)
    assert len(dim_keys_back) == 12
    release_doc = page.evaluate("window.__FAKE_STORE__['dimensions/release']")
    print("release dimension content:", release_doc)
    assert release_doc["label"] == "Easy to release"
    assert release_doc["green"] and release_doc["red"]
    assert not release_doc.get("statements"), "Spotify dimensions are direct-rating, not statement-scored"
    config = page.evaluate("window.__FAKE_STORE__['meta/config']")
    print("active template name:", config.get("activeTemplateName"))
    assert config.get("activeTemplateName") == "Spotify Squad Health Check"
    print("errors:", errors)

    print("=== the retro join screen shows it as direct-rating rows, as before ===")
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#startSessionBtn')
    page.wait_for_timeout(250)
    session_doc = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return window.__FAKE_STORE__[k];
      })();
    """)
    print("session dimension count:", len(session_doc["dimensions"]))
    assert len(session_doc["dimensions"]) == 12
    print("errors:", errors)

    print("=== Story 5: switching to Hebrew live-translates the Spotify template's dimension content ===")
    print("(no explicit template reload -- fixes a real gap: the DEFAULT board never went through")
    print(" loadTemplate() at all, so an earlier load-time-only translation never applied to it)")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    # stored data stays English always -- localization is a render-time concern
    # (state.js's localizedDimText()/localizedAttribution()), never baked into
    # the dimension docs or config themselves
    release_doc_he = page.evaluate("window.__FAKE_STORE__['dimensions/release']")
    config_he = page.evaluate("window.__FAKE_STORE__['meta/config']")
    english_attribution = page.evaluate("SPOTIFY_ATTRIBUTION")
    print("stored release dimension content under Hebrew (should stay English):", release_doc_he)
    assert release_doc_he["label"] == "Easy to release"
    assert config_he.get("attribution") == english_attribution

    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    page.click('#legendSummary')
    page.wait_for_timeout(150)
    release_label_he = page.eval_on_selector('.legend-item .lh', 'el=>el.textContent')
    release_green_he = page.eval_on_selector('.legend-item p:nth-of-type(1) span[dir="auto"]', 'el=>el.textContent')
    release_red_he = page.eval_on_selector('.legend-item p:nth-of-type(2) span[dir="auto"]', 'el=>el.textContent')
    attribution_he = page.eval_on_selector('#legendAttrib', 'el=>el.textContent')
    print("Tribe legend under Hebrew -- label/green/red/attribution:", release_label_he, release_green_he, release_red_he, attribution_he)
    assert release_label_he.strip() and release_label_he != "Easy to release"
    assert release_green_he != "Releasing is routine, low-risk, and low-drama."
    assert release_red_he != "Releases are rare, risky, or dreaded events."
    assert attribution_he.strip() and attribution_he != english_attribution
    # the Templates-modal display name itself stays English -- that's Story 8's
    # job, not this one's
    assert config_he.get("activeTemplateName") == "Spotify Squad Health Check"

    print("=== switching back to English immediately restores English display (live both ways) ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    release_label_en = page.eval_on_selector('.legend-item .lh', 'el=>el.textContent')
    attribution_en = page.eval_on_selector('#legendAttrib', 'el=>el.textContent')
    print("Tribe legend restored to English:", release_label_en, attribution_en)
    assert release_label_en == "Easy to release"
    assert attribution_en == english_attribution
    print("errors:", errors)

    page.screenshot(path=str(test_output_path("shot_starter_spotify.png")), full_page=True)
    print("=== ALL ERRORS:", errors)
    browser.close()
