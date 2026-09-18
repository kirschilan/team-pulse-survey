from playwright.sync_api import sync_playwright
from urllib.parse import urlparse, parse_qs
import http.server, threading, pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fixtures.build_page import build_page

# Codex review on PR #14 (P1): joinUrlFor()/coFacilitateUrlFor() (helpers.js)
# used to put the retro session's own high-entropy secret in the QUERY
# string (?session=<secret>/?cofacilitate=<secret>) -- sent as part of the
# very first HTTP navigation request, so it could land in the hosting
# server's own access logs or get echoed in a Referer header on the next
# click. SEC-4 had already closed this exact exposure for the PIGGYBACKED
# team secret (moved to the URL fragment, never sent to a server at all) but
# missed the session/co-facilitate secret itself. This is the fix's
# regression coverage, proved at the REQUEST level (not just by string-
# matching the generated link) over a real local HTTP server -- unlike
# file://, this is what actually demonstrates nothing lands in a server's
# access log: a captured Request's query string is exactly the bytes a real
# server would see.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "public"


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def log_message(self, *args):
        pass  # keep test output readable -- request capture below is via Playwright, not this log


def secret_leaked_in_query(request_url, param_names):
    query = parse_qs(urlparse(request_url).query)
    return [name for name in param_names if name in query]


httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _QuietHandler)
port = httpd.server_address[1]
server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
server_thread.start()

try:
    out = build_page(out_name="_test_join_secret_http_request.html")
    base_url = "http://127.0.0.1:%d/%s" % (port, out.name)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============ facilitator: start a session, get both real links ============
        page = browser.new_page(viewport={"width": 1280, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base_url)
        page.click('.view-btn[data-view="squad"]')
        page.click('.squad-pick-btn[data-id="squad-1"]')
        page.wait_for_selector('#startSessionBtn', state="attached")
        page.click('#startSessionBtn')
        page.wait_for_function("() => document.getElementById('sessionJoinLink') && document.getElementById('sessionJoinLink').value.length > 0")

        join_link = page.eval_on_selector('#sessionJoinLink', 'el=>el.value')
        cofac_link = page.eval_on_selector('#coFacilitateLink', 'el=>el.value')
        print("join link:", join_link)
        print("co-facilitate link:", cofac_link)

        assert "#session=" in join_link, "expected the session secret in the URL fragment: " + join_link
        assert "?session=" not in join_link, "the session secret must never appear in the query string: " + join_link
        assert "#cofacilitate=" in cofac_link, "expected the co-facilitate secret in the URL fragment: " + cofac_link
        assert "?cofacilitate=" not in cofac_link, "the co-facilitate secret must never appear in the query string: " + cofac_link

        # ============ request-level proof: capture every real HTTP request the
        # navigation itself makes, and confirm none of their QUERY strings
        # (the part a server actually receives/logs) carry the secret ============
        for label, link, param in [("join", join_link, "session"), ("co-facilitate", cofac_link, "cofacilitate")]:
            ctx = browser.new_context()
            probe = ctx.new_page()
            requests = []
            probe.on("request", lambda req: requests.append(req.url))
            probe.goto(link, wait_until="domcontentloaded")
            leaked = [u for u in requests if secret_leaked_in_query(u, [param, "session", "cofacilitate"])]
            print(label, "link -- requests captured:", requests)
            assert not leaked, label + " link leaked its secret in an HTTP request's query string: " + str(leaked)
            ctx.close()

        print("errors:", errors)
        assert errors == []
        browser.close()
        print("Session/co-facilitate secrets never appear in an HTTP request's query string: passed")
finally:
    httpd.shutdown()
    server_thread.join(timeout=5)
