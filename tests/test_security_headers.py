from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page, test_output_path

# SEC-3 (STATUS.md's "Security hardening backlog"): the Content-Security-
# Policy is delivered as a <meta http-equiv> tag in index.html (see its own
# comment for why -- unlike vercel.json's headers, this is enforced over
# file://, on a plain self-hosted static server, AND on Vercel alike), so
# it's real, testable behavior over the same file:// harness the rest of
# this suite already uses -- not just JSON config (see
# tests/unit/test_security_headers.js for that half). This drives a
# realistic walkthrough (boot, language switch, About, start a session,
# render its QR, open Templates, load a starter template, join as a
# participant) while listening for the browser's own
# `securitypolicyviolation` event -- the real signal that some resource the
# app actually needs was blocked, not a guess at what the policy covers.

out_path = build_page(out_name="_test_csp_walkthrough.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 1200})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    violations = []
    page.on("console", lambda m: violations.append(m.text) if "Content Security Policy" in m.text or "Refused to" in m.text else None)
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_selector('#adminSquadList .admin-squad-name', state="attached")

    print("=== the CSP meta tag is actually present, with the directives this app needs ===")
    csp = page.eval_on_selector('meta[http-equiv="Content-Security-Policy"]', 'el => el.content')
    print("CSP:", csp)
    assert "script-src 'self'" in csp, "script-src must be locked to 'self' -- the whole point of externalizing every inline <script>"
    assert "'unsafe-inline'" not in csp.split("style-src")[0], "script-src must not carry 'unsafe-inline'"
    assert "ws:" in csp and "wss:" in csp, "connect-src must allow the deployment-configurable relay (ws:// locally, wss:// deployed)"
    assert "frame-ancestors" not in csp, "frame-ancestors is a deliberately deferred PO decision (STATUS.md) -- shipping a default would silently break the documented iframe-embedding deployment shape"

    print("=== boot + language switch + About dialog ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('.lang-btn[data-lang="he"]')
    page.click('.lang-btn[data-lang="en"]')
    page.click('#aboutHelpBtn')
    page.click('#about-participant summary')
    page.click('#aboutCloseBtn')

    print("=== starting a retro session and rendering its QR/join-link block ===")
    page.click('.view-btn[data-view="squad"]')
    page.click('.squad-pick-btn[data-id="squad-1"]')
    page.click('#startSessionBtn')
    # real crypto.subtle round trip behind SquadPulseCrypto.roomIdFor() --
    # wait for the real signal, not a guessed delay.
    page.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")
    assert page.query_selector('#sessionQr svg') is not None, "the QR code itself must actually render under this CSP"

    print("=== Templates: loading a starter template ===")
    page.click('.view-btn[data-view="admin"]')
    page.click('#templatesBtn')
    page.wait_for_selector('#tplList .tpl-row', state="attached")
    page.click('#tplList .tpl-row[data-id="starter-tuckman"] [data-action="load"]')
    page.wait_for_selector('#confirmBackdrop', state="visible")
    page.click('#confirmOk')
    page.wait_for_function("() => window.__FAKE_STORE__['dimensions/forming'] !== undefined")
    page.click('#templatesClose') if page.query_selector('#templatesClose') else None

    print("=== joining as a participant (own tab, shared fake store) and answering a statement ===")
    session_id = page.evaluate("""
      Object.keys(window.__FAKE_STORE__).filter(k => k.startsWith('sessions/') && k.split('/').length===2)[0].split('/')[1]
    """)
    # SEC-2: joinSessionByCode() takes the session's SECRET, not its relay
    # room id -- relay-client.js's secretForRoom() is the same lookup
    # renderSessionCardHtml() itself uses to build the real join link.
    secret = page.evaluate("SquadPulseRelay.secretForRoom(%r)" % session_id)
    page.evaluate("joinSessionByCode(%r)" % secret)
    page.wait_for_selector('.stmt-row, .direct-row', state="attached")

    print("errors:", errors)
    print("CSP violations:", violations)
    assert errors == [], "unexpected JS errors: " + str(errors)
    assert violations == [], "the CSP blocked something this walkthrough actually needed: " + str(violations)
    page.screenshot(path=str(test_output_path("shot_csp_walkthrough.png")), full_page=True)
    browser.close()
    print("=== ALL CSP WALKTHROUGH CHECKS PASSED (zero violations across boot/lang/About/session/QR/templates/join) ===")
