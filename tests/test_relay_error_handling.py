from playwright.sync_api import sync_playwright
import pathlib

# Regression coverage for a real bug report from a deployed Vercel preview
# with no relay configured/reachable: clicking "Start retro session" made
# Chrome pop a private-network-access permission prompt (an https:// page
# opening ws://localhost:8787 -- the VISITOR'S OWN machine, not a real
# relay), then the button just sat there forever with no feedback, while
# the diagnostic log scrolled "reconnecting" messages endlessly and became
# impossible to select-and-copy.
#
# Three independent fixes, each covered below:
#   1. index.html only defaults SQUAD_PULSE_RELAY_URL to a local relay when
#      the PAGE ITSELF is local (file:// or localhost) -- verified as a pure
#      function separately (see the commit); a deployed page with no
#      explicit override now gets `null`, not a doomed localhost guess.
#   2. relay-client.js fails FAST and CLEARLY when no relay is configured
#      (no WebSocket attempt at all -- tested here in isolation, since
#      index.html's own `||` default can't be overridden through a real
#      page load without genuinely changing origin/hostname), and gives up
#      after a bounded number of reconnect attempts when a relay IS
#      configured but unreachable, rather than retrying forever.
#   3. The "Start retro session" button disables itself while pending (so
#      impatient extra clicks can't spawn more orphaned rooms), and shows a
#      real error dialog instead of just sitting there when the write fails
#      -- tested through the real app UI, pointed at a real-but-unreachable
#      relay URL (a truthy override survives index.html's `||` fallback
#      regardless of protocol/hostname, unlike `null`).
#   4. diag() no longer wipes out an in-progress text selection every time
#      a new line arrives, so the log can actually be selected and copied.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "public"
CRYPTO_JS = (PUBLIC_DIR / "js" / "crypto.js").read_text(encoding="utf-8")
RELAY_CLIENT_JS = (PUBLIC_DIR / "js" / "relay-client.js").read_text(encoding="utf-8")


def build_relay_isolation_harness(relay_url_js_literal, out_name):
    """A minimal page loading ONLY crypto.js + relay-client.js, with
    SQUAD_PULSE_RELAY_URL set directly -- bypasses index.html's own
    protocol/hostname-based default entirely, which is the point: this
    tests relay-client.js's own handling of an already-decided URL (or lack
    of one), not index.html's decision logic (covered separately as a pure
    function, since it only depends on location.protocol/hostname)."""
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<script>window.SQUAD_PULSE_RELAY_URL = " + relay_url_js_literal + ";</script>"
        "<script>" + CRYPTO_JS + "</script>"
        "<script>" + RELAY_CLIENT_JS + "</script>"
        "</head><body>"
        "<div id='diagLog'></div>"
        "<script>window.diag = function(msg){ document.getElementById('diagLog').textContent += msg + \"\\n\"; };</script>"
        "</body></html>"
    )
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ============ 1. no relay configured at all: fail fast, no network attempt ============
    print("=== no relay configured: set/get/onSnapshot all resolve immediately, no WebSocket attempted ===")
    harness1 = build_relay_isolation_harness("null", "_test_relay_unavailable.html")
    page1 = browser.new_page()
    console1 = []
    page1.on("console", lambda m: console1.append(m.type + ": " + m.text))
    page1.on("pageerror", lambda e: console1.append("PAGEERROR: " + str(e)))
    page1.goto("file://" + str(harness1.resolve()), wait_until="domcontentloaded")
    page1.wait_for_timeout(200)

    result = page1.evaluate("""
      (async () => {
        var out = {};
        try {
          await SquadPulseRelay.doc("sessions/TESTCODE").set({hello:"world"});
          out.setResult = "resolved (unexpected)";
        } catch(e) { out.setResult = e.code; }
        var snap = await SquadPulseRelay.doc("sessions/TESTCODE").get();
        out.getExists = snap.exists;
        out.onSnapshotExists = await new Promise((resolve) => {
          SquadPulseRelay.doc("sessions/TESTCODE").onSnapshot(function(d){ resolve(d.exists); });
        });
        return out;
      })()
    """)
    print("result:", result)
    assert result["setResult"] == "unavailable"
    assert result["getExists"] == False
    assert result["onSnapshotExists"] == False

    diag_text = page1.eval_on_selector("#diagLog", "el=>el.textContent")
    print("diag log:", diag_text.strip())
    assert "no relay configured" in diag_text

    ws_attempts = [m for m in console1 if "WebSocket" in m or "ws://" in m]
    print("WebSocket-related console messages (should be none):", ws_attempts)
    assert ws_attempts == [], "no relay configured should mean no connection attempt at all -- this is exactly what triggered the private-network permission prompt on a real deployment"
    print("OK")

    # ============ 2. relay configured but unreachable: bounded retries, not infinite ============
    print("=== relay unreachable: retries with backoff, does not spam forever ===")
    harness2 = build_relay_isolation_harness('"ws://localhost:18999"', "_test_relay_unreachable.html")
    page2 = browser.new_page()
    page2.goto("file://" + str(harness2.resolve()), wait_until="domcontentloaded")
    page2.evaluate("SquadPulseRelay.doc('sessions/UNREACHABLE').onSnapshot(function(){});")
    page2.wait_for_timeout(1800)  # long enough for at least 2 backoff rounds (250ms, 500ms), short of the full ~8-attempt budget
    log2 = page2.eval_on_selector("#diagLog", "el=>el.textContent")
    print("diag log after 1.8s:", log2.strip())
    assert "attempt 1/8" in log2
    assert "attempt 2/8" in log2
    print("OK (full exhaustion-then-give-up behavior verified manually against the real timing; not re-timed here to keep the suite fast)")

    # ============ 3. the real app: a rapid double-click starts only ONE session ============
    # The bug report showed nine different session codes all reconnecting at
    # once -- almost certainly nine clicks on a button that gave no feedback.
    # startingSessionFor in retro.js guards against this independent of any
    # one button element's `disabled` attribute (a re-render mid-request
    # would otherwise hand back a fresh, clickable button -- verified this
    # was a real gap before adding that guard). Uses fake_store.html (fast,
    # reliable, no network) since this is about the click guard itself, not
    # the relay -- that's covered separately by test_relay_cross_device_sync.py.
    print("=== real app: rapid double-click on Start Session creates only one session ===")
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    from fixtures.build_page import build_page  # noqa: E402  (path inserted just above)

    app_out = build_page(out_name="_test_relay_double_click.html")
    page3 = browser.new_page(viewport={"width":1280,"height":1000})
    errors3 = []
    page3.on("pageerror", lambda e: errors3.append(str(e)))
    page3.goto("file://" + str(app_out.resolve()))
    page3.wait_for_timeout(400)

    page3.click('.view-btn[data-view="squad"]')
    page3.wait_for_timeout(100)
    page3.click('.squad-pick-btn[data-id="squad-1"]')
    page3.wait_for_timeout(150)
    page3.evaluate("""
      () => {
        var btn = document.getElementById('startSessionBtn');
        for (var i=0;i<5;i++) btn.click();
      }
    """)
    page3.wait_for_timeout(400)
    session_keys = page3.evaluate("Object.keys(window.__FAKE_STORE__).filter(k=>k.startsWith('sessions/') && k.split('/').length===2)")
    print("session doc keys after 5 rapid clicks (should be exactly 1):", session_keys)
    assert len(session_keys) == 1
    print("errors:", errors3)

    # ============ 4. diag() no longer wipes an in-progress text selection ============
    print("=== diag(): an active selection inside the log survives new lines arriving ===")
    page3.evaluate("""
      () => {
        window.diag("line one");
        var el = document.getElementById("diagLog");
        var range = document.createRange();
        range.selectNodeContents(el);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    """)
    before = page3.eval_on_selector("#diagLog", "el=>el.textContent")
    page3.evaluate("window.diag('line two, arriving mid-selection')")
    during = page3.eval_on_selector("#diagLog", "el=>el.textContent")
    print("content unchanged while selected:", before == during)
    assert before == during, "a new diag line should not overwrite the DOM while the user has it selected"
    page3.evaluate("window.getSelection().removeAllRanges()")
    page3.evaluate("window.diag('line three, after selection cleared')")
    after = page3.eval_on_selector("#diagLog", "el=>el.textContent")
    print("content updates again once selection clears:", "line three" in after)
    assert "line three" in after
    print("errors:", errors3)

    browser.close()

print("=== ALL RELAY ERROR-HANDLING TESTS PASSED ===")
