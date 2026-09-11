# Regression suite

Playwright + Python end-to-end tests against `public/index.html` running over
`file://`. There's no real backend yet, so every test drives the app through
`tests/fixtures/fake_store.html` — an in-memory stand-in for the Firestore-shaped
`db` API the app is written against (see `docs/standalone-plan.md` for what
replaces it). Each test file is a standalone script, not a pytest suite.

## Setup

```
pip install playwright
playwright install chromium
```

## Running

Each file is self-contained:

```
python3 tests/test_v13.py
```

Run the whole suite:

```
for f in tests/test_*.py; do python3 "$f" || echo "FAILED: $f"; done
```

Every test prints its own findings and asserts as it goes — a clean run ends
with zero uncaught exceptions and an `errors: []` (or similar) line confirming
no JavaScript errors were thrown in the page.

## How a test builds its page

`tests/fixtures/build_page.py` writes a copy of `public/index.html` into
`public/` itself (never `index.html` — always a name starting with `_test_`,
which `.gitignore` excludes) with the fake store spliced into `<head>`. It has
to live alongside the real `index.html` so its relative asset links
(`styles.css`, `vendor/qrcode.js`, `app.js`) resolve the same way they will in
production.

```python
from fixtures.build_page import build_page, test_output_path

out_path = build_page(out_name="_test_myfile.html")
page.goto("file://" + str(out_path.resolve()))
```

A test simulating a second device (a teammate joining a retro on their own
phone) calls `build_page` again with `extra_seed_js` — a snippet that seeds
that page's *independent* fake store with whatever session doc the first
"device" created, since each test page has its own store and there's no real
network in this harness yet. `window.__NOTIFY__(collectionPath)` fires that
store's listeners by hand, standing in for what a real backend would push
automatically.

Screenshots and scratch CSV fixtures go through `test_output_path(name)`,
which resolves to `tests/output/` (gitignored).

## Numbering

Files are named by the story/feature that introduced them (`test_v7.py` added
the join-link/QR flow, `test_v13.py` the direct-rating fix, etc.) rather than
by what they cover today — `test_generic.py` and `test_v2.py` through
`test_v13.py` together are the full regression suite; there's no single
"latest" file that supersedes the others.

Two files break from the `vN` scheme and are named for the coverage gap they
close instead of a story: `test_tribe_hotspots.py` (Tribe view's cross-squad
rollup/hotspot ranking — the headline feature described in the top-level
README, which had no direct coverage before) and `test_local_store.py`
(`public/local-store.js`, the localStorage-backed `db`/`downloads` shim used
outside a Claude Artifact — it loads `public/index.html` directly, without
`build_page.py`'s fake store, since that's the one scenario where
`local-store.js` is actually the thing driving the app instead of being
immediately overridden). Both were added ahead of a planned refactor of
`app.js`, specifically to give that refactor a safety net over code paths
nothing else exercised.
