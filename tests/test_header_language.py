from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Multi-language rollout Story 6 (see STATUS.md's backlog table): the app
# header/nav chrome -- h1, tagline, model badge, sync status, "Join a
# retro"/"Back to my retro", and the Tribe/Squad/Admin view switcher -- had
# no story of its own and stayed untranslated even after Stories 1-5, since
# it sits outside every <section> view container Stories 1/4 scoped their
# dir/lang flip to. Flagged from a real screenshot review, not invented here.
#
# The product/app NAME itself ("Squad Pulse") is a deliberate brand-name
# pass-through: same literal value in en.js and he.js, still routed through
# t() (so it satisfies the DOD's "every string on an i18n-supported screen
# goes through t()" mechanically) rather than translated -- same category of
# call as leaving {unit}/{unitPlural} untranslated (Story 1's own locked
# decision, see locales/en.js's header comment).

LRI = "⁦"
PDI = "⁩"

out_path = build_page(out_name="_test_header_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    # eval_on_selector()/query_selector() below don't auto-wait --
    # renderAdminSquadList() only populates this once the async store load +
    # first render() pass lands, so this is the real boot-complete marker
    # (same one test_hebrew_rtl_coverage.py uses), not a guessed sleep.
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== defaults to English on first load ===")
    assert page.eval_on_selector("h1", "el=>el.textContent") == "Squad Pulse"
    assert page.eval_on_selector("#joinCodeBtn", "el=>el.textContent") == "Join a retro"
    assert page.eval_on_selector("#backToRetroBtn", "el=>el.textContent") == "← Back to my retro"
    assert page.eval_on_selector('.view-btn[data-view="tribe"]', "el=>el.textContent") == "Tribe view"
    assert page.eval_on_selector('.view-btn[data-view="squad"]', "el=>el.textContent") == "Squad view"
    assert page.eval_on_selector('.view-btn[data-view="admin"]', "el=>el.textContent") == "Admin"
    tagline_en = page.eval_on_selector("#tagline", "el=>el.textContent")
    print("tagline (English):", tagline_en)
    assert tagline_en == f"A fast, visual health snapshot across your {LRI}squads{PDI} — so you can see at a glance where things are strong and where to invest next."
    sync_text_en = page.eval_on_selector("#syncText", "el=>el.textContent")
    print("sync status (English):", sync_text_en)
    assert sync_text_en in ("Live — synced across viewers", "Preview only — not connected")

    # setView()/setLocale() are both synchronous (established across this
    # pass) -- no wait needed for any of these three clicks.
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')
    page.click('.view-btn[data-view="tribe"]')

    print("=== switched to Hebrew: #appHeader scopes dir/lang, document root untouched ===")
    assert page.eval_on_selector("#appHeader", 'el=>el.getAttribute("dir")') == "rtl"
    assert page.eval_on_selector("html", 'el=>el.getAttribute("dir")') != "rtl"

    print("=== app name stays the same literal brand text in both locales ===")
    assert page.eval_on_selector("h1", "el=>el.textContent") == "Squad Pulse"

    print("=== the rest of the header chrome is now Hebrew ===")
    join_he = page.eval_on_selector("#joinCodeBtn", "el=>el.textContent")
    back_he = page.eval_on_selector("#backToRetroBtn", "el=>el.textContent")
    tribe_btn_he = page.eval_on_selector('.view-btn[data-view="tribe"]', "el=>el.textContent")
    squad_btn_he = page.eval_on_selector('.view-btn[data-view="squad"]', "el=>el.textContent")
    admin_btn_he = page.eval_on_selector('.view-btn[data-view="admin"]', "el=>el.textContent")
    print("join/back/view-switch (Hebrew):", join_he, "|", back_he, "|", tribe_btn_he, squad_btn_he, admin_btn_he)
    assert join_he != "Join a retro" and join_he.strip()
    assert back_he != "← Back to my retro" and back_he.strip()
    assert tribe_btn_he != "Tribe view" and tribe_btn_he.strip()
    assert squad_btn_he != "Squad view" and squad_btn_he.strip()
    assert admin_btn_he != "Admin" and admin_btn_he.strip()

    tagline_he = page.eval_on_selector("#tagline", "el=>el.textContent")
    print("tagline (Hebrew, {unitPlural} interpolated):", repr(tagline_he))
    assert tagline_he != tagline_en and tagline_he.strip()
    assert f"{LRI}squads{PDI}" in tagline_he, "the interpolated English unit word must stay bidi-isolated inside the Hebrew sentence"

    print("=== sync status text is translated too (both live and preview-only phrasing) ===")
    # setSyncStatus() (db.js) is a two-line, fully synchronous DOM update --
    # evaluate() awaits the full script execution, so no wait is needed
    # before reading its effect right after.
    page.evaluate("setSyncStatus(true)")
    sync_live_he = page.eval_on_selector("#syncText", "el=>el.textContent")
    print("sync status, live (Hebrew):", sync_live_he)
    assert sync_live_he != "Live — synced across viewers" and sync_live_he.strip()
    page.evaluate("setSyncStatus(false)")
    sync_preview_he = page.eval_on_selector("#syncText", "el=>el.textContent")
    print("sync status, preview-only (Hebrew):", sync_preview_he)
    assert sync_preview_he != "Preview only — not connected" and sync_preview_he.strip()
    assert sync_preview_he != sync_live_he

    print("=== the model badge (an active TEMPLATE's own display name) is unaffected -- Story 9's job, not this one's ===")
    badge_text = page.eval_on_selector("#modelBadge", "el=>el.textContent")
    print("model badge:", badge_text)
    assert badge_text == "Spotify Squad Health Check"

    print("=== switching back to English fully restores the header ===")
    # Same synchronous setView()/setLocale()/setSyncStatus() reasoning as
    # above -- no wait needed for any of these three clicks or the evaluate().
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')
    page.click('.view-btn[data-view="tribe"]')
    page.evaluate("setSyncStatus(true)")
    assert page.eval_on_selector("#appHeader", 'el=>el.getAttribute("dir")') != "rtl"
    assert page.eval_on_selector("#joinCodeBtn", "el=>el.textContent") == "Join a retro"
    assert page.eval_on_selector('.view-btn[data-view="admin"]', "el=>el.textContent") == "Admin"
    assert page.eval_on_selector("#tagline", "el=>el.textContent") == tagline_en
    assert page.eval_on_selector("#syncText", "el=>el.textContent") == "Live — synced across viewers"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_header_language.png")), full_page=True)
    browser.close()
    print("=== ALL HEADER LANGUAGE CHECKS PASSED ===")
