from playwright.sync_api import sync_playwright
import pathlib, json
from urllib.parse import urlparse, parse_qs
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
# same minimalism as teamHashFor()'s `#team=`), and state.js's boot-time
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
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    # setView() (app.js) calls renderAll() SYNCHRONOUSLY on every switch, and
    # setLocale() (i18n.js) is equally synchronous -- selectSquad() (squads.js)
    # also renders synchronously -- so click()'s own auto-wait for each next
    # target is all that's needed between these.
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')

    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#startSessionBtn')
    # evaluate() below doesn't auto-wait -- startSession() (retro-facilitator.js)
    # writes to the fake store synchronously (its set() mutates STORE and calls
    # notify() synchronously, which re-renders the session card -- including
    # #sessionJoinLink/#coFacilitateLink -- via the long-lived sessions
    # listener registered at boot in db.js), but poll for the real write
    # landing rather than assume that timing.
    page.wait_for_function("() => Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/')).length === 1")

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
    # SEC-2: a join URL's session= is the session's SECRET, not its relay
    # room id -- extract it from the real, rendered link rather than the
    # room id the fake store's own doc keys are (incidentally) named after.
    # Codex review on PR #14 (P1): it now rides in the URL FRAGMENT, not the
    # query string (helpers.js's joinUrlFor()).
    secret = parse_qs(urlparse(join_link).fragment)["session"][0]

    print("=== switching the facilitator back to English drops &lang= from both links ===")
    # Same synchronous setView()/setLocale()/selectSquad() reasoning as above
    # -- no wait needed for any of these four clicks; selectSquad()'s own
    # renderSquadView() rebuilds the (already-started) session card in the
    # new locale synchronously, so the join link is current the instant the
    # last click's handler returns.
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
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
    pageA.goto("file://" + str(fresh_out.resolve()) + "?lang=he#session=" + secret)
    # eval_on_selector()/evaluate() below don't auto-wait -- a fresh device's
    # listenJoinSession() (retro-join.js) has a genuine async gap on its
    # FIRST onSnapshot delivery (the fake store deliberately delays it,
    # unlike its later synchronous notify() calls). Once state.joinSession
    # lands, listenJoinSession()'s own callback calls renderJoinScreen()
    # synchronously in the same tick, so this is the real "join screen
    # rendered the loaded session" signal, not a guessed sleep.
    pageA.wait_for_function("() => state.joinSession && state.joinSession.status === 'open'")

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
    # This first load is only a vehicle to seed localStorage before the real
    # navigation below -- page.goto() already waits for the load event, so
    # the JS context (and localStorage) is ready the instant it returns; the
    # page's own boot state doesn't matter since it's about to be reloaded.
    pageB.evaluate("localStorage.setItem('squadpulse:lang', 'en')")
    pageB.goto("file://" + str(fresh_out2.resolve()) + "?lang=he#session=" + secret)
    # Same genuine-async-gap reasoning as pageA above.
    pageB.wait_for_function("() => state.joinSession && state.joinSession.status === 'open'")

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
