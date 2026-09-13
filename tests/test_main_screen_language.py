from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# Story 4 of the multi-language roadmap (see STATUS.md): Tribe view, Squad
# view, and the shared rating modal join the Admin panel as i18n-supported
# screens. This proves the translated chrome renders, that dir="rtl" scopes
# to exactly #viewTribe/#viewSquad/#backdrop (not the document root, and not
# the still-English retro session card embedded inside #viewSquad), and that
# t()'s bidi-isolate fix (see i18n.js) keeps composite English+Hebrew and
# number+word strings in the right visual order -- a real bug found while
# building this: "{count} {unit} tracked" rendered with {count} and {unit}
# visually swapped once Hebrew took over the paragraph's bidi resolution.

LRI = "⁦"
PDI = "⁩"

out_path = build_page(out_name="_test_main_screen_lang.html")


def direction(pg, selector):
    return pg.eval_on_selector(selector, "el => getComputedStyle(el).direction")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(400)

    # rate a cell so score/fraction lines have real (non-zero) numbers to check
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(150)
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.wait_for_timeout(150)
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="release"]')
    page.wait_for_timeout(150)
    page.click('.swatch.crit')
    page.click('#modalSave')
    page.wait_for_timeout(250)

    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="he"]')
    page.wait_for_timeout(200)

    # ================= Tribe view =================
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(200)

    print("=== Tribe view: dir/lang scoping ===")
    print("viewTribe dir:", direction(page, '#viewTribe'))
    assert direction(page, '#viewTribe') == "rtl"
    assert page.eval_on_selector('html', 'el=>el.getAttribute("dir")') != "rtl"

    print("=== Tribe view: static chrome ===")
    assert page.eval_on_selector('[data-i18n="tribe.hotspots.heading"]', 'el=>el.textContent') == "נקודות חמות בין-צוותיות"
    assert page.eval_on_selector('[data-i18n="tribe.stats.riskLabel"]', 'el=>el.textContent') == "פריטים בסיכון"

    print("=== Tribe view: bidi-sensitive composite strings render in logical order ===")
    assessed_sub = page.eval_on_selector('#statAssessedSub', 'el=>el.textContent')
    print("statAssessedSub:", repr(assessed_sub))
    assert assessed_sub == f"{LRI}2 squads{PDI} במעקב"

    assessed_dir = page.eval_on_selector('#statAssessed', 'el=>el.getAttribute("dir")')
    print("statAssessed dir (forced ltr -- pure numeric ratio, no strong char to anchor it):", assessed_dir)
    assert assessed_dir == "ltr"

    page.click('#squadBreakdown summary')
    page.wait_for_timeout(150)
    score_chip = page.eval_on_selector('.score-chip', 'el=>el.textContent')
    print("score-chip (squad-1, rated crit):", repr(score_chip))
    assert score_chip == f"{LRI}2{PDI} נק' · {LRI}1/3{PDI} דורגו"

    breakdown = page.eval_on_selector('.rank-row .breakdown', 'el=>el.textContent')
    print("first rank-row breakdown:", repr(breakdown))
    assert breakdown.startswith(f"{LRI}") and "אדום" in breakdown  # אדום

    print("=== Tribe view: hotspot value (dimension label = template data, stays English) ===")
    hotspot_val = page.eval_on_selector('#statHotspot', 'el=>el.textContent')
    print("statHotspot (release rated crit above):", hotspot_val)
    assert hotspot_val == "Easy to release"
    hotspot_sub = page.eval_on_selector('#statHotspotSub', 'el=>el.textContent')
    print("statHotspotSub:", repr(hotspot_sub))
    assert hotspot_sub == f"{LRI}1{PDI} מתוך {LRI}2 squads{PDI} סימנו את זה באדום"

    # ================= Squad view =================
    page.click('.view-btn[data-view="squad"]')
    page.wait_for_timeout(200)

    print("=== Squad view: dir scoping, including the still-English session card ===")
    assert direction(page, '#viewSquad') == "rtl"
    session_card_dir = page.eval_on_selector('.session-card', 'el=>el.getAttribute("dir")')
    print("session-card dir (opt-out, still English -- Story 10's job):", session_card_dir)
    assert session_card_dir == "ltr"
    session_card_text = page.eval_on_selector('.session-card h2', 'el=>el.textContent')
    print("session-card heading (should still be English):", session_card_text)
    assert session_card_text == "Retro session"

    print("=== Squad view: static + dynamic chrome ===")
    assert page.eval_on_selector('[data-i18n="squad.picker.heading"]', 'el=>el.textContent') == "בחרו את הצוות שלכם"
    hotspots_heading = page.eval_on_selector('#squadDetail .card:not(.session-card) h2', 'el=>el.textContent')
    print("Your hotspots heading:", hotspots_heading)
    assert hotspots_heading == "הנקודות החמות שלכם"
    hotspots_hint = page.eval_on_selector('#squadDetail .card:not(.session-card) .hint', 'el=>el.textContent')
    print("hotspots hint (squad name interpolated):", repr(hotspots_hint))
    assert hotspots_hint == f"היכן {LRI}Squad 1{PDI} מסומן אדום או צהוב כרגע."

    # entry-list dimension content stays English (template data -- Stories 5-7)
    entry_label = page.eval_on_selector('.entry-row .entry-label', 'el=>el.textContent')
    print("entry-row dimension label (template data, should stay English):", entry_label)
    assert entry_label == "Easy to release"

    # ================= Rating modal =================
    page.click('#squadDetail .cell-btn[data-squad="squad-1"][data-dim="process"]')
    page.wait_for_timeout(150)
    print("=== Rating modal: dir scoping + static chrome ===")
    assert direction(page, '#backdrop') == "rtl"
    assert page.eval_on_selector('#modal .field-label', 'el=>el.textContent') == "בריאות"  # בריאות (Health)
    assert page.eval_on_selector('#modalCancel', 'el=>el.textContent') == "ביטול"  # ביטול
    assert page.eval_on_selector('#modalSave', 'el=>el.textContent') == "שמירה"  # שמירה
    note_placeholder = page.eval_on_selector('#modalNote', 'el=>el.placeholder')
    print("note placeholder (set dynamically by openEditor, not just static markup):", note_placeholder)
    assert note_placeholder == "למה הדירוג הזה? מה מניע אותו?"
    swatch_title = page.eval_on_selector('.swatch.crit', 'el=>el.getAttribute("title")')
    print("crit swatch title:", swatch_title)
    assert swatch_title == "אדום"  # אדום (Red)
    green_label = page.eval_on_selector('.anchor-pair b', 'el=>el.textContent')
    print("green label:", green_label)
    assert green_label == "ירוק נראה כך:"  # ירוק נראה כך:
    page.click('#modalCancel')
    page.wait_for_timeout(100)

    # ================= switch back to English: full restore =================
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('.lang-btn[data-lang="en"]')
    page.wait_for_timeout(200)
    page.click('.view-btn[data-view="tribe"]')
    page.wait_for_timeout(150)
    print("=== switched back to English ===")
    print("hotspots heading:", page.eval_on_selector('[data-i18n="tribe.hotspots.heading"]', 'el=>el.textContent'))
    assert page.eval_on_selector('[data-i18n="tribe.hotspots.heading"]', 'el=>el.textContent') == "Cross-squad hotspots"
    assert direction(page, '#viewTribe') == "ltr"
    assert page.eval_on_selector('#statAssessedSub', 'el=>el.textContent') == f"{LRI}2 squads{PDI} tracked"

    print("errors:", errors)
    assert not errors, "unexpected JS errors: " + str(errors)
    page.screenshot(path=str(test_output_path("shot_main_screen_language.png")), full_page=True)
    browser.close()
    print("=== ALL MAIN SCREEN LANGUAGE CHECKS PASSED ===")
