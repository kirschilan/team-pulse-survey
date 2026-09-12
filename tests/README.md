# Regression suite

Playwright + Python end-to-end tests against `public/index.html` running over
`file://`. Most tests drive the app through `tests/fixtures/fake_store.html` —
an in-memory stand-in for the Firestore-shaped `db` API the app is written
against — rather than the real board/relay backends, so they stay fast and
deterministic. Two files deliberately don't use it, because they exist
specifically to test what it stands in for: `test_local_store.py` (the real
`localStorage`-backed board) and `test_relay_cross_device_sync.py` (the real
relay, over a real WebSocket, with real encryption — see `relay/README.md`).
Each test file is a standalone script, not a pytest suite.

## Setup

```
pip install playwright
playwright install chromium
```

## Running

Each file is self-contained:

```
python3 tests/test_retro_direct_rating_flow.py
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

## Naming

Every file is named for the feature or flow it covers, not for the order it
was written in — there's no single "latest" file that supersedes the others;
together they're the full regression suite. (Earlier versions of this suite
used `test_v2.py`..`test_v13.py`, numbered by the order each was added —
renamed once the suite outgrew "which story was that again?". Historical
mentions of the old names elsewhere, e.g. in `docs/facilitated-retro-spec.md`'s
own session log, are left as-is since they're dated history, not live
references.)

| File | Covers |
|---|---|
| `test_dimension_and_template_admin.py` | Rating a cell; Admin's dimension manager (rename/add/reorder/delete); saving and reloading a custom template |
| `test_template_switching_and_csv_import.py` | Switching templates preserves each one's own dimension set and squad ratings underneath; RTL (`dir=auto`) fields; a basic CSV import |
| `test_csv_import_column_matching.py` | CSV export/import round-tripping through renamed headers, reordered columns, and a template-mismatch warning |
| `test_tooltip_busy_overlay_and_csv_key.py` | Grid header hover/focus tooltip; the busy overlay during template switches and CSV import; the CSV "Dimension Key" column surviving a dimension rename |
| `test_view_navigation_and_squad_admin.py` | Tribe view's read-only grid; Squad view rating and its "hotspots" panel; Admin squad CRUD; view/squad selection persisting across reload |
| `test_scored_template_five_dysfunctions.py` | Loading the Five Dysfunctions starter template (statements/scoreBands/strategies) and reloading it idempotently |
| `test_scored_template_tuckman.py` | The Tuckman starter template end to end: 20 interleaved statements, source-assessment scoring bands (not a health judgment) |
| `test_retro_join_flow.py` | Starting/closing a retro session; sharing by code, link, or QR; joining by each path; bad/expired code or link |
| `test_retro_statement_survey_submission.py` | A teammate's full statement-based survey submission across every dimension, personal results, facilitator live view |
| `test_retro_direct_rating_flow.py` | The same submission flow for a direct-rating (non-statement) template |
| `test_retro_reveal_mode_and_consolidation.py` | The hold/live reveal toggle, majority consolidation, and calmer-bucket tie-breaking |
| `test_retro_override_and_response_table.py` | Facilitator override of a consolidated result, resetting it, and the per-response anonymized table |
| `test_retro_experiment_note_and_finish.py` | The shared sprint-experiment note; finishing a retro writes results into the squad, or no-ops with nothing submitted |
| `test_tribe_hotspots.py` | Tribe view's cross-squad hotspot rollup and ranking (`renderHotspots`/`renderStats`) |
| `test_local_store.py` | `public/local-store.js` itself — seeding, reload persistence, cross-tab sync, real CSV download, non-interference with a real `window.claude` |
| `test_relay_cross_device_sync.py` | The real relay end to end: starts `relay/server.js` as a subprocess and drives two independent browser contexts (facilitator + participant) through a full retro over a real encrypted WebSocket connection, plus a third late-joiner confirming a closed session is really gone |
| `test_starter_template_spotify.py` | The Spotify Squad Health Check starter template — listed, loadable, and reloadable after switching away, same as the other two starters |
| `test_relay_error_handling.py` | What happens when the relay is unavailable: no relay configured fails fast with no network attempt at all (not a doomed `ws://localhost` guess triggering a private-network permission prompt), a configured-but-unreachable relay retries with bounded backoff instead of forever, a rapid multi-click on "Start retro session" only ever creates one session, and the diagnostic log survives an in-progress text selection |
| `test_relay_config_injection.py` | `scripts/generate-relay-config.js` (the Vercel build step that wires a deployed relay's URL in via the `SQUAD_PULSE_RELAY_URL` environment variable): writes a real assignment when the variable is set, leaves a no-op placeholder when it isn't, and — driven through `index.html`'s actual script order — an injected value really does win over the page's own protocol/hostname default |
