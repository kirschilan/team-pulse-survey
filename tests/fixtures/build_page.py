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

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PUBLIC_DIR = REPO_ROOT / "public"
FIXTURES_DIR = pathlib.Path(__file__).resolve().parent

FAKE_STORE_SCRIPT = (FIXTURES_DIR / "fake_store.html").read_text(encoding="utf-8")
INDEX_HTML = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")


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
    html = INDEX_HTML.replace("</head>", fake + "\n</head>")
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


OUTPUT_DIR = REPO_ROOT / "tests" / "output"


def test_output_path(name):
    """Path under tests/output/ (gitignored) for any test-run artifact --
    a verification screenshot, a scratch CSV fixture for an import test, etc."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUTPUT_DIR / name
