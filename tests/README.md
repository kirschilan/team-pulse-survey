# Regression suite

See `docs/DefinitionOfDone.md` for the standing policy this suite exists to
satisfy (full suite green, zero JS errors, before any change is done); this
file is the mechanics.

Two tiers:

- **`tests/unit/`** — plain Node (`node:test`, nothing to install) tests of
  pure logic with no DOM dependency: consolidation/scoring math, CSV
  parsing/column-matching. Milliseconds, not seconds. See
  `tests/unit/README.md`.
- **`tests/test_*.py`** (this directory) — Playwright + Python end-to-end
  tests against `public/index.html` running over `file://`, for everything
  that needs a real browser: UI interaction, real DOM state, real
  WebSocket/`crypto.subtle`. Most drive the app through
  `tests/fixtures/fake_store.html` — an in-memory stand-in for the
  Firestore-shaped `db` API the app is written against — rather than the
  real board/relay backends, so they stay fast and deterministic. A few
  files deliberately don't use it, because they exist specifically to test
  what it stands in for: `test_local_store.py` (the real
  `localStorage`-backed board) and `test_relay_cross_device_sync.py` (the
  real relay, over a real WebSocket, with real encryption — see
  `relay/README.md`). Each file is a standalone script, not a pytest suite.

Together, these are the full regression suite — a change to consolidation
math or CSV matching should get a unit test; a change to what the user sees
or clicks needs a Playwright test.

## Setup

```
pip install -r tests/requirements.txt
playwright install chromium
```

The pinned version in `tests/requirements.txt` matters: Playwright ties
its Chromium build to the exact package version, so an unpinned `pip
install playwright` can silently put two contributors' machines on
different Chromium builds with no way to tell from the repo. If you ever
report a test-timing discrepancy that another environment can't
reproduce, check `pip show playwright` (or `playwright --version`) on
both sides before assuming it's a code bug or a flake — see
`docs/DefinitionOfDone.md`.

(`tests/unit/` needs nothing beyond Node itself.)

## Running

Each Playwright file is self-contained:

```
python3 tests/test_retro_direct_rating_flow.py
```

Run the whole suite:

```
node --test tests/unit/test_*.js
for f in tests/test_*.py; do python3 "$f" || echo "FAILED: $f"; done
```

Every test prints its own findings and asserts as it goes — a clean run ends
with zero uncaught exceptions and an `errors: []` (or similar) line confirming
no JavaScript errors were thrown in the page.

`tests/run_all.sh` (unlike the plain shell loop above) times itself and warns
if the full suite runs more than 15% over the number in
`tests/.timing_baseline` — this is the growth-budget check in
`docs/DefinitionOfDone.md`, catching a rising trend in fixed sleeps (or
anything else slow) before it compounds across every new test added
afterward, the way it did before 2026-09-15.

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

A test needing a materially different fake store than `fake_store.html`
provides (a custom `window.claude` shape, extra test-only globals) can call
`build_custom_page(extra_head_html, out_name)` instead, splicing its own
`<script>` block in the same way. **Never** read and splice
`public/index.html` by hand (`(public_dir/"index.html").read_text()...`) —
that bypasses the Google Fonts `<link>` strip both `build_page()` and
`write_plain_index()` apply, and costs the file real, measured wall-clock
time (~12s) per run: found in a 2026-09-12 perf pass, where it was most of
one file's 17.6s runtime — see `test_dimension_and_template_admin.py`'s
history and STATUS.md's session log.

## Performance

**Run the suite with `tests/run_all.sh`, not a serial loop.** Every file is
fully independent by construction — its own unique `build_page()` /
`write_plain_index()` output filename, and its own hardcoded relay port
where a relay-backed file spawns one (verified: no two files in the suite
share either) — so running them as separate processes at the same time is
safe with zero test changes. `run_all.sh` dispatches through
`tests/_run_one.sh` via `xargs -n 1 -P`, not `xargs -I{} sh -c '...'` — the
latter is a known-broken combination on macOS/BSD's `xargs` (fails with
"command line cannot be assembled, too long" even for a single short
input; see `run_all.sh`'s own comment). `run_all.sh` defaults to 2 workers
at a time; measured on a 4-core machine early on (~30 files), that ran the
full suite with zero failures in a bit over a third of the serial time (a
plain `for f in tests/test_*.py; do python3 "$f"; done` loop). Pushing
concurrency to 4 (one worker per core, no headroom) cut it further but
produced a real, reproducible flake purely from CPU contention — passing
standalone every time, only failing under a fully-saturated CPU.

That "2 is safe" number was never re-measured as the suite kept growing,
and it stopped holding: by 35 files, a single unsharded `TEST_JOBS=2` batch
over the WHOLE suite started failing reproducibly (same class of CPU/CDP
contention crash, confirmed unrelated to any specific test's code via a
git-stash comparison against the pre-change version). What kept working at
any size tried: splitting the suite into groups of ~12 files first, THEN
running each group at `TEST_JOBS=2` — exactly what CI's own 3-way shard
already does. So `run_all.sh`'s default (no-args) invocation now shards
itself the same way locally before running anything, rather than handing
the whole discovered file list to one `xargs` batch — see its own comment
for the exact reasoning and the `SHARD_COUNT` env var. An explicit file
list (`run_all.sh tests/test_a.py tests/test_b.py`, which is what CI's own
per-shard job passes) is never re-sharded, only default discovery is.
Practical effect: "the full suite passes locally" and "CI is green" are now
the same claim, checked the same way, instead of two configurations that
can silently drift apart as the suite grows — which is exactly what
happened here. Raise `TEST_JOBS` or `SHARD_COUNT` only after checking your
own machine has the headroom, and re-running enough times to trust it.
(Exact current file count: `ls tests/test_*.py | wc -l` — deliberately not
hardcoded here, since it drifts as the suite grows, which is the whole
lesson of this section.)

If a specific file still feels slow, `time python3 tests/test_whatever.py`
it directly — the fake-store files should mostly run in the 2-6s range
each; anything past ~10s is worth a look before just letting it slide, and
a `page.goto()` in the file that reads/splices `index.html` by hand rather
than calling `build_page()` / `write_plain_index()` / `build_custom_page()`
is the first thing to check (see above). The relay-backed files
(`test_relay_*`, `test_board_sync_*`) are inherently a bit slower — a real
Node subprocess plus real WebSocket round trips per test — that overhead
is the cost of them being genuine, not fake-store, integration tests, and
isn't itself something to optimize away. What IS worth checking in a
relay-backed file: a `wait_for_timeout(N)` sitting right after a click that
kicks off a real round trip (starting a session, joining one, a team-board
push) and right before reading whatever that round trip produces — that's
a guess at how long the network will take, not a real wait. Prefer
`page.wait_for_selector(...)` on the element the round trip actually
produces (e.g. `.session-code` after `#startSessionBtn`, `.direct-row`
after joining) — it resolves the moment the real thing happens rather than
after a fixed guess, which is both faster in the common case and immune to
exactly the CPU-contention flake above. This isn't free to apply
everywhere blindly, though: it only works where the test already knows a
specific selector that appears if and only if the awaited work finished —
a `wait_for_timeout` guarding something with no such signal (a write with
no visible DOM effect, a UI settle after several independent listeners
each fire) is doing real work and should stay as it is rather than being
converted just to remove a sleep.

Before adding a new Playwright test, check whether what it would prove is
already fully covered by a `tests/unit/*.js` test on the same underlying
pure function (see `docs/` and `tests/unit/README.md` — `helpers.js`'s
consolidation/scoring math and `csv.js`'s column-matching/import-plan
logic are the two richest examples). A Playwright test earns its slower,
real-browser cost by covering something a unit test structurally can't:
real DOM rendering/interaction, `localStorage`, a real WebSocket, or
`crypto.subtle`. A scenario whose ONLY assertions re-check already
unit-tested logic through a preview pane, with nothing applied or
rendered beyond that, is a case for trimming it (see
`test_csv_import_column_matching.py`'s history for a worked example: its
"renamed headers, positional-fallback" scenario was removed once
`tests/unit/test_csv.js` was confirmed to cover that exact logic, since
the file's other two scenarios already proved the same preview-rendering
pipeline works).

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
| `test_template_switching_and_csv_import.py` | Switching templates preserves each one's own dimension set and squad ratings underneath; a basic CSV import |
| `test_hebrew_rtl_coverage.py` | Real Hebrew content resolves `dir="auto"` to actual rtl (not just the attribute's presence) across every such surface in the app -- admin's dimension manager and squad list, Squad view, the rating modal, Tribe view's grid/legend/tooltip/hotspots, Templates, and the retro facilitator/join flow -- each paired with an English control; a Dimension-Key-based CSV re-import after a dimension's Hebrew label is edited again |
| `test_admin_language_switch.py` | Multi-language support Story 1 (`i18n.js`): the Admin panel's language switcher renders Hebrew (static markup via `[data-i18n]`/`[data-i18n-placeholder]`, plus JS-built strings like the squad list's aria-labels and confirm dialogs, all via `t()`), scopes `dir="rtl"` to `#viewAdmin` only (the rest of the still-English app stays untouched), and persists the choice across reload via `localStorage` |
| `test_main_screen_language.py` | Multi-language support Story 4: Tribe view, Squad view, and the shared rating modal as i18n-supported screens -- translated chrome, `dir="rtl"` scoped to `#viewTribe`/`#viewSquad`/`#backdrop` (not the document root, and not the still-English retro session card embedded inside `#viewSquad`, which opts out with its own `dir="ltr"`), template-sourced dimension content staying English on purpose, and `t()`'s bidi-isolate marks keeping composite Hebrew+English/number strings in the correct visual order |
| `test_csv_import_column_matching.py` | CSV export/import round-tripping through renamed headers, reordered columns, and a template-mismatch warning |
| `test_tooltip_busy_overlay_and_csv_key.py` | Grid header hover/focus tooltip; the busy overlay during template switches and CSV import; the CSV "Dimension Key" column surviving a dimension rename |
| `test_view_navigation_and_squad_admin.py` | Tribe view's read-only grid; Squad view rating and its "hotspots" panel; Admin squad CRUD; view/squad selection persisting across reload |
| `test_scored_template_five_dysfunctions.py` | Loading the Five Dysfunctions starter template (statements/scoreBands/strategies) and reloading it idempotently |
| `test_scored_template_tuckman.py` | The Tuckman starter template end to end: 20 interleaved statements, source-assessment scoring bands (not a health judgment) |
| `test_retro_join_flow.py` | Starting/closing a retro session; sharing by code, link, or QR; joining by each path; bad/expired code or link; the join screen's own diagnostics disclosure (its only way to show what happened, since it has no nav back to Admin's) |
| `test_retro_statement_survey_submission.py` | A teammate's full statement-based survey submission across every dimension, personal results, facilitator live view |
| `test_retro_direct_rating_flow.py` | The same submission flow for a direct-rating (non-statement) template |
| `test_retro_reveal_mode_and_consolidation.py` | The hold/live reveal toggle, majority consolidation, and calmer-bucket tie-breaking |
| `test_retro_override_and_response_table.py` | Facilitator override of a consolidated result, resetting it, and the per-response anonymized table |
| `test_retro_experiment_note_and_finish.py` | The shared sprint-experiment note; finishing a retro writes results into the squad, or no-ops with nothing submitted |
| `test_tribe_hotspots.py` | Tribe view's cross-squad hotspot rollup and ranking (`renderHotspots`/`renderStats`) |
| `test_local_store.py` | `public/local-store.js` itself — seeding, reload persistence, cross-tab sync, real CSV download, non-interference with a real `window.claude` |
| `test_relay_cross_device_sync.py` | The real relay end to end: starts `relay/server.js` as a subprocess and drives two independent browser contexts (facilitator + participant) through a full retro over a real encrypted WebSocket connection, plus a third late-joiner confirming a just-closed session reads as "ended" (not the generic "isn't open"), and a fourth joining a code that never existed at all confirming that one still gets the generic message |
| `test_starter_template_spotify.py` | The Spotify Squad Health Check starter template — listed, loadable, and reloadable after switching away, same as the other two starters |
| `test_view_switch_refreshes_stale_state.py` | A db snapshot that arrives while a view (Tribe/Squad/Admin) is hidden updates `state` but not that view's DOM, since every listener gates its own render on the currently-visible view (see `db.js`) -- switching back must show current state, not whatever was last rendered before you left |
| `test_relay_error_handling.py` | What happens when the relay is unavailable: no relay configured fails fast with no network attempt at all (not a doomed `ws://localhost` guess triggering a private-network permission prompt), a malformed URL scheme (e.g. a `wss://` typo) fails the same clean way instead of an uncaught `SyntaxError`, a configured-but-unreachable relay retries with bounded backoff instead of forever, a rapid multi-click on "Start retro session" only ever creates one session, the diagnostic log survives an in-progress text selection, and the join screen's "can't connect" message is distinct from "isn't open" |
| `test_relay_config_injection.py` | `scripts/generate-relay-config.js` (the Vercel build step that wires a deployed relay's URL in via the `SQUAD_PULSE_RELAY_URL` environment variable): writes a real assignment when the variable is set, leaves a no-op placeholder when it isn't, and — driven through `index.html`'s actual script order — an injected value really does win over the page's own protocol/hostname default |
| `test_relay_board_path_sync.py` | Step 2 of STATUS.md's "Board sync" plan: `relay-client.js`/`local-store.js` correctly route a `boards/<roomId>`-rooted path to the real relay (same as `sessions/*`), two independent browser contexts exchange a real encrypted document under one, an unwritten board path reads back as not-found rather than crashing, `sessions/*` behavior is completely unaffected, and (added with the security fix) `doc()`'s optional `secret` argument really does decouple the encryption key from the routing id — same room id, wrong secret, decryption fails rather than falling back to the path-derived key |
| `test_board_sync_opt_in_push.py` | Step 3 of STATUS.md's "Board sync" plan (rewritten for the link/QR security fix): the real Admin-view "Team sync" UI, end to end — a device with no team link never touches the relay for its board, creating one and then making an ordinary change (adding a squad) pushes a real encrypted full-board snapshot a second device can read directly off the relay (using the secret parsed from that same link), a wrong/guessed secret can't read it, and disconnecting genuinely stops further pushes |
| `test_board_sync_hydrate_on_boot.py` | Step 4 of STATUS.md's "Board sync" plan (rewritten for the link/QR security fix): hydrate-on-load, both directions — a device booting by opening another device's team link pulls its already-pushed board with no click beyond following the link, then after IT makes its own change, the FIRST device's next reload pulls that newer state back — proving last-write-wins-by-timestamp genuinely round-trips, not just "second device catches up once" |
| `test_board_sync_live_subscribe.py` | Step 5 of STATUS.md's "Board sync" plan (rewritten for the link/QR security fix): live subscribe — two devices that opened the same team link AT THE SAME TIME converge on a squad add in BOTH directions with no reload at all (unlike step 4, which needed one), and disconnecting stops live updates too, not just outgoing pushes |
| `test_board_sync_finish_retro_convergence.py` | Step 6 of STATUS.md's "Board sync" plan: the original bug report's exact repro, fixed — two team-synced devices each facilitate a different squad's retro; both end up seeing BOTH squads' real, finished results, live, over the shared team board. Rainy day: a third device that never connected to the team link is confirmed unaffected |
| `test_board_sync_default_on.py` | Step 7 of STATUS.md's "Board sync" plan: default-on — a fresh device's Admin view shows a ready-to-share team link/QR immediately at first boot, no "Create" click needed, and two never-configured devices land on two different (random) teams, not the same one by accident. Rainy day: an explicit "stop syncing" survives a reload with no silent re-enable, and opening a real team link still correctly switches a device onto that team |
| `test_retro_join_exit_and_return.py` | Story 9: a participant can leave the join screen for the normal board and come back to exactly where they left off — happy path (submit, exit, return shows the same personal results, not a re-shown survey), plus two rainy-day cases (exiting mid-survey preserves the in-progress draft; a device that never joined anything never shows the "back to my retro" control) |
| `test_cofacilitator_join.py` | Story 10: a co-facilitator joins an already-open session by code, link, or QR and gets the FULL facilitator view (live tally, override, finish) instead of the participant survey — a three-device scenario (originating facilitator + a participant who answers + a co-facilitator who never started the session) proves the co-facilitator's finish reaches the originating device too, live, via team sync. Rainy day: a wrong/nonexistent code shows a clear error, not a crash |
| `test_encryption_no_plaintext_on_wire.py` | Story 11: captures every real WebSocket frame a browser sends/receives (not just API-level decrypt success/failure) while renaming a squad and saving a sprint-experiment note to distinctive, unmistakable strings, for both a team board and a retro session, and proves neither ever appears as plaintext in a raw frame — only base64 ciphertext, with a sanity check that the capture really did see encrypted `ct` fields |
| `test_retro_join_link_carries_team_sync.py` | Real bug report fix: a retro session's join link (`joinUrlFor()`) now carries the facilitator's own team secret, not just the session code, so a device that opens ONLY that link (never the separate team link) still ends up team-synced with the facilitator — proves a real board change reaches both directions between a facilitator and a device that only ever used the join link, with the specific squad's retro still joinable normally. Rainy day: a facilitator who explicitly stopped syncing produces a plain, session-only link, and a device opening it keeps its own separate default team rather than being forced onto one |
