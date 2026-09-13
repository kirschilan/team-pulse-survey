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
    # clipboard-write/-read granted up front so the copy-button scenario
    # below can prove the REAL clipboard content, not just that the button
    # didn't throw -- Playwright's default context has no clipboard
    # permission at all (a real browser typically allows a user-gesture
    # clipboard WRITE without prompting; this only affects the test
    # harness, not production behavior).
    ctx = browser.new_context(permissions=["clipboard-write", "clipboard-read"])
    page = ctx.new_page()
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

    print("=== the diagnostics panel has a one-click copy button, not just select-and-copy ===")
    page.click('.view-btn[data-view="admin"]')
    page.wait_for_timeout(100)
    page.click('#diagPanel summary')
    page.wait_for_timeout(100)
    copy_btn = page.query_selector('.copy-diag-btn[data-diag-target="diagLog"]')
    print("copy button present in the Admin diagnostics panel:", copy_btn is not None)
    assert copy_btn is not None
    original_label = copy_btn.text_content()
    diag_text_before_copy = page.eval_on_selector("#diagLog", "el=>el.textContent")
    errors_before_copy = list(page_errors)  # earlier scenarios above deliberately threw -- only the copy click's OWN errors matter here
    copy_btn.click()
    page.wait_for_timeout(100)
    label_after_click = page.eval_on_selector('.copy-diag-btn[data-diag-target="diagLog"]', 'el=>el.textContent')
    print("button label right after clicking (should confirm the copy):", label_after_click)
    assert label_after_click == "Copied!"
    clipboard_text = page.evaluate("navigator.clipboard.readText()")
    print("clipboard now really contains the log (first line):", clipboard_text.split("\n")[0])
    assert clipboard_text == diag_text_before_copy, "the button must copy the log's real, current text, not something else"
    page.wait_for_timeout(1700)
    label_after_reset = page.eval_on_selector('.copy-diag-btn[data-diag-target="diagLog"]', 'el=>el.textContent')
    print("button label after the confirmation fades (should revert):", label_after_reset)
    assert label_after_reset == original_label
    print("new errors from clicking the copy button (should be none):", page_errors[len(errors_before_copy):])
    assert page_errors == errors_before_copy

    print("=== the join screen's own diagnostics panel has the same copy button, wired to ITS log ===")
    join_page = ctx.new_page()
    join_errors = []
    join_page.on("pageerror", lambda e: join_errors.append(str(e)))
    join_page.goto("file://" + str(out_path.resolve()) + "?session=NOSUCHCODE")
    join_page.wait_for_timeout(400)
    join_page.click('#joinDiagPanel summary')
    join_page.wait_for_timeout(100)
    join_copy_btn = join_page.query_selector('.copy-diag-btn[data-diag-target="joinDiagLog"]')
    print("copy button present on the join screen's diagnostics panel:", join_copy_btn is not None)
    assert join_copy_btn is not None
    join_diag_before_copy = join_page.eval_on_selector("#joinDiagLog", "el=>el.textContent")
    join_copy_btn.click()
    join_page.wait_for_timeout(100)
    join_label = join_page.eval_on_selector('.copy-diag-btn[data-diag-target="joinDiagLog"]', 'el=>el.textContent')
    assert join_label == "Copied!"
    join_clipboard_text = join_page.evaluate("navigator.clipboard.readText()")
    assert join_clipboard_text == join_diag_before_copy, "must copy the JOIN screen's own log, not the admin one"
    print("errors:", join_errors)
    assert join_errors == []

    print("=== ALL UNCAUGHT-ERROR DIAGNOSTIC TESTS PASSED ===")
    browser.close()
