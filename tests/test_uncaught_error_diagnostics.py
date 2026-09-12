from playwright.sync_api import sync_playwright
import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page

# Regression coverage for a real bug report: "Start retro session" left the
# button disabled forever with NOTHING new in the Diagnostics log -- not a
# "Started retro session" line, not a "Start session failed" line, nothing.
# Every explicit diag() call in the app happens inside a .then()/.catch(),
# so a synchronous throw (or a rejected promise nothing explicitly catches)
# upstream of those calls previously vanished without a trace, leaving
# whoever's troubleshooting with an unexplained hang and nothing to
# screenshot. helpers.js now forwards window's own "error" and
# "unhandledrejection" events into diag(), so the log always shows
# SOMETHING even for a failure nobody anticipated well enough to wrap in a
# try/catch.

out_path = build_page(out_name="_test_uncaught_error_diag.html")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("file://" + str(out_path.resolve()))
    page.wait_for_timeout(300)

    print("=== a synchronous throw with no surrounding try/catch reaches the diag log ===")
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.evaluate("setTimeout(function(){ throw new Error('synthetic-sync-boom'); }, 0);")
    page.wait_for_timeout(200)
    diag_text = page.eval_on_selector("#diagLog", "el=>el.textContent")
    print("diag log:", diag_text.strip().split("\n")[-1])
    assert "Uncaught error" in diag_text and "synthetic-sync-boom" in diag_text
    print("page errors seen (expected, this is the one we threw):", page_errors)

    print("=== an unhandled promise rejection with no .catch() reaches the diag log ===")
    # Not `return`ing the rejected promise from evaluate() matters here --
    # Playwright's own driver awaits an evaluate() expression's return
    # value, which would surface the rejection as a Python-side exception
    # instead of leaving it genuinely unhandled in the page for the
    # browser's own "unhandledrejection" event to fire on.
    page.evaluate("() => { Promise.reject(new Error('synthetic-rejection-boom')); }")
    page.wait_for_timeout(200)
    diag_text2 = page.eval_on_selector("#diagLog", "el=>el.textContent")
    print("diag log:", diag_text2.strip().split("\n")[-1])
    assert "Unhandled promise rejection" in diag_text2 and "synthetic-rejection-boom" in diag_text2

    print("=== ALL UNCAUGHT-ERROR DIAGNOSTIC TESTS PASSED ===")
    browser.close()
