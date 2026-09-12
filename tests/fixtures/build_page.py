"""Shared test-page builder for the Playwright regression suite.

The app (public/index.html + app.js + styles.css) is a real static site now,
not a single inline-script fragment -- so a test page has to be a real
sibling of index.html for its relative asset links (styles.css, vendor/
qrcode.js, app.js) to resolve over file://. build_page() writes one into
public/ itself (never index.html, and always a name .gitignore excludes) with
the fake in-memory store (fake_store.html) spliced into <head>, so it loads
before app.js runs.
"""
import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PUBLIC_DIR = REPO_ROOT / "public"
FIXTURES_DIR = pathlib.Path(__file__).resolve().parent

FAKE_STORE_SCRIPT = (FIXTURES_DIR / "fake_store.html").read_text(encoding="utf-8")
INDEX_HTML = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")

# index.html's <head> loads real webfonts from fonts.googleapis.com. That
# <link rel="stylesheet"> sits before every <script> tag, and per the HTML
# spec a script after a not-yet-loaded stylesheet waits for it before
# running -- so on a slow, offline, or restricted/proxied network (a CI
# runner, a sandboxed environment, someone's spotty wifi) that ONE external
# request stalls the load of every single page in the entire suite by
# however long that request takes to fail or time out. Measured in one such
# environment: ~12 SECONDS added to literally every page load, dwarfing
# every other cost in the suite by orders of magnitude (the suite's own
# explicit `wait_for_timeout` calls, combined, don't come close). No test
# here asserts on font rendering, so it's simply never needed: strip it for
# every test page, real webfonts or not.
_TEST_INDEX_HTML = re.sub(
    r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^"]*">\n?', "", INDEX_HTML
)
assert _TEST_INDEX_HTML != INDEX_HTML, "expected to find and strip the Google Fonts <link> in index.html"


def build_page(extra_seed_js="", out_name="_test_preview.html"):
    """Write a test copy of index.html into public/, with the fake store
    injected into <head> (so window.claude exists before app.js loads).

    extra_seed_js: extra JS statements spliced in right after the fake
    store's seed() call -- e.g. pre-loading a session doc so a second
    "device" (browser page) can join it, since each page's fake store is
    independent (no real network in this harness).

    out_name: filename to write under public/ -- must be unique per
    concurrently-open page within a test (the SM device and each simulated
    participant device need their own file so their fake stores don't share
    state). Always starts with "_test_" -- see .gitignore.

    Returns the written file's Path; the caller does
    page.goto("file://" + str(path.resolve()) + "?session=...") as needed.
    """
    assert out_name.startswith("_test_"), "test preview files must match the _test_* .gitignore pattern"
    fake = FAKE_STORE_SCRIPT
    if extra_seed_js:
        marker = "seed();"
        idx = fake.index(marker) + len(marker)
        fake = fake[:idx] + "\n  " + extra_seed_js + "\n" + fake[idx:]
    html = _TEST_INDEX_HTML.replace("</head>", fake + "\n</head>")
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


def write_plain_index(out_name):
    """Write a copy of index.html into public/ with the Google Fonts <link>
    stripped (see the module-level comment above) but otherwise completely
    unmodified -- no fake store spliced in, so window.claude is left exactly
    as a real deployment leaves it (undefined), for tests that need the
    REAL local-store.js/relay-client.js path rather than the fake in-memory
    store. Returns the written path; navigate to it instead of the real
    public/index.html directly."""
    assert out_name.startswith("_test_"), "test preview files must match the _test_* .gitignore pattern"
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(_TEST_INDEX_HTML, encoding="utf-8")
    return out_path


OUTPUT_DIR = REPO_ROOT / "tests" / "output"


def test_output_path(name):
    """Path under tests/output/ (gitignored) for any test-run artifact --
    a verification screenshot, a scratch CSV fixture for an import test, etc."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUT_DIR / name
