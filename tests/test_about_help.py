from playwright.sync_api import sync_playwright, expect
from fixtures.build_page import build_page, test_output_path

out = build_page(out_name='_test_about_help.html')
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(out.resolve().as_uri())
    expect(page.locator('#aboutHelpBtn')).to_be_visible(timeout=2000)
    expect(page.locator('#aboutDialog')).not_to_be_visible()
    for view in ['tribe', 'squad', 'admin']:
        page.click('[data-view="'+view+'"]')
        before = page.evaluate('JSON.stringify(window.__FAKE_STORE__)')
        page.click('#aboutHelpBtn')
        expect(page.get_by_role('dialog')).to_be_visible()
        expect(page.locator('#aboutTitle')).to_have_text('Welcome to Squad Pulse')
        page.keyboard.press('Tab')
        expect(page.locator('#aboutCloseBtn')).to_be_focused()
        page.keyboard.press('Escape')
        expect(page.locator('#aboutHelpBtn')).to_be_focused()
        assert page.evaluate('state.ui.view') == view
        assert page.evaluate('JSON.stringify(window.__FAKE_STORE__)') == before
    page.evaluate("setLocale('he')")
    page.click('#aboutHelpBtn')
    expect(page.locator('#aboutDialog')).to_have_attribute('dir', 'rtl')
    expect(page.locator('#aboutTitle')).to_have_text('ברוכים הבאים ל-Squad Pulse')
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(test_output_path('about-help-he-mobile.png')))
    assert page.locator('#aboutDialog').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    page.click('#aboutCloseBtn')
    page.evaluate("setLocale('en'); enterJoinMode(); state.joinDraftAnswers = {release:'good'}")
    before = page.evaluate('JSON.stringify(state.joinDraftAnswers)')
    page.click('#aboutHelpBtn')
    page.click('#aboutCloseBtn')
    expect(page.locator('#viewJoin')).to_be_visible()
    assert page.evaluate('JSON.stringify(state.joinDraftAnswers)') == before
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.click('#aboutHelpBtn')
    page.screenshot(path=str(test_output_path('about-help-en-desktop.png')))
    assert errors == [], errors
    browser.close()
    print('About/help: views, draft, keyboard, Hebrew RTL, mobile; errors: []')
