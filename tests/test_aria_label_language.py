from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Untranslated-text audit (see STATUS.md): a text-node scan under Hebrew
# found the app's visible strings all translated, but a separate attribute
# grep caught five screen-reader-only aria-labels that a text scan can't
# see -- they were never wired to t()/data-i18n at all, so a Hebrew-locale
# screen-reader user always heard these five in English regardless of
# locale. Four are static markup (index.html): the header's Tribe/Squad/
# Admin view switcher, the Tribe stats section, the Admin language
# switcher, and the team-link input. The fifth (retro-facilitator.js's
# reveal-mode toggle) is JS-rendered, so it calls t() directly instead of
# using data-i18n-aria-label, same as this file's other JS-built aria-labels
# already do (i18n.js's own comment on applyStaticTranslations()).

out_path = build_page(out_name="_test_aria_label_lang.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1400})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== defaults to English on first load ===")
    assert page.eval_on_selector('.view-switch[role="tablist"]:not(.lang-switch):not(.reveal-toggle)', 'el=>el.getAttribute("aria-label")') == "View"
    assert page.eval_on_selector('.stats', 'el=>el.getAttribute("aria-label")') == "Snapshot at a glance"
    assert page.eval_on_selector('.lang-switch', 'el=>el.getAttribute("aria-label")') == "Language"
    assert page.eval_on_selector('#teamLinkInput', 'el=>el.getAttribute("aria-label")') == "Team link"

    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')

    print("=== switched to Hebrew: all five aria-labels are translated ===")
    view_switch_aria_he = page.eval_on_selector('.view-switch[role="tablist"]:not(.lang-switch):not(.reveal-toggle)', 'el=>el.getAttribute("aria-label")')
    stats_aria_he = page.eval_on_selector('.stats', 'el=>el.getAttribute("aria-label")')
    lang_aria_he = page.eval_on_selector('.lang-switch', 'el=>el.getAttribute("aria-label")')
    team_link_aria_he = page.eval_on_selector('#teamLinkInput', 'el=>el.getAttribute("aria-label")')
    print("view switch:", view_switch_aria_he, "| stats:", stats_aria_he, "| language switch:", lang_aria_he, "| team link:", team_link_aria_he)
    assert view_switch_aria_he != "View" and view_switch_aria_he.strip()
    assert stats_aria_he != "Snapshot at a glance" and stats_aria_he.strip()
    assert lang_aria_he != "Language" and lang_aria_he.strip()
    assert team_link_aria_he != "Team link" and team_link_aria_he.strip()

    print("=== retro session card's reveal-mode toggle aria-label is translated too ===")
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#startSessionBtn')
    page.wait_for_selector('.reveal-toggle', state="attached")
    reveal_aria_he = page.eval_on_selector('.reveal-toggle', 'el=>el.getAttribute("aria-label")')
    print("reveal-mode toggle:", reveal_aria_he)
    assert reveal_aria_he != "Reveal mode" and reveal_aria_he.strip()

    print("=== switching back to English restores all five ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="en"]')
    assert page.eval_on_selector('.view-switch[role="tablist"]:not(.lang-switch):not(.reveal-toggle)', 'el=>el.getAttribute("aria-label")') == "View"
    assert page.eval_on_selector('.stats', 'el=>el.getAttribute("aria-label")') == "Snapshot at a glance"
    assert page.eval_on_selector('.lang-switch', 'el=>el.getAttribute("aria-label")') == "Language"
    assert page.eval_on_selector('#teamLinkInput', 'el=>el.getAttribute("aria-label")') == "Team link"
    page.click('.view-btn[data-view="squad"]')
    reveal_aria_en = page.eval_on_selector('.reveal-toggle', 'el=>el.getAttribute("aria-label")')
    print("reveal-mode toggle (back to English):", reveal_aria_en)
    assert reveal_aria_en == "Reveal mode"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_aria_label_language.png")), full_page=True)
    browser.close()
    print("=== ALL ARIA-LABEL LANGUAGE CHECKS PASSED ===")
