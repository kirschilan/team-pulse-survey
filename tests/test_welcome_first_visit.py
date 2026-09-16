from playwright.sync_api import sync_playwright, expect
from fixtures.build_page import build_page, test_output_path

out = build_page(out_name='_test_welcome_first_visit.html', show_welcome=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(out.resolve().as_uri())
    expect(page.locator('#aboutDialog')).to_be_visible()
    page.click('#aboutCloseBtn')
    # Codex review on PR #14 (P3): a bare expression string (no `() => ...`)
    # made this wait_for_function() throw a CSP `unsafe-eval` violation under
    # a stricter Chromium/Playwright combination than this repo happens to
    # be pinned to locally -- an explicit arrow-function predicate is what
    # every OTHER wait_for_function() call in this suite already uses (see
    # e.g. tests/test_relay_cross_device_sync.py), so this file's two bare-
    # expression waits were the outliers, not a new pattern.
    page.wait_for_function("() => localStorage.getItem('squadpulse:welcomeSeen') === '1'")
    page.reload()
    expect(page.locator('#aboutDialog')).not_to_be_visible()
    page.click('#aboutHelpBtn')
    expect(page.locator('#aboutDialog')).to_be_visible()
    page.click('#about-credits summary')
    expect(page.locator('#about-credits')).to_contain_text('Kazuhiko Arase')
    expect(page.locator('#about-credits a[href="licenses/qrcode-generator.txt"]')).to_be_visible()
    page.click('#about-terms summary')
    expect(page.locator('#about-terms')).to_contain_text('2026-09-15')
    page.locator('#about-terms summary').evaluate("el => el.scrollIntoView({block:'start'})")
    page.screenshot(path=str(test_output_path('welcome-terms-en.png')))
    page.evaluate("setLocale('he')")
    page.set_viewport_size({'width':390, 'height':844})
    page.locator('#about-terms summary').evaluate("el => el.scrollIntoView({block:'start'})")
    page.screenshot(path=str(test_output_path('welcome-terms-he.png')))
    expect(page.locator('#about-terms summary')).to_have_text('תנאי שימוש')
    expect(page.locator('#aboutDialog')).to_have_attribute('dir', 'rtl')
    # Legacy query-string form -- a link shared/bookmarked before SEC-4
    # (team) or before the Codex-review fix (session/cofacilitate, PR #14
    # finding P1) must still be recognized as an invitation.
    for query in ['session=ABC123', 'cofacilitate=ABC123', 'team=0123456789abcdef0123456789abcdef']:
        ctx = browser.new_context()
        q = ctx.new_page()
        q.goto(out.resolve().as_uri() + '?' + query)
        expect(q.locator('#aboutDialog')).not_to_be_visible()
        assert q.evaluate("localStorage.getItem('squadpulse:welcomeSeen')") is None
        ctx.close()
    # Codex review on PR #14 (P1): session/cofacilitate/team secrets all now
    # ride in the URL FRAGMENT (helpers.js's joinUrlFor()/coFacilitateUrlFor(),
    # board-sync.js's teamLinkFor()) -- a BARE link like this, nothing in the
    # query string at all, must still be recognized as an invitation
    # (openedFromInvitation, in state.js), not treated as a plain first-ever
    # visit.
    for fragment in ['session=ABC123', 'cofacilitate=ABC123', 'team=0123456789abcdef0123456789abcdef']:
        ctx = browser.new_context()
        q = ctx.new_page()
        q.goto(out.resolve().as_uri() + '#' + fragment)
        expect(q.locator('#aboutDialog')).not_to_be_visible()
        assert q.evaluate("localStorage.getItem('squadpulse:welcomeSeen')") is None
        ctx.close()
    for dismissal in ['escape', 'outside']:
        ctx = browser.new_context()
        q = ctx.new_page()
        q.goto(out.resolve().as_uri())
        expect(q.locator('#aboutDialog')).to_be_visible()
        if dismissal == 'escape':
            q.keyboard.press('Escape')
        else:
            q.mouse.click(2, 2)
        q.wait_for_function("() => localStorage.getItem('squadpulse:welcomeSeen') === '1'")
        q.reload()
        expect(q.locator('#aboutDialog')).not_to_be_visible()
        ctx.close()
    ctx = browser.new_context()
    q = ctx.new_page()
    q.add_init_script("Storage.prototype.getItem = Storage.prototype.setItem = function(){throw new Error('storage blocked')}")
    q.goto(out.resolve().as_uri())
    expect(q.locator('#aboutDialog')).to_be_visible()
    q.click('#aboutCloseBtn')
    expect(q.locator('#aboutDialog')).not_to_be_visible()
    assert errors == [], errors
    browser.close()
    print('First visit, dismissal, invitation bypass, blocked storage, credits, terms: passed')
