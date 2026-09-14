from playwright.sync_api import sync_playwright
import pathlib, json
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Real bug report from usage (screenshots): a participant opening a retro
# session's join link on a fresh device landed on an English join screen
# even though the facilitator had switched the WHOLE app to Hebrew before
# starting the session -- the only way to see it in Hebrew was to exit the
# join screen, dig into Admin, switch the language, then tap "back to my
# retro" to return. Root cause: state.ui.locale (i18n.js) is pure per-
# device UI state, saved only to THIS browser's own localStorage -- it was
# never part of what a session/join link carries, so a brand-new device
# (no prior localStorage) always booted at the "en" default regardless of
# the facilitator's own choice.
#
# Fix, same shape as the existing team-sync-via-join-link fix
# (test_retro_join_link_carries_team_sync.py): joinUrlFor()/
# coFacilitateUrlFor() (helpers.js) now also carry the facilitator's
# CURRENT locale as a `&lang=` param (only when it isn't the "en" default,
# same minimalism as teamParamFor()'s `&team=`), and state.js's boot-time
# loadUiPrefs() applies it -- but ONLY as a fallback default when this
# device has no locale of its own already saved in localStorage, so a
# participant who has their own explicit language preference is never
# silently overridden by whatever the facilitator happens to be using.

out_path = build_page(out_name="_test_join_link_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ facilitator device: switch to Hebrew, start a session ============
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(150)

    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#startSessionBtn')
    page.wait_for_timeout(250)

    session_info = page.evaluate("""
      (function(){
        var k = Object.keys(window.__FAKE_STORE__).filter(function(x){ return x.startsWith('sessions/'); })[0];
        return { id: k.split('/')[1], doc: window.__FAKE_STORE__[k] };
      })();
    """)
    sid = session_info["id"]

    print("=== join link + co-facilitator link both carry &lang=he while facilitator is on Hebrew ===")
    join_link = page.eval_on_selector('#sessionJoinLink', 'el=>el.value')
    cofac_link = page.eval_on_selector('#coFacilitateLink', 'el=>el.value')
    print("join link:", join_link)
    print("co-facilitate link:", cofac_link)
    assert "lang=he" in join_link
    assert "lang=he" in cofac_link

    print("=== switching the facilitator back to English drops &lang= from both links ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(150)
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(100)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    join_link_en = page.eval_on_selector('#sessionJoinLink', 'el=>el.value')
    print("join link (English facilitator):", join_link_en)
    assert "lang=" not in join_link_en

    # ============ a FRESH participant device (no saved language preference) ============
    sdoc = json.dumps(session_info["doc"])
    seed_js = "STORE['sessions/" + sid + "'] = " + sdoc + ";"
    fresh_out = build_page(seed_js, out_name="_test_join_link_lang_fresh.html")

    pageA = browser.new_page(viewport={"width": 420, "height": 1400})
    errorsA = []
    pageA.on("pageerror", lambda e: errorsA.append(str(e)))
    pageA.goto("file://" + str(fresh_out.resolve()) + "?session=" + sid + "&lang=he")
    pageA.wait_for_timeout(500)

    print("=== a fresh device opening a Hebrew-tagged join link boots straight into Hebrew ===")
    locale = pageA.evaluate("state.ui.locale")
    print("state.ui.locale:", locale)
    assert locale == "he"
    assert pageA.eval_on_selector('#viewJoin', 'el=>el.getAttribute("dir")') == "rtl"
    heading_he = pageA.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    print("join heading (should be Hebrew immediately, no exit/switch/return needed):", heading_he)
    assert "Squad 1" in heading_he and heading_he != "You're joining Squad 1's retro"

    # this device's OWN preference should now be remembered too -- opening a
    # plain, un-tagged page later still shows Hebrew rather than reverting
    stored_lang = pageA.evaluate("localStorage.getItem('squadpulse:lang')")
    print("this device's own saved language preference:", stored_lang)
    assert stored_lang == "he"

    # ============ a device that ALREADY has its own saved preference is never overridden ============
    fresh_out2 = build_page(seed_js, out_name="_test_join_link_lang_existing_pref.html")
    pageB = browser.new_page(viewport={"width": 420, "height": 1400})
    errorsB = []
    pageB.on("pageerror", lambda e: errorsB.append(str(e)))
    pageB.goto("file://" + str(fresh_out2.resolve()))
    pageB.wait_for_timeout(200)
    pageB.evaluate("localStorage.setItem('squadpulse:lang', 'en')")
    pageB.goto("file://" + str(fresh_out2.resolve()) + "?session=" + sid + "&lang=he")
    pageB.wait_for_timeout(500)

    print("=== a device with its OWN existing 'en' preference is NOT overridden by the join link's &lang=he ===")
    locale_b = pageB.evaluate("state.ui.locale")
    print("state.ui.locale (should stay 'en', this device's own choice):", locale_b)
    assert locale_b == "en"
    heading_en = pageB.eval_on_selector('#joinCard h2', 'el=>el.textContent')
    print("join heading (should stay English):", heading_en)
    assert "You're joining" in heading_en and "Squad 1" in heading_en

    print("errors:", errors, errorsA, errorsB)
    assert not errors and not errorsA and not errorsB, "unexpected JS errors"
    browser.close()
    print("=== ALL JOIN LINK LANGUAGE CHECKS PASSED ===")
