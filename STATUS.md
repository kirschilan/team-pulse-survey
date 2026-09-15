# Squad Pulse — Status

One-page entry point for picking this project up cold. Update the session log at the bottom
whenever you finish a chunk of work — this is the one place "what's outstanding" lives; the other
docs in `docs/` are reference material this file points to, not duplicates of it.

Before calling any change done, check it against **`docs/DefinitionOfDone.md`** — the standing
quality bar (testing, multi-language support, delivery workflow) that applies regardless of which
feature or story a change belongs to. This file's own "Decisions locked in" below is a different
thing: specific architecture/product choices already made, not the bar every change clears.

## What's real right now

- `public/` is a working static site — `index.html` + `styles.css` + `vendor/qrcode.js` +
  `local-store.js` + `app.js` + thirteen feature modules under `public/js/` (see "The app's file
  layout" below). Originally ported verbatim from the Claude Artifact prototype
  (`squad-pulse.html`) as one 2396-line `app.js`, then split by feature on 2026-09-11 (and
  `retro.js` split again, into its facilitator/participant halves, on 2026-09-12) with zero
  intended behavior change either time. No build step; open `public/index.html` directly or serve `public/`
  with any static file server.
- Full feature set works standalone in one browser tab: squad ratings across a customizable
  dimension template, Tribe-view cross-squad rollup, and the facilitated live-retro flow (join by
  code/QR, blind statement survey or direct green/yellow/red pick depending on the dimension,
  live or held reveal, facilitator override, finish-and-apply into the squad's real ratings).
- Two-tier regression coverage under `tests/`, all passing as of the last run (2026-09-13) — see
  `tests/README.md`. **`tests/unit/`**: 3 plain-Node files (`node:test`, nothing to install) for
  pure logic with no DOM dependency — consolidation/scoring math, CSV parsing/column-matching —
  running in ~0.1s total (see `tests/unit/README.md`). **`tests/test_*.py`**: one Playwright file
  per feature/flow (`ls tests/test_*.py | wc -l` for the current count — deliberately not
  hardcoded here) for everything that needs a real browser, run via `tests/run_all.sh`'s parallel
  workers after three 2026-09-12/13 perf passes (see the session log below) — zero JS errors on the
  last run. Most drive the app through a fake in-memory store (`tests/fixtures/fake_store.html`
  + `tests/fixtures/build_page.py`) standing in for the real backend, for speed and determinism; a
  handful deliberately bypass it because they exist specifically to test what it stands in for —
  `test_local_store.py` (the real `localStorage` board), `test_relay_cross_device_sync.py` (the real
  relay, WebSocket, and encryption, together), and `test_relay_error_handling.py` (the relay's
  failure modes). Both tiers run automatically on every push/PR via `.github/workflows/tests.yml`.
- `vercel.json` is in place for zero-config static hosting (`outputDirectory: "public"`), and the
  repo **is now connected to Vercel** — feature branches deploy to preview URLs (confirmed
  2026-09-12 via real testing on one). The relay is not part of that deployment and isn't deployed
  anywhere yet (see the relay bullet below and `relay/README.md`) — a preview/production Vercel
  deployment with no relay configured is expected to run the board fully, with live retro sessions
  correctly reporting themselves unavailable rather than hanging (see "Deliberately not built yet").
- **Retro sessions now sync across real devices.** `relay/` is a small standalone Node/`ws`
  WebSocket server; `public/js/relay-client.js` + `public/js/crypto.js` route every
  `sessions`-rooted `db` call to it (encrypted, per the decision below) instead of `localStorage`,
  while squads/dimensions/templates/config stay local as before. Verified end to end — real relay
  process, two independent browser contexts, real WebSocket, real AES-GCM — by
  `tests/test_relay_cross_device_sync.py`. Not yet deployed anywhere public; see `relay/README.md`.

## The app's file layout

`public/app.js` used to be one 2396-line file (a single IIFE, ported verbatim from the Claude
Artifact prototype). It's now a thin entry point — view-switch wiring, the one cross-cutting
Escape-key handler, and `start()`/boot — and the actual feature code lives in `public/js/`, split
along the seams the original file already had (`// ---------- section ----------` comments):

| File | Covers |
|---|---|
| `state.js` | Shared `state` object, starter templates, placeholder squads/dimensions, initial UI-prefs load (including `ui.locale`). Loads first. |
| `locales/en.js`, `locales/he.js` | Multi-language support: the English source-of-truth string table and its Hebrew translation (plain `key: "text"` objects, no build step -- see `he.js`'s own header comment on how a human corrects a translation). Loads right after `state.js`, before anything that calls `t()`. |
| `i18n.js` | `t(key, vars)`/`setLocale()` -- looks up the active locale (falling back to English for any missing key), interpolates `{word}` tokens, applies `[data-i18n]`/`[data-i18n-placeholder]` markup, and scopes `dir`/`lang` to `#viewAdmin` only (Story 1: Admin panel translated, the rest of the app not yet). |
| `helpers.js` | Pure helpers used everywhere: `esc`, `diag`, banding/consolidation math, `colorWord`/`trendWord`, `isStatementDimension`, `sortedSquads`/`sortedDimensions`, `findSquad`, unit-label helpers, and the `liveOr`/`syncLiveIfConnected` write-shape helpers every mutator uses. |
| `render.js` | `renderAll` and everything it drives — header/stats/ranking/hotspots/grid/legend, grid tooltip. |
| `modals.js` | The generic confirm modal, the cell-rating modal, and the busy overlay — shared widgets several features reuse. |
| `squads.js` | Squad CRUD, Admin's squad list, Squad view, and the `persistDimensionRating(s)` writer. |
| `retro-facilitator.js` | The FACILITATOR half of retro sessions: start/close, the session card, reveal-mode/override + sprint note, finish-and-apply, the live response tally, QR rendering. Split out from a single `retro.js` on 2026-09-12 — see the session log below. |
| `retro-join.js` | The PARTICIPANT half: the join screen, the blind interleaved statement survey, direct-rating swatches, submission, and the personal-result view. Shares almost no code with `retro-facilitator.js` (different device, different role) — that's what made the split clean. |
| `dimensions.js` | The dimension manager (add/rename/reorder/remove). Split out of a combined `dimensions-templates.js` on 2026-09-12. |
| `templates.js` | Template save/load/delete. Split out of the same combined file, same day. |
| `csv.js` | CSV export and import (parsing, column matching, preview, apply). |
| `db.js` | `initDb()` — the Firestore-shaped snapshot listeners that wire `db` writes into `state` and back into a render. |
| `crypto.js` | AES-256-GCM encrypt/decrypt. For a retro session, the key derives from the session code itself; for a team board, `generateSecret()`/`roomIdFor()` split a high-entropy secret (the key) from a separate one-way-derived room id (routing only) — see "Board sync" below. |
| `relay-client.js` | The other half of `local-store.js`'s router: a `collection()`/`doc()` implementation for `sessions`- and `boards`-rooted paths, backed by a real WebSocket to `relay/server.js` instead of `localStorage`. `doc(path, secret)`/`collection(path, secret)` take an optional second argument so a caller (board-sync.js) can supply the encryption key separately from the path's own routing id; omitted, behavior is unchanged (the path's own code IS the key, as sessions have always used). |
| `board-sync.js` | The opt-in team-sync setting (Admin view): a device either creates a high-entropy team link or joins one via a link/QR, then stays in sync live with every other device on the same link. See "Board sync (major change, in progress)" below. |

**These are plain classic `<script>` files sharing the global scope, not ES modules** — Chromium
blocks cross-file `import` over `file://` with a CORS error, which would break both the Playwright
suite (every test navigates via `file://`) and the README's "open `index.html` directly" workflow.
`index.html` loads them in the order above, then `app.js` last; load order only matters for the
handful of top-level `document.getElementById(...)` lookups each file does for elements that are
already in the DOM by the time these scripts run (they sit at the end of `<body>`) — every actual
cross-file *call* happens inside a function body triggered later (an event handler, or `start()`),
by which point every file has finished loading, so the specific order between the thirteen files
doesn't otherwise matter.

## The one thing to know before touching the app

`public/js/db.js`'s `initDb()` persists everything through a single call:

```js
window.claude.use("db")
```

That's a Claude-Artifact-only API — it doesn't exist outside a Claude Artifact sandbox.
`public/local-store.js` (loaded before every `js/*.js` file) now provides a same-shaped replacement
for plain deployments, and it's a small **router**, not one flat store: for any path rooted at
`"sessions"`, it delegates to `SquadPulseRelay` (`public/js/relay-client.js`), which speaks the
same `collection()`/`doc()` shape but syncs over a real WebSocket to `relay/server.js`, encrypting
every document with `public/js/crypto.js` before it leaves the browser. Everything else (squads,
dimensions, templates, `meta/config`) still goes to this browser's own `localStorage`, unchanged.
`window.claude.use("downloads")` still triggers a real browser file download. The whole shim only
installs itself when no real `window.claude` is already present, so it's a no-op both inside a
Claude Artifact and inside the Playwright test harness (`tests/fixtures/fake_store.html` sets its
own `window.claude` and loads after this file — see `build_page.py`). **Retro sessions, and now the
whole board too, genuinely sync across different devices/browsers** through the relay — see the new
bullet above, `relay/README.md`, and "Board sync" below. `localStorage` is still each device's own
source of truth (nothing here changes that), but by default it now also stays in sync, live, with
every other device on the same team link.
(There's one other `window.claude.use(...)` call, for `"downloads"` in `public/js/csv.js`, and a
`window.claude.hot` hot-reload guard at the bottom of `app.js` that already degrades safely with no
`window.claude` present — neither of those blocks anything.)

## Decisions locked in (don't re-litigate these)

- **No persistent, multi-tenant database, ever — reversed, as of 2026-09-13 (default-on).** This
  was the original decision (a facilitator's own browser as the board's sole source of truth), but
  it was the direct cause of a real bug: two devices independently seed identical squad IDs, so
  per-device `localStorage` boards never actually agreed once more than one device was involved in
  a retro. The replacement — **see "Board sync" below, now DONE** — keeps the relay content-blind
  (server never sees plaintext, unchanged) but makes it a durable, encrypted key-value store for the
  whole board, not just live session traffic, and every device now uses it by default: a fresh
  device auto-generates its own team link at first boot, ready to share immediately. Rolled out as a
  sequence of small, independently-tested increments — see "Board sync" below for the full history.
- **Only a live retro session touches a server**, and only for that session's lifetime — an
  ephemeral, in-memory, per-session-code relay (dimensions snapshot + responses + status/
  revealMode/overrides/experimentNote), forgotten once the room empties. No database.
- **Self-hosted relay + client-side encryption**, chosen deliberately over Firebase/Supabase.
  Built 2026-09-11 — see `relay/` and `public/js/crypto.js`/`relay-client.js`. One deviation from
  the original sketch, made deliberately: the encryption key is **derived from the session code
  itself** (`SHA-256(code)`), not an independent random secret in a URL fragment. The reason is the
  app's *primary* join path is typing the 6-character code by hand (the fix for a real iPhone
  QR-handoff bug already in this codebase) — a path with no fragment to carry a separate key.
  Deriving the key from the code keeps both join paths working. Be honest about what this does and
  doesn't buy: real protection against passive network eavesdropping and against answers sitting in
  plaintext in relay logs/memory/backups — but NOT protection against a relay operator who
  deliberately computes the same public hash, since the code and the room id are the same value.
  Full rationale and the researched Excalidraw/Vercel architecture this is based on:
  `docs/standalone-plan.md`. **This code-is-the-key tradeoff is scoped to retro sessions
  specifically** (app-generated random code, forgotten within minutes) — a team board's link-based
  secret is deliberately NOT this model; see "Board sync"'s "Security fix" for why a persistent,
  user-chosen team code would have been the wrong tradeoff there.
- **The relay is a plain standalone Node process, deployed as a genuinely separate small service —
  deliberately NOT a Vercel Function**, even though Vercel Functions gained native WebSocket support
  in 2026. Verified against Vercel's own docs before deciding: a new connection there isn't
  guaranteed to land on the same Function instance as an existing one, so Vercel's own guidance for
  shared cross-connection state (rooms, presence, pub/sub — this relay's whole job) is to add Redis.
  Rejected because this project has two audiences that both lose from that: embedding on a company
  website, and forking the repo to self-host entirely offline on a LAN to route around a company's
  own security constraints — the latter shouldn't need to provision a database just to run one
  WebSocket relay. `render.yaml` at the repo root makes deploying the unmodified Node process to
  Render close to one-click; the exact same process also runs via `npm start` on a LAN with no cloud
  account at all. Full writeup and the doc-verified reasoning: `relay/README.md`'s "Why not a Vercel
  Function" and `docs/standalone-plan.md`'s "Where this runs".
- **Retro-session feature behavior** (consolidation rule, anonymity model, per-template scoring)
  is specified and versioned in `docs/facilitated-retro-spec.md` — that file has its own session
  log for that feature's history; don't duplicate it here.
- **"This retro has ended" vs. "this retro isn't open" is a real distinction, but only within the
  relay's own room lifetime — not indefinitely.** `closeSession()` writes `status:"closed"` instead
  of deleting the doc, so the join screen can say "ended" for as long as that doc still exists (the
  relay's own room-empty grace period, or longer if someone's still connected). Once the relay has
  genuinely forgotten a room (garbage-collected, or the process restarted), a closed-long-ago code
  and a code that never existed are the same thing again — there is no way to keep that distinction
  forever without adding real persistence, which is exactly the trade-off already rejected for the
  relay itself (see the Vercel Function decision above). This is the deliberate stopping point.

## Board sync (major change, DONE — default-on as of 2026-09-13)

Replacing the "no persistent database, ever" decision above with a model the user specified
directly, after independently verifying Excalidraw's real architecture (a content-blind relay for
live propagation + Firebase for durable storage): the relay becomes a **durable, encrypted
key-value store for the whole board** — still unable to read any of it (same AES-256-GCM,
code-derived-key encryption as retro sessions, just extended past `sessions/*`) — instead of only
ever holding transient session traffic. This also folds in the "co-facilitator finish retro"
open question above: once a board is synced, "finish retro" becomes a write into the shared board
doc, so it doesn't matter which device facilitated.

Rolled out as increments, each independently tested and safe to ship to `main` even before the
whole thing is done — no increment changes default behavior until an explicit opt-in (a team code)
is set on a device:

1. **DONE (2026-09-12).** Relay-side durable storage, behind a documented adapter interface
   (`relay/storage/`: `load`/`save`/`remove`). Default adapter (`none-adapter.js`) reproduces the
   relay's exact original behavior — nothing persists; `file-adapter.js` is the reference "real"
   adapter (one JSON file per room, keyed by a hash of the room code, so a restart or redeploy
   doesn't lose an in-progress session). Opt-in via `RELAY_STORAGE=file`. Zero app-facing change —
   wire protocol, `relay-client.js`, and every existing test are untouched; new coverage in
   `relay/test/storage.test.js` proves both adapters and that a restart with `FileAdapter` really
   does survive while the default doesn't. The adapter shape itself is what answers requirement (0)
   from the user's brief: swapping Render for another host, or forking this repo onto infra with
   its own storage of choice, means writing one small adapter file, not touching `server.js`.
2. **DONE (2026-09-12).** `relay-client.js` now recognizes `boards/<teamCode>` paths alongside
   `sessions/<code>` (`isBoardPath`), and `local-store.js`'s router sends either to the relay —
   purely additive, since the relay itself never inspected path meaning to begin with (it
   multiplexes by whatever room code opened the WebSocket connection, so no server.js change was
   needed at all). No UI caller exists yet. New `tests/test_relay_board_path_sync.py` proves the
   plumbing end to end at the level below any UI: two independent browser contexts exchange a real
   encrypted document under a `boards/...` path over the real relay, an unwritten board path reads
   back as not-found rather than crashing, and `sessions/*` behavior is completely unaffected.
3. **DONE (2026-09-12), mechanism since replaced — see "Security fix" below.** Opt-in "team code" setting (Admin view → new "Team sync (beta)" card,
   `public/js/board-sync.js`): connecting pushes an encrypted full-board snapshot (squads,
   dimensions, config) to `boards/<teamCode>` on the relay, and every subsequent squad/dimension/
   config save pushes again — hooked into `db.js`'s three existing `onSnapshot` listeners
   (squads/dimensions/`meta/config`), which already fire on any board mutation regardless of which
   file caused it, so nothing else had to change. One-way only: nothing reads a team code's board
   back yet (that's step 4). Default (no team code set) is completely unaffected —
   `pushBoardSnapshotIfConnected()` no-ops immediately. New `tests/test_board_sync_opt_in_push.py`
   drives the real Admin UI (not just the plumbing) end to end against the real relay: no code set
   never touches the relay, connecting + adding a squad produces a real decryptable snapshot a
   second device can read directly off the relay, and disconnecting genuinely stops further pushes.
   `tests/unit/test_board_sync.js` covers `normalizeTeamCode()`'s input handling.
4. **DONE (2026-09-12), updated for the link-based secret — see "Security fix" below.** Hydrate-on-load: `board-sync.js`'s `hydrateFromTeamIfConnected()`
   runs once at boot (`db.js`'s `initDb()`), before the squads/dimensions/config listeners
   register, and again right after a fresh "Connect" — if the relay's copy of `boards/<teamCode>`
   is newer (by the payload's own `updatedAt`, tracked per-code via `getSyncedAt`/`setSyncedAt`)
   than what this device already knows about, it rewrites local squads/dimensions/`meta/config` to
   match, add-or-update plus remove-what's-gone. A `hydrating` flag suppresses
   `pushBoardSnapshotIfConnected()` while that rewrite is in flight, so the relay only ever sees the
   pre- or fully-post-hydrate board, never an intermediate one. New
   `tests/test_board_sync_hydrate_on_boot.py` proves the full round trip over the real relay in
   BOTH directions: a device booting with a team code already set pulls another device's
   already-pushed board with zero clicks, then after that second device makes its own change, the
   first device's next reload pulls the newer state back too.
5. **DONE (2026-09-12), updated for the link-based secret — see "Security fix" below.** Live subscribe: `board-sync.js`'s `subscribeToTeamBoardIfConnected()`
   keeps a team's relay connection open (same one-persistent-WebSocket-per-room-id
   machinery retro sessions already use) and reacts to every future update via the shared
   `maybeApplyRemote()` guard, rather than only checking once at boot. Started right after the
   boot-time hydrate and right after a fresh "Connect"; stopped on "Disconnect"
   (`stopTeamBoardSubscription()`). New `tests/test_board_sync_live_subscribe.py` proves two
   devices connected to the same team code AT THE SAME TIME converge on a squad add in BOTH
   directions with zero reloads (unlike step 4, which needed one), and that disconnecting stops
   live updates too, not just outgoing pushes.
6. **DONE (2026-09-12).** Wire "finish retro" through the shared board doc. Turned out to need very
   little NEW plumbing — "Finish & apply" already writes into the local `squads/<id>` doc
   (`squads.js`'s `persistDimensionRatings`), and that path was already covered by steps 3/5's
   push/subscribe machinery, since `db.js`'s squads listener doesn't care WHY a squad doc changed.
   Written test-first (this repo's new `tdd` skill, test-flighted for the first time on this story):
   the very first end-to-end run of the real cross-device scenario surfaced a genuine, separate bug
   — `board-sync.js`'s `applyRemoteBoardSnapshot()` wrote a remote squad's `dimensions` object
   (frozen, per `deepFreezeClone()`) straight into a local doc; the next `persistDimensionRatings()`
   call on that squad threw ("object is not extensible") trying to add a new dimension key to it.
   Fixed with a `plainClone()` helper (JSON round-trip) applied to every frozen nested value a
   remote snapshot hands over before it's written locally — `dimensions`, `statements`,
   `scoreBands`, `strategies`. `tests/test_board_sync_finish_retro_convergence.py` proves the
   original bug report's exact repro shape now converges: two devices, each facilitating a
   different squad's retro, both end up seeing BOTH squads' real results, live; a third,
   never-team-synced device (the rainy-day case) is confirmed unaffected. Also surfaced, directly
   while writing this test, exactly why story 9 (participant exit/return) is real and not
   cosmetic: a joined participant has no in-app way back to the main board, so the test itself had
   to simulate what a real user does today (navigate back to the plain URL) to even get there.
7. **DONE (2026-09-13).** Promote from opt-in to default-on: a fresh device that has never touched
   team sync now auto-generates its own random secret at first boot (`board-sync.js`'s
   `ensureDefaultTeamSecret()`) and shows the link/QR/copy immediately — no "Create" click needed —
   while a `TEAM_SYNC_EVER_INITIALIZED_KEY` flag (set the moment ANY secret is ever stored, by
   whichever path) lets a device that explicitly disconnected stay disconnected forever, rather than
   silently regenerating a secret on its next reload. Two never-configured devices get two different
   random secrets (each device runs its own `generateSecret()`), so they never accidentally land on
   the same team; opening someone else's real team link still correctly switches a device onto their
   team, same as before. Admin's "Team sync (beta)" card lost the "(beta)" and its Not-Connected
   state (now the rare case, not the default).

   Turning this on by default — every device now actually exercises the full hydrate/push/subscribe
   machinery on every single boot, not just an opted-in device once in a while — surfaced a run of
   real concurrency bugs that opt-in had been quietly hiding, each found the same way: run the full
   suite, watch something that used to pass fail, add targeted `diag()` tracing, fix the actual root
   cause instead of the symptom. In order:
   - **A blocking `await`.** `db.js`'s `initDb()` used to `await hydrateFromTeamIfConnected()` before
     registering the squads/dimensions/config listeners — harmless when hydrate only ran for a
     device that had just deliberately opted in (rare), fatal once every device does it on every
     boot: an unreachable relay's exponential-backoff give-up (`relay-client.js`'s
     `MAX_RECONNECT_ATTEMPTS`) can take 20+ seconds, during which the entire rest of the board was
     blocked from loading. Fixed by no longer awaiting it — local data flashes in first, live data
     settles in later if/when hydrate resolves, the same pattern the rest of the app already uses.
   - **A partial-board push race.** Squads, dimensions, and config are three independent `db.js`
     listeners firing on independent schedules; `pushBoardSnapshotIfConnected()` could fire from
     real squads paired with still-placeholder dimensions (or vice versa) if it ran before all three
     had reported in even once. Fixed with `isLocalBoardReady()`/`markLocalBoardPieceReady()`, one
     flag per piece, gating every push until all three are real.
   - **A timestamp-capture-order bug.** `pushBoardSnapshotIfConnected()` used to stamp
     `updatedAt` only after the async `roomIdFor()` resolved — but concurrent `crypto.subtle.digest()`
     calls aren't guaranteed to resolve in the order they started, so a later push could occasionally
     get an earlier timestamp than one that started before it, silently breaking last-write-wins for
     whoever read it back. Fixed by capturing the payload (and its timestamp) synchronously, before
     the async call.
   - **`maybeApplyRemote()` reentrancy.** The boot-time hydrate's one-shot fetch and the live
     subscription's own first callback both key off the same `room.ready` promise and can resolve
     concurrently; a live update can also arrive while an earlier apply's own `Promise.all(ops)` is
     still mid-flight. Two overlapping applies interleaving their writes meant whichever finished
     LAST won, regardless of which one actually held the newer data. Fixed with `pendingRemoteApply`,
     a single-slot queue that serializes applies (run the newest pending one right after the current
     one finishes) — a lightweight stand-in for a real per-room mutex.
   - **A genesis-push race.** A device joining an EXISTING team reaches "my local board is fully
     loaded" (the fix above) before its own hydrate's relay round trip necessarily finishes — so it
     could push its own stale, pre-hydrate local board, racing (and sometimes beating, purely on
     timestamp) a teammate's real concurrent edit. Fixed with `hydrateAttemptedForSecret`, which
     blocks `pushBoardSnapshotIfConnected()` until this device has completed at least one hydrate
     ATTEMPT (success, not-found, or give-up all count) for its current secret — plus an explicit
     re-trigger of the push at the end of `hydrateFromTeamIfConnected()`, for the "hydrate found
     nothing, genuinely new team" case that would otherwise never get a second chance.
   - **A relay-client bug, found last, via `test_board_sync_finish_retro_convergence.py`'s own test
     regressing at a new point once the above were all fixed:** `relay-client.js`'s `getRoom()`
     unconditionally `rememberCode()`'d every room it ever connected to, for the broad, code-less
     `sessions` listener's reconnect-known-codes-on-boot logic (`subscribeBroadSessions`) — including
     a board's room id, which was never meant to be in that list. Once a device had ever joined a
     retro session (populating its knownCodes) and then reloaded, that broad listener's synchronous
     `loadKnownCodes().forEach(code => getRoom(code))` would create the board's room object FIRST, on
     the new page, with no secret — and since a room's encryption key is fixed by whichever call
     creates it first, board-sync.js's own later, correctly-secreted call just inherited that wrong
     key (derived from the room id itself instead of the real secret) for the rest of that page's
     life. The device could still round-trip with ITSELF (self-consistent wrong key) but could never
     again decrypt what a correctly-keyed teammate sent, or vice versa — silently, with no error
     surfaced anywhere, just a permanently stuck board. Fixed by only remembering a code when no
     secret was given (`if(!secret) rememberCode(code);`) — exactly the signal that distinguishes a
     plain session code from a board's secret-derived room id.
   - **A test-harness-only bug, found while chasing an unrelated suite of failures this story's
     default-on change newly exposed:** `tests/fixtures/fake_store.html` (the fast, deterministic
     stand-in for the local board backend that most Playwright tests drive) has no concept of
     routing some paths to a relay — every path, including a brand-new `boards/<roomId>`, was just
     another doc in the same shared in-memory map as squads/dimensions/config. With board sync
     default-on now reading and writing that path on every single boot, a delayed hydrate could read
     back a stale snapshot of the very board a test had just changed and silently overwrite it —
     intermittently breaking several template/dimension tests that have nothing to do with board
     sync at all. Fixed by routing `boards/` paths in the fake store to an always-inert doc (reads as
     not-found, writes reject as unavailable) — the same behavior a real deployment gets with no
     relay configured, which is the accurate simulation for a harness that never pretends to run one.

   All of the above were caught by re-running this repo's existing regression suite after each
   change, per the TDD skill's Step 5 — none were found by writing a new test first, since they're
   emergent timing bugs between existing, already-tested pieces rather than a missing behavior.
   `tests/test_board_sync_default_on.py` (new) proves the actual default-on claims directly: a fresh
   device's Admin view shows a ready-to-share link/QR immediately, two never-configured devices get
   different secrets, disconnecting and reloading stays disconnected (no silent re-enable), and
   opening a real team link still switches a device onto that team. Every other `test_board_sync_*`,
   `test_cofacilitator_join`, and `test_encryption_no_plaintext_on_wire` file needed a small update
   (mostly: stop clicking a "Create" button that no longer exists, since a link is already there at
   boot) but no behavior changes.

Story 9 (**DONE, 2026-09-12**): a participant's way to leave the retro join screen and return to
the main app and back to their own participation. `retro-join.js` gained `exitJoinScreen()`/
`returnToJoinScreen()` — a header "← Back to my retro" button and an on-screen "← Back to Squad
Pulse" button that ONLY toggle which section is visible; `state.joinSessionId` and
`listenJoinSession()`'s listener are never torn down, so the session keeps updating in the
background and returning always shows current state. `joinCodeBtn` stays hidden the whole time
(exited or not) so a participant can't accidentally start joining a second session while one's
still open. Written test-first: `tests/test_retro_join_exit_and_return.py` covers the happy path
(submit → exit → return shows the same personal results, not a re-shown survey) and two rainy-day
cases (exiting mid-survey, before submitting anything, preserves the in-progress draft rather than
resetting it; a device that never joined anything never shows the "back to my retro" button at
all). Passed on the very first real run once the buttons existed — no surprises this time, unlike
step 6's hydrate-freezing bug.

Story 10 (**DONE, 2026-09-12**): a co-facilitator join path via code/link. Turned out to need very
little new mechanism, same story as step 6: `openSessionForSquad()` never checked WHO started a
session, only whether `state.sessions` has a matching open one — and `state.sessions` is
reconstructed from whatever codes this device's relay-client.js has ever "remembered"
(`rememberCode()`), regardless of role. So `retro-facilitator.js`'s new
`coFacilitateSessionByCode(code)` just reads `sessions/<code>` once (enough to make `getRoom()`
remember the code and connect); the moment that snapshot arrives, the SAME broad `sessions`
listener every non-join-mode device already runs picks it up, and Squad view renders the identical
facilitator card (live tally, reveal, override, finish) a device that started the session sees —
no separate rendering path needed. Reachable two ways, both wired: a NEW "Co-facilitate" button in
the existing join-code modal (typed code), and a genuinely separate link/QR
(`?cofacilitate=<code>`, `coFacilitateUrlFor()`) shown on the session card next to the existing
participant join link — opening it boots the normal app (never join mode) and attaches
automatically. Written test-first: `tests/test_cofacilitator_join.py` proves the real three-device
shape (originating facilitator + a participant who answers + a co-facilitator who never started
the session) — the co-facilitator sees the live tally, finishes the retro, and that finish reaches
the ORIGINATING facilitator's device too, live, via team sync (story 6). Also checks the actual
link/QR (not just the typed code) and a device opening it directly. Rainy day: co-facilitating
with a wrong/nonexistent code shows a clear error, not a crash. Passed cleanly on the first real
run, both happy-path and rainy-day, once the wiring existed.

Story 11 (**DONE/VERIFIED, 2026-09-12**): as all users, we want our data encrypted so no one else
but we who have the link/code can see it. Already true by construction (retro sessions: code-
derived AES-256-GCM key, locked decision; boards: a separate high-entropy link/QR secret, see the
"Security fix" above) — every prior test proved it INDIRECTLY, by showing a wrong key fails to
decrypt. New `tests/test_encryption_no_plaintext_on_wire.py` proves the literal claim directly
instead: it captures every real WebSocket frame a browser sends/receives (Playwright's
`page.on("websocket")` + `framesent`/`framereceived`) while renaming a squad to a distinctive,
impossible-to-coincidentally-reproduce plaintext string and saving an equally distinctive
sprint-experiment note, for both a team board and a retro session, and asserts neither string EVER
appears in a raw frame — only base64 ciphertext (with a sanity check that the capture really did
see encrypted `ct` fields, so the assertion isn't vacuously passing over an empty capture). Passed
cleanly on the first run — no gap found, no new production code needed, just a real proof where
only an inference existed before.

### Security fix (2026-09-12): typed team codes replaced with a high-entropy link/QR secret

Steps 3–5 above originally let a device type a human-chosen "team code" (e.g. "MYSQUAD"), reusing
retro sessions' "the code IS the encryption key" model. Caught in review before this went anywhere
near real use: that tradeoff was made deliberately for retro sessions because the code there is
**app-generated, random, and forgotten within minutes** of the session ending. A team code is the
opposite on every axis — **user-chosen** (a dictionary word, not random), **long-lived by design**,
and — once step 1's durable storage is opted into — **actually persisted**. A short, guessable,
low-entropy code protecting a durable, ongoing, sensitive board is a real vulnerability: the relay
can't distinguish a legitimate join from a guess (it's deliberately content-blind), so entropy in
the code/key itself is the only real defense, and a typed team code had nowhere near enough of it.

Fixed by splitting the two roles Excalidraw's real architecture keeps separate (the same
verified-before-building research the whole "Board sync" direction is based on): a **high-entropy
secret** (128 random bits, `crypto.js`'s `generateSecret()`) is what the encryption key derives
from, and it's never typed or spoken — only ever shared as a link (`?team=<secret>`) or a QR code,
reusing the exact link/QR pattern retro sessions already use to join. The relay only ever sees a
**separate, one-way hash** of that secret (`roomIdFor()`, SHA-256 truncated to 64 bits) for
routing — knowing the room id buys an attacker nothing, since it can't run backward to the secret.
`relay-client.js`'s `doc()`/`collection()` gained an optional second `secret` argument so a caller
can supply the key separately from the path's own routing id; omitted (every session caller),
behavior is byte-for-byte unchanged — the path's own code is still the key, exactly as before.

`board-sync.js`'s UI changed to match: "Create a team link" (first device) generates the secret and
shows it as a link + QR + copy button; joining means opening that link (an inline
`autoConnectFromLink()` reads `?team=`, persists it, then strips it from the visible URL/history —
the same hygiene a magic-link auth flow uses) or pasting it into a "paste a team link" box. No code
is ever typed.

**A real second bug surfaced while testing this**, predating the security fix and latent the whole
time: `relay-client.js`'s `putDoc()` re-derived its encryption key from `room.code` on every write,
rather than reusing the key the room actually connected with. Harmless for sessions (where `code`
and the key material were always the same value), but for a board using a separate secret this
meant every board write was silently encrypted with the WRONG key — decryption on any receiving
client (including the sender's own live subscription) failed and was silently dropped (the existing
`.catch(){}` around decrypt treats a bad key indistinguishably from a corrupt envelope). Fixed by
storing the room's actual `keyPromise` on the room object at connect time and having `putDoc()`
reuse it instead of re-deriving. `tests/test_board_sync_opt_in_push.py` is what caught it (a
cross-device read came back `exists:false` for data that had definitely been pushed).

All three Playwright board-sync tests (`test_board_sync_opt_in_push.py`,
`test_board_sync_hydrate_on_boot.py`, `test_board_sync_live_subscribe.py`) were rewritten against
the new link-based UI, driving a real "second device opens the link" join for hydrate/live-subscribe
coverage rather than pre-seeding localStorage. `test_relay_board_path_sync.py` gained direct
coverage of the secret/routing-id split itself (same routing id, wrong secret → decryption fails,
not a fallback to the path-derived key — verified from a **fresh** browser context specifically,
since `relay-client.js` caches an opened room per page and a page that already opened a room with
the right secret would otherwise mask the check). `tests/unit/test_board_sync.js` now covers
`parseTeamSecretInput()`/`teamLinkFor()` instead of the retired `normalizeTeamCode()`. Full 25-file
Playwright + 38-test unit suite passing.

## Multi-language rollout backlog

The product owner is driving Hebrew/RTL support in one story at a time on this branch (see the
Session log's "Multi-language support, Story N" entries for what each one actually did). This table
is the persisted list — it previously only existed in conversation, which made "what's left" a
recall exercise instead of something anyone could just read.

| # | Story | Status |
|---|---|---|
| 1 | Hardened Hebrew/RTL test coverage (foundation, no user-visible change) | **DONE** (2026-09-13) |
| 2 | i18n infrastructure (`t()`, `setLocale()`, `locales/en.js`+`he.js`) + Admin panel translated | **DONE** (2026-09-13) |
| 3 | Formalized the Definition of Done (`docs/DefinitionOfDone.md`) | **DONE** (2026-09-13) |
| 4 | Tribe view, Squad view, and the shared rating modal's UI chrome translated | **DONE** (2026-09-13) |
| 5 | Spotify Squad Health Check template's dimension content (label/green/red/attribution) translated, live at render time | **DONE** (2026-09-13) |
| 6 | Application header/nav chrome: `h1` "Squad Pulse", the tagline, the model-name badge, "Live — synced across viewers", the "Join a retro" button, and the Tribe view/Squad view/Admin switcher — currently untranslated and not scoped to any prior story (flagged when reviewing a screenshot of it) | **DONE** (2026-09-13) |
| 7 | Tuckman's Team Development Stages template's dimension content translated | **DONE** (2026-09-13) |
| 8 | The Five Dysfunctions of a Team template's dimension content translated | **DONE** (2026-09-13) |
| 9 | Templates modal's own chrome (list labels, "Load"/"Delete" buttons, save-as-template form) — the template NAMES themselves (e.g. "Spotify Squad Health Check") stay English by design, same call already made for Story 5 | **DONE** (2026-09-13) |
| 10 | Retro join flow (participant-facing screens) | **DONE** (2026-09-14) |
| 11 | Retro facilitation flow (facilitator-facing screens, session cards, overrides) | **DONE** (2026-09-14) |
| 12 | Dimension detail and Edit Dimensions modal (Admin) | **DONE** (2026-09-14) |
| 13 | CSV import/export chrome — deliberately last: `csv.js`'s column-matching and re-import logic key off raw English labels, so this needs its own careful design pass, not just a translation pass | Not started |

## Deliberately not built yet (and why)

| Not built | Why it's cut for now | What would trigger building it |
|---|---|---|
| Relay deployed anywhere public | Built, tested, and now deploy-ready (`render.yaml` + `SQUAD_PULSE_RELAY_URL`-driven build step — see `relay/README.md`), but this session has no hosting/Vercel account access to actually click "deploy" | Whoever has account access runs the Render blueprint (or any equivalent host) and sets the Vercel env var — see `relay/README.md`'s "Wiring the deployed static site to this relay" for the exact steps, including testing it on a Preview deployment before merging to `main` |
| Save-board / Load-board-to-file | `local-store.js` already persists the board via `localStorage`, which covers the same browser/device | Once someone needs a board to move between browsers/devices without a relay |
| Relay deployed on Vercel itself (one deployment, not two) | Deliberately rejected, not just deferred — see the locked decision above and `relay/README.md`'s "Why not a Vercel Function" | Only if Vercel's WebSocket support later guarantees same-instance routing without an external store, which would remove the reason this was rejected |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |
| A third UI language (beyond English/Hebrew) | YAGNI, per the product owner's own call (2026-09-14) — `SUPPORTED_LOCALES`/`t()`'s fallback (i18n.js) are already written generically enough to add one without a redesign, and the bilingual-dimensions editor (see the session log) is a per-dimension `i18n` object keyed by locale code, not hardcoded to exactly two languages, so neither needs rework specifically to add a third | A real request for a specific third language — at that point, design its own toggle/picker UX (today's per-dimension editor hardcodes one Hebrew panel) rather than assuming the two-language shape generalizes without a look |

## Suggested next step

**Deploy the relay.** No code changes needed — the static site is already live on Vercel; the
relay just needs someone with a Render (or equivalent) account to run the `render.yaml`
blueprint at the repo root, then set `SQUAD_PULSE_RELAY_URL` in Vercel's project settings (scope
it to Preview first to test on this branch before merging to `main`, then Production). Full
steps: `relay/README.md`'s "Deploying it" and "Wiring the deployed static site to this relay".
This is the real unblock for testing cross-device retro sessions and board sync with a real team,
not just in this repo's own tests.

## Session log

- 2026-09-10 — Migrated the project from a single-file Claude Artifact (3077-line inline-script
  `squad-pulse.html`) into this repo as a clean static-site layout (`public/index.html` + `app.js`
  + `styles.css` + `vendor/qrcode.js`), with zero behavioral change. Ported and de-duplicated the
  full 13-file Playwright regression suite onto the new structure, introducing a shared
  `tests/fixtures/build_page.py` fixture (fixed a latent hidden dependency where tests v3–v13
  silently relied on `test_v2.py` having already generated a file on disk). All tests verified
  passing with zero JS errors. Pushed as commit `934f69b` on top of the repo's auto-generated
  initial commit.
- 2026-09-10 — Fixed a real bug in the retro-session feature (teammates couldn't answer the
  board's default Spotify Squad Health Check template in Retro mode — only the facilitator
  could). Full detail and fix description live in `docs/facilitated-retro-spec.md`, not
  duplicated here since it's feature-specific.
- 2026-09-11 — Added `public/local-store.js`: a localStorage-backed shim for the Firestore-shaped
  `db` capability and the `downloads` capability, so the app works outside a Claude Artifact
  sandbox (e.g. deployed on Vercel) instead of sitting in local-only preview mode with nothing
  persisted. Seeds a starter board (3 squads, the 12 Spotify Squad Health Check dimensions) on
  first run. Installs only when no real `window.claude` is present, so Claude Artifact previews
  and the Playwright test harness are unaffected — full regression suite verified passing with
  zero JS errors. Cross-device retro sync still needs the relay described above; this only covers
  the board itself plus same-browser multi-tab sync.
- 2026-09-11 — Hardened the regression suite ahead of refactoring `app.js`: renamed the 13
  `test_v2.py`..`test_v13.py`/`test_generic.py` files to names that describe what they cover (see
  `tests/README.md`'s naming table), added `test_tribe_hotspots.py` and `test_local_store.py` to
  close two real coverage gaps (Tribe view's cross-squad rollup, and `local-store.js` itself — both
  had zero tests), removed a sandbox-specific hardcoded browser path from all 15 files so the suite
  actually runs in CI, and added `.github/workflows/tests.yml` to run it on every push/PR.
- 2026-09-11 — Split `app.js` (2396 lines, one IIFE) into `app.js` (thin entry point) + nine feature
  modules under `public/js/` — see "The app's file layout" above for the map and for why they're
  plain classic scripts, not ES modules (Chromium blocks `import` over `file://`, which the test
  suite and the "open index.html directly" workflow both rely on). Zero intended behavior change;
  verified by the full 15-file regression suite passing with zero JS errors both before and after.
- 2026-09-11 — Built the relay: `relay/server.js` (Node + `ws`, tiny in-memory per-code room store,
  2-minute empty-room grace period), `public/js/crypto.js` (AES-256-GCM via Web Crypto, key derived
  from the session code — see the locked decision above for why and its honest limits), and
  `public/js/relay-client.js` (same `collection()`/`doc()` shape as `local-store.js`, so `db.js`
  needed zero changes). `local-store.js` now routes any `sessions`-rooted path to the relay client
  instead of `localStorage`. Two real bugs found and fixed along the way, both by actually testing
  against a live relay rather than trusting the design: (1) Chromium's ES-module CORS block over
  `file://` doesn't apply to WebSocket connections or `crypto.subtle` — verified both directly
  before relying on either; (2) the broad `db.collection("sessions").onSnapshot(...)` listener
  (used to notice a facilitator's own already-open session after reload) captured the "known
  codes" list once at subscribe time and never revisited it, so a session started *after* boot
  never appeared — fixed with a small pub/sub (`broadListeners` in relay-client.js) that any newly
  ‑discovered room notifies. Verified end to end by `tests/test_relay_cross_device_sync.py`: a real
  relay subprocess, two independent Playwright browser contexts (facilitator + participant) with
  their own localStorage, and a third late-joiner confirming a closed session is really gone —
  zero JS errors. Full existing 16-file suite re-verified passing with zero regressions. Not yet
  deployed anywhere public (see `relay/README.md` for how). Left open: co-facilitator "finish
  retro" ownership (see the not-built table above) — explicitly out of scope for this step.
- 2026-09-12 — Fixed five real bugs found by testing the deployed Vercel preview, none of them
  visible from local `file://` testing alone. Root cause of the big one: `index.html` defaulted
  `SQUAD_PULSE_RELAY_URL` to `ws://localhost:8787` unconditionally, so on a real deployment the
  page tried to reach a WebSocket on the *visitor's own machine* — Chrome's Private Network Access
  policy pops a permission prompt for that (an https:// page opening a loopback socket), nothing
  was ever listening there, and the old unbounded-retry loop then reconnected every 5s forever.
  Clicking "Start retro session" repeatedly (since nothing appeared to happen) spawned one orphaned
  room per click, which is why the diagnostic log showed nine different codes all reconnecting at
  once. Fixes: (1) `index.html` now only defaults to a local relay when the page itself is local
  (`file://`/`localhost`/`127.0.0.1`) — a real deployment with no override gets `null`; (2)
  `relay-client.js` fails fast with zero WebSocket attempts when no relay is configured, and gives
  up after 8 reconnect attempts (bounded backoff) instead of retrying forever when one is
  configured but unreachable, surfacing a real error via a new `unavailable` rejection on writes;
  (3) `retro.js`'s "Start retro session" button is now guarded by a module-level flag (not just its
  own `disabled` attribute, which a re-render can hand back fresh mid-request) so rapid/duplicate
  clicks can't spawn more than one session, and a failed start now opens a real error dialog
  instead of silently doing nothing; (4) `helpers.js`'s `diag()` no longer overwrites the log's
  `textContent` while the user has an in-progress selection inside it, so the diagnostic log can
  actually be selected and copied; (5) added the board's own default dimension set as a proper,
  reloadable starter template (`state.js`'s `SPOTIFY_TEMPLATE`, "Spotify Squad Health Check") —
  previously it only existed as seed data for a fresh board with no way to load it back after
  switching to Five Dysfunctions or Tuckman. All five verified directly (not just by inspection):
  the relay-URL defaulting logic as a pure function across all four input cases, the fail-fast and
  bounded-retry behavior via an isolated harness loading only `crypto.js`+`relay-client.js`
  (`test_relay_error_handling.py`), the click-guard via 5 rapid clicks producing exactly one
  session doc, the selection-preservation via a real `Selection`/`Range`, and the Spotify template
  via load/switch/reload round-tripping all 12 dimensions (`test_starter_template_spotify.py`).
  Full 18-file suite (16 previous + these 2 new files) re-verified passing with zero JS errors and
  zero regressions. Still true, and now more clearly *surfaced* rather than silently broken: the
  relay isn't deployed anywhere public yet, so live retro sessions on the Vercel preview correctly
  report themselves unavailable (clear error dialog, no hang, no runaway reconnect spam) rather
  than working end to end — deploying the relay (see "Suggested next step") is what actually
  unblocks cross-device retro testing.
- 2026-09-12 — Made the relay actually deployable, for two audiences stated explicitly this round:
  embedding this on a company website (subdomain/iframe) and forking the repo so others can
  self-host it entirely offline on their own LAN, to route around their own security constraints.
  Considered deploying the relay as a Vercel Function using their newly-public-beta native
  WebSocket support, so the whole app ships from one Vercel project — checked this directly against
  Vercel's own current docs rather than assuming the earlier sketch in `docs/standalone-plan.md`
  still held, and rejected it: a new connection there isn't guaranteed to land on the same Function
  instance as an existing one, and Vercel's fix for that (external Redis) is a real ongoing
  dependency neither audience wants — see the new locked decision above and `relay/README.md`'s "Why
  not a Vercel Function" for the full reasoning. Instead: (1) added `render.yaml` at the repo root
  so deploying the unmodified `relay/server.js` to Render is close to one-click (reads `PORT` from
  the environment already, so nothing else to configure); (2) added
  `scripts/generate-relay-config.js` as `vercel.json`'s new `buildCommand`, which writes
  `public/relay-config.js` from a `SQUAD_PULSE_RELAY_URL` environment variable set in Vercel's
  project settings — scopeable to Preview (to test a real relay on this branch before merging) or
  Production independently, with the build step a safe no-op (checked-in placeholder stays) when
  the variable isn't set, so a bare fork with zero config still deploys and degrades exactly as the
  previous round's fixes intended. `relay/README.md` now also spells out the plain `npm start` +
  hand-set `ws://<LAN-IP>:8787` path for the LAN self-host case, which needed no code changes at
  all — the relay was already a dependency-free Node process. Verified end to end by the new
  `tests/test_relay_config_injection.py`: the generator script's output for both the set and unset
  cases, and — driven through `index.html`'s real script order — that an injected value actually
  wins over the page's own protocol/hostname default rather than just asserting it should. Full
  19-file suite re-verified passing with zero JS errors and zero regressions. Still true: nobody has
  actually clicked "deploy" on the relay yet, since that needs a Render (or equivalent) account this
  session doesn't have — the Render blueprint and the Vercel env var are the two concrete steps left
  for whoever does.
- 2026-09-12 — Three rounds of fixes chasing a real "session isn't open" report from an iPhone
  joining a live Vercel preview, each one uncovering the next:
  1. The join screen (`#viewJoin`) has no nav back to Admin's own Diagnostics panel by design (a
     participant shouldn't see the facilitator's board), which meant it also had no way to show
     ANY diagnostic info — a stuck participant had nothing to screenshot. `diag()` now updates every
     element with `class="diag-log"` instead of only Admin's `#diagLog` by id; the join screen gets
     its own collapsed-by-default "Trouble joining? Tap for diagnostics" panel.
  2. That surfaced a second, worse gap on the facilitator's own device: clicking "Start retro
     session" left the button disabled forever with NOTHING new in Diagnostics — every explicit
     `diag()` call in the app lives inside a `.then()`/`.catch()`, so a synchronous throw upstream of
     those vanished without a trace. `helpers.js` now forwards `window`'s own `error` and
     `unhandledrejection` events into `diag()` unconditionally, so the log always shows *something*.
  3. That, in turn, revealed the actual bug on the next attempt: `new WebSocket(...)` throws a
     SyntaxError SYNCHRONOUSLY for a malformed scheme, and the real-world cause was a one-letter
     typo in the `SQUAD_PULSE_RELAY_URL` Vercel env var (`was://` instead of `wss://`). `getRoom()`
     in `relay-client.js` now validates the scheme up front and fails the same clean,
     catchable way "no relay configured" already did, instead of an uncaught exception.
  Separately, answered a real design question this raised — can "this retro isn't open" (bad/never-
  existed code) be told apart from "this retro has ended" (closed) without a database? Partially,
  honestly: `closeSession()` now writes `status:"closed"` (an `update`) instead of deleting the doc
  outright, so a participant already on the join screen, or one who opens a stale link soon after,
  sees a real "This retro has ended" — for as long as the relay's own room-empty grace period keeps
  that doc around, since nothing here is a real database and a code the relay has fully forgotten is
  genuinely indistinguishable from one that never existed. Also added a third, distinct message —
  "Can't connect to the retro server" — for when this device never reached the relay at all, as
  opposed to reaching it and finding no such room; `relay-client.js` now carries an `unavailable`
  flag on every doc snapshot so `retro.js` can tell the two apart. Closing a session also now
  explicitly forgets its code from this device's local "known codes" bookkeeping the moment it's
  marked closed (previously only a hard delete did this), so a status-only update can't leave this
  device silently reconnecting to every session it's ever started, forever.
  A fourth round, from a follow-up report with the same symptom ("stuck in Starting...") but a diag
  log this time showing the write had actually succeeded (`Started retro session ... Sessions
  snapshot #4: 1 doc(s)`), found the real remaining bug: every db snapshot listener gates its own
  re-render on `state.ui.view==="..."` (see `db.js`) — a snapshot that arrives while a view is
  hidden updates `state` correctly but never touches that view's DOM, since nothing was watching.
  `setView()` (`app.js`) only ever toggled `hidden` attributes, so switching back to a view just
  un-hid whatever HTML was already there from before — stale. This is exactly what happened: click
  "Start retro", switch to Admin to check Diagnostics while the relay connects (a real few-second
  wait watching a cold relay wake up), the session starts successfully while Admin is showing, then
  switching back to Squad shows the disabled button from before, forever, since nothing re-rendered
  it. Fixed by having `setView()` call `renderAll()` on every switch — cheap (in-memory state to
  DOM, no network), the same function already used elsewhere for "state changed broadly, refresh
  everything." Verified with a dedicated test that reproduces the exact sequence (start a session,
  switch away before its snapshot lands, seed the doc while hidden, switch back, confirm the real
  session card shows) — `test_view_switch_refreshes_stale_state.py`.
  Verified end to end, not just by inspection: a synthetic sync throw and a synthetic unhandled
  rejection both confirmed reaching `#diagLog`
  (`test_uncaught_error_diagnostics.py`); the join screen's own diagnostics panel confirmed reachable
  and populated for a real "not found" case (`test_retro_join_flow.py`); the malformed-scheme case
  confirmed to fail with zero WebSocket attempts and zero uncaught exceptions, and the real join
  screen confirmed to show "Can't connect" (not "isn't open") for an unreachable-but-valid URL
  (`test_relay_error_handling.py`); and, over the real relay, a just-closed session confirmed to read
  as "ended" while a never-existed code still reads as the generic message
  (`test_relay_cross_device_sync.py`). Full 20-file suite re-verified passing with zero regressions.
- 2026-09-12 — Confirmed working end to end on a real deployed preview: a facilitator on Chrome ran
  a full retro with a participant on an iPhone and another on Safari, over the deployed relay.
  Separately, assessed whether Playwright was the right tool for the whole suite — it wasn't, for
  part of it: pure logic with zero DOM dependency (consolidation/scoring math in `helpers.js`, CSV
  parsing/column-matching in `csv.js`) was only reachable indirectly, by loading a full page and
  clicking through the UI to exercise it. Added `tests/unit/` — plain Node (`node:test`, nothing to
  install) tests that `require()` those functions directly, via a small guarded
  `module.exports` block at the end of each file (a no-op in the browser, since `module` doesn't
  exist there — see `tests/unit/README.md`) and a deliberately permissive fake DOM
  (`tests/unit/fake_dom.js`) so a file that also does real DOM wiring at its top level doesn't crash
  on load. 29 tests covering banding/consolidation (including the calmer-tie-break rule), override
  precedence, and CSV round-tripping (quoted fields, Dimension-Key-before-label matching, column
  reordering, template-mismatch flagging) run in ~0.1s total — instant compared to driving the same
  logic through a browser. Playwright stays exactly where it already was for what actually needs a
  browser (UI interaction, real WebSocket/`crypto.subtle`) — this doesn't replace any of that
  coverage, it adds a faster, more precise layer under it. `.github/workflows/tests.yml` now runs
  both tiers. Full suite timed end to end: 29 unit tests (~0.2s) + 21 Playwright files (~1m52s) ≈
  1m53s total, all green.
- 2026-09-12 — Worked through `docs/refactoring-report.md`'s prioritized list, verifying with the
  full test suite after each step rather than as one big change:
  1. Centralized `colorWord()`/`trendWord()` and named `isStatementDimension()` in `helpers.js`,
     replacing duplicated ternary chains and inline `dim.statements && dim.statements.length`
     checks across `render.js`, `squads.js`, `retro.js` (before the split below), and
     `dimensions-templates.js`.
  2. Added `diag()` calls to five previously-silent `.catch(function(){})` sites (`renameSquad`,
     `removeSquad`, `removeDimension`, `deleteTemplate`, `moveDimension`'s two writes) — a rename or
     delete that failed to persist previously left zero trace to debug from.
  3. Collapsed `persistDimensionRating`/`persistDimensionRatings` (90% duplicate code) into one
     function, the single-key case now just calling the batch case with a one-item array.
  4. Added `liveOr(liveFn, localFn)` and `syncLiveIfConnected(writeFn, describe)` to `helpers.js` —
     the two shapes every "write live, else write local" branch in the app already followed,
     duplicated 12+ times across `squads.js`, `dimensions-templates.js`, `retro.js`, and `csv.js`.
     Applied both everywhere that fit the shape cleanly; deliberately left `loadTemplate()`'s and
     `applyImportPlan()`'s live branches alone, since their complexity comes from a genuinely
     different multi-step async chain, not mechanical duplication — forcing them into the same
     helper would have cost clarity, not saved it.
  5. Split `retro.js` (808 lines) into `retro-facilitator.js` and `retro-join.js` along the device
     -role seam the report identified: the two halves shared almost no code, so this was closer to
     "move code" than "redesign code" — see "The app's file layout" above.
  Added tests alongside each step rather than after: `colorWord`/`trendWord`/`isStatementDimension`/
  `liveOr`/`syncLiveIfConnected` all got new `tests/unit/test_helpers.js` cases (34 unit tests now,
  up from 29). The full 21-file Playwright suite was re-run after every one of the 5 steps above,
  not just at the end, so a regression would have been caught at the step that introduced it rather
  than discovered later; all 5 runs were clean. Deliberately not touched this round (still on the
  report's backlog, lower priority): `state.editing`'s hidden dual shape, splitting
  `dimensions-templates.js`, naming/abbreviation consistency, and the `esc()` safety audit.
- 2026-09-12 — Finished the refactoring report's remaining items (except naming consistency, kept
  deferred — see the report's updated "Status" note for why): split `state.editing` into
  `state.editingCell`/`state.editingOverride` (two plainly-named slots instead of one object with a
  hidden `mode:"session"` flag — see `modals.js`'s new `activeEditor()`); split
  `dimensions-templates.js` into `dimensions.js` (the dimension manager) and `templates.js` (template
  save/load/delete), the same device-role-style seam as the earlier `retro.js` split; and ran the
  `esc()` safety audit the report flagged as unaudited. That audit found one real inconsistency:
  `unitLower()`/`unitPluralLower()` output went into `innerHTML` unescaped in 7 places (`render.js`
  ×2, `squads.js` ×3, `csv.js` ×2), while `templates.js`'s own `templateRowHtml` already wrapped the
  same underlying value (`t.unitPlural||t.unit`) in `esc()` — fixed all 7 for consistency. Honest
  caveat, not glossed over: nothing in the current UI actually lets a user set `state.config.unit`/
  `unitPlural` to anything attacker-controlled (no exposed input writes to it directly; every path —
  `DEFAULT_CONFIG`, the three starter templates, `saveCurrentAsTemplate` — only ever copies a value
  already known to be a plain English word), so this closes a latent inconsistency rather than a
  live exploit — worth having fixed regardless, since the next thing that touches this code shouldn't
  have to rediscover the gap. Full 21-file Playwright suite plus the 34-test unit suite re-verified
  passing with zero regressions after each of the three changes.
- 2026-09-12 — Diagnosed a real cross-device bug (Mac facilitator + iOS participant end up with
  divergent Tribe-view data) to its root cause: per-device `localStorage` seeds identical squad IDs
  independently, so two devices' boards were never actually the same board. User specified the
  replacement architecture directly (verified against Excalidraw's real design: a content-blind
  relay for live propagation, a durable store for persistence) — see "Board sync (major change, in
  progress)" above for the full plan and its 7 increments. **Step 1 done this session:** relay-side
  durable storage behind a documented three-method adapter interface (`relay/storage/`:
  `load`/`save`/`remove`). `none-adapter.js` is the default and reproduces the relay's exact
  original behavior (nothing persists across a restart); `file-adapter.js` is a real one (one JSON
  file per room on disk, filename derived from a hash of the room code so an arbitrary code can
  never touch an unexpected path), opted into via `RELAY_STORAGE=file`. `server.js` now awaits
  `storage.load()` when a room is first created (deduped across concurrent connections for the same
  brand-new code via `roomCreationPromises`) and fire-and-forgets `storage.save()`/`storage.remove()`
  on every write/room-cleanup; `startServer({ storage })` accepts an override for tests. Zero
  app-facing or wire-protocol change — `relay-client.js` untouched, the original
  `relay/test/relay.test.js` passes unmodified, and the real end-to-end
  `tests/test_relay_cross_device_sync.py` (real relay process, two browser contexts, real
  encryption) still passes. New `relay/test/storage.test.js` proves both adapters' contracts and,
  by forcing a genuine module reload between two `startServer()` calls (not just reusing the same
  in-process `rooms` Map, which would make the test meaningless), that a room's docs really do
  survive a restart with `FileAdapter` and really don't with the default. Full 21-file Playwright +
  34-test unit suite re-verified passing. Safe to ship to `main` as-is: this step only adds an
  opt-in capability nothing currently calls.
- 2026-09-12 — **Board sync step 2:** widened `relay-client.js`'s router to recognize
  `boards/<teamCode>` paths (`isBoardPath`, alongside the existing `isSessionPath`), and
  `local-store.js` now sends either namespace to the relay instead of `localStorage`. Turned out to
  need no change to `relay/server.js` at all: the wire protocol already treats a room's `code` and
  every doc `path` within it as opaque strings, never inspecting their meaning — so a
  `boards/TEAM01/config` path just opens a differently-keyed room from `sessions/ABC123`, using the
  exact same put/delete/snapshot mechanism and the same code-derived AES-256-GCM encryption. Nothing
  in the app's UI calls a `boards/*` path yet. New `tests/test_relay_board_path_sync.py` proves the
  plumbing end to end below any UI, using the same real-relay-subprocess-plus-two-browser-contexts
  harness as `test_relay_cross_device_sync.py`: a board doc written on one device is read back,
  decrypted, on an independent second device; an unwritten board path reads back as not-found
  rather than throwing; and `sessions/*` paths are unaffected by the new routing. Full 22-file
  Playwright + 34-test unit suite (plus `relay/`'s own `npm test`) re-verified passing. Safe to ship
  to `main` as-is: purely additive, no existing call site changes behavior.
- 2026-09-12 — **Board sync step 3:** new `public/js/board-sync.js` + an Admin-view "Team sync
  (beta)" card — an opt-in per-device "team code" setting. Connecting pushes an encrypted
  full-board snapshot (squads, dimensions, config) to `boards/<teamCode>` on the relay; every later
  squad/dimension/config save pushes again. Hooked into `db.js`'s three existing snapshot
  listeners (squads, dimensions, `meta/config`) rather than each individual writer across
  `squads.js`/`dimensions.js`/`templates.js`/`csv.js`/`modals.js` — those listeners already fire on
  any board mutation regardless of which file caused it, so this needed zero changes outside
  `db.js`, `board-sync.js`, and `index.html`'s new card. One-way only: nothing reads a team code's
  board back yet (hydrate-on-load is step 4). With no team code set, `pushBoardSnapshotIfConnected()`
  returns immediately — zero behavior change for the default case. `tests/unit/test_board_sync.js`
  covers `normalizeTeamCode()`; new `tests/test_board_sync_opt_in_push.py` drives the real Admin UI
  end to end against the real relay (not just the plumbing): no code set never touches the relay,
  connect-then-add-a-squad produces a real decryptable snapshot a second device can read straight
  off the relay, and disconnecting genuinely stops further pushes. Full 23-file Playwright +
  35-test unit suite re-verified passing. Safe to ship to `main` as-is.
- 2026-09-12 — **Board sync step 4:** hydrate-on-load. `board-sync.js` gained
  `hydrateFromTeamCodeIfConnected()`, run once at boot in `db.js`'s `initDb()` (before the
  squads/dimensions/config listeners register, so their first fire already reflects hydrated data)
  and again right after connecting a team code (so connecting to an existing team's board doesn't
  blindly clobber it with whatever this device had locally). Conflict rule: last-write-wins by the
  push payload's own `updatedAt` ISO timestamp, tracked per team code via
  `getSyncedAt`/`setSyncedAt` so a device can tell "the relay has something genuinely newer" apart
  from "the relay has exactly what I just pushed." `applyRemoteBoardSnapshot()` reads the CURRENT
  local squad/dimension doc ids via a fresh `get()` (not `state.squads`/`state.dimensions`, which
  at boot are still whatever `state.js` seeded them to — the real board hasn't loaded at that
  point) to correctly add, update, and remove docs to match the remote. A `hydrating` flag
  suppresses `pushBoardSnapshotIfConnected()` mid-rewrite so the relay never sees a
  half-applied intermediate board. New `tests/test_board_sync_hydrate_on_boot.py` proves the full
  round trip over the real relay in both directions: device B, booting with a team code already
  configured, pulls device A's already-pushed board with zero clicks; then after B makes its own
  change, device A's next reload pulls B's newer state back too — genuine bidirectional
  last-write-wins, not just a one-time catch-up. Full 24-file Playwright + 35-test unit suite
  re-verified passing. Safe to ship to `main` as-is: with no team code set, hydrate is a no-op, and
  the "Connect" flow only changes for someone opting into a code that already has a newer remote
  board.
- 2026-09-12 — **Board sync step 5:** live subscribe. `board-sync.js` gained
  `subscribeToTeamBoardIfConnected()`/`stopTeamBoardSubscription()`, and refactored step 4's
  apply-if-newer logic into a shared `maybeApplyRemote()` used by both the one-shot boot hydrate
  and every live callback — the subscription's own first callback (onSnapshot always fires
  immediately with current state, same as any Firestore-shaped listener in this app) safely no-ops
  since it's just re-announcing what hydrate already applied moments earlier. The subscription
  reuses the exact same relay-client.js machinery retro sessions already rely on for this: one
  persistent WebSocket per room code, kept open for as long as the tab stays connected to that team
  code. Started right after boot-time hydrate and right after a fresh "Connect"; stopped on
  "Disconnect". New `tests/test_board_sync_live_subscribe.py` proves two devices connected to the
  same team code AT THE SAME TIME converge on a squad add in both directions with zero reloads
  (the real gap step 4 left open), and that disconnecting stops live updates too, not just outgoing
  pushes. Full 25-file Playwright + 35-test unit suite re-verified passing. Safe to ship to `main`
  as-is: identical no-team-code-set behavior; the only change for a connected device is seeing
  updates sooner (live vs. next reload), never a different final state than step 4 already produced.
- 2026-09-12 — **Board sync security fix**, from user review of steps 3–5: a typed, user-chosen
  "team code" doubling as the encryption key (retro sessions' deliberate tradeoff, wrong here — see
  "Board sync"'s new "Security fix" section for the full reasoning) replaced with a high-entropy
  secret shared only via link/QR, mirroring Excalidraw's real architecture and reusing retro
  sessions' own join-by-link/QR UI. `crypto.js` gained `generateSecret()`/`roomIdFor()`;
  `relay-client.js`'s `doc()`/`collection()` gained an optional `secret` argument (omitted, sessions
  are byte-for-byte unchanged); `board-sync.js`'s UI became "Create a team link" / paste-a-link /
  auto-connect-from-`?team=`. Testing this also caught a real, previously-latent bug in
  `relay-client.js`'s `putDoc()` (re-derived its key from the room's routing id instead of reusing
  the room's actual key — invisible for sessions, silently broke every board write) — fixed by
  storing the room's `keyPromise` at connect time. All three board-sync Playwright tests rewritten
  against the new UI; `test_relay_board_path_sync.py` gained direct secret/routing-id-separation
  coverage; `tests/unit/test_board_sync.js` now covers `parseTeamSecretInput()`/`teamLinkFor()`.
  Full 25-file Playwright + 38-test unit suite passing. **Not yet merged to `main`** — the user
  clarified mid-session that "safe to push to main" is a standing capability they want, not a
  standing instruction to auto-merge every finished increment: from here on, increments land on the
  feature branch and stay there, tested and ready, until the user explicitly says to merge.
- 2026-09-12 — **Playwright suite perf pass**, prompted by the user noticing the suite had gotten
  slow again. Timed all 25 files individually (`time python3 tests/test_*.py` per file) before
  touching anything: 133.65s sequential total, one huge outlier —
  `test_dimension_and_template_admin.py` at 17.58s, more than double the next-slowest file. Root
  cause: it built its own test page by reading `public/index.html` and splicing its fake store in
  by hand, instead of calling `tests/fixtures/build_page.py`'s `build_page()`/`write_plain_index()`
  — bypassing the Google Fonts `<link>` strip those apply, and re-triggering the exact ~12-second
  stall `build_page.py`'s own header comment already documented as the reason that strip exists in
  the first place. Fixed by adding `build_custom_page(extra_head_html, out_name)` (same strip, for
  a test needing its own bespoke fake store shape) and switching this file to use it:
  17.58s → 5.03s. Also trimmed `test_csv_import_column_matching.py`'s "renamed headers" scenario
  (positional-fallback header matching, preview-only, never applies anything) since
  `tests/unit/test_csv.js`'s "`mapImportColumns()` falls back to `toCSV()`'s fixed column order"
  already covers the exact same logic, and the file's other two scenarios already prove the same
  preview-rendering pipeline works: 3.44s → 3.08s. No other file was found reading `index.html` by
  hand, and no other fully-redundant Playwright-vs-unit-test overlap was found on this pass — every
  other file exercises real DOM rendering, `localStorage`, a real WebSocket, or `crypto.subtle` that
  a unit test structurally can't reach. New sequential total: 118.9s (down from 133.65s). Documented
  the pattern and a "run this if it gets slow again" note in `tests/README.md` so this doesn't
  quietly regress a third time. Full 25-file Playwright + 38-test unit suite re-verified passing.
- 2026-09-12 — **New policy: test-first, from here on.** The product owner asked for TDD going
  forward rather than tests-after-code. No general-purpose TDD skill existed to install (checked
  the skill/plugin marketplace — nothing generic fit), so added a repo-scoped one instead:
  `.claude/skills/tdd/SKILL.md`. It encodes this repo's actual two-tier decision (pure logic →
  `tests/unit/`, real DOM/relay/crypto → `tests/test_*.py`), the "check for existing unit coverage
  before adding a Playwright test" rule from the perf pass above, and the write-test-first →
  watch-it-fail-for-the-right-reason → minimal-code → refactor → full-suite loop this file's own
  session log has been documenting in practice all along. Applies to any change under
  `public/js/*.js`, `public/local-store.js`, or `relay/*.js`.
- 2026-09-12 — **Board sync step 6, and the `tdd` skill's first real test-flight.** Followed the new
  skill exactly: picked the tier (Playwright — real relay, real cross-device), wrote
  `tests/test_board_sync_finish_retro_convergence.py` FIRST reproducing the original bug report's
  exact shape (two team-synced devices, each facilitating a different squad's retro), then ran it
  before writing any new production code. It failed for a real reason on the first run — not the
  one expected. `board-sync.js`'s `applyRemoteBoardSnapshot()` was writing a remote squad's
  `dimensions` object (frozen, per `deepFreezeClone()`) straight into a local doc; the next
  `persistDimensionRatings()` call on that squad threw trying to add a new key to it ("object is
  not extensible"). This is precisely the kind of bug a test-after approach tends to miss — a
  weaker test (does `applyRemoteBoardSnapshot()` return without throwing?) would have stayed green
  right through it, since the throw only happens on the NEXT write to that squad, not the hydrate
  itself. Fixed with a `plainClone()` helper (JSON round-trip) applied everywhere a remote
  snapshot's nested value gets written into a local doc. Full scenario now passes: two devices,
  each finishing a different squad's retro, both converge on seeing BOTH squads' real results,
  live; a rainy-day third device that never connected to the team link is confirmed unaffected.
  Skill verdict: worked as intended, no changes needed to the skill itself this round — the
  "pick the tier" and "write it first" steps did their job. One incidental discovery while writing
  the test, not a skill gap: a joined participant has no in-app way back to the main board (the
  test had to `page.goto()` the plain URL to simulate what a real user does today), independent
  confirmation that story 9 is real. Full 26-file Playwright + 38-test unit suite passing.
- 2026-09-12/13 — Stories 9, 10, 11, and Board sync step 7 (default-on), test-flighting the `tdd`
  skill across all four. Stories 9 (participant exit/return), 10 (co-facilitator join via
  code/link/QR), and 11 (wire-level encryption verification) all landed clean on the first real run
  — see "Board sync" above for each one's detail; no skill changes needed. Step 7 (default-on) was
  the hard one: turning on the full hydrate/push/subscribe cycle for EVERY device on EVERY boot
  (instead of only an opted-in device once in a while) surfaced five real, previously-latent
  concurrency/timing bugs the existing test suite caught one at a time as each prior fix exposed
  the next — a blocking `await` that could stall the whole board behind a slow/unreachable relay, a
  partial-board push race between three independently-timed local listeners, a timestamp-capture-
  order bug that could invert last-write-wins, `maybeApplyRemote()` reentrancy between hydrate and
  live-subscribe, and a genesis-push race for a device joining an existing team. The trickiest was
  found LAST, via `test_board_sync_finish_retro_convergence.py` (story 6's own test) regressing at
  a new assertion after all five of the above were fixed: `relay-client.js`'s `getRoom()` was
  remembering every room it ever connected to — including a board's secret-derived room id, not
  just plain session codes — for the broad `sessions` listener's reconnect-on-boot bookkeeping.
  Once a device had ever joined a retro session and then reloaded, that bookkeeping's blind,
  no-secret `getRoom(code)` call could create the board's room FIRST on the new page, permanently
  fixing its encryption key to the wrong value (derived from the room id instead of the real
  secret) — the device could still round-trip with itself but could never again decrypt a
  correctly-keyed teammate's pushes, with no error surfaced anywhere. Fixed by only remembering a
  code when no secret was given. Chasing the same regression also surfaced a SEPARATE, test-only
  bug: `tests/fixtures/fake_store.html` had no concept of routing to a relay, so board sync's new
  always-on `boards/<roomId>` traffic was landing in the exact same shared in-memory map as the
  real squads/dimensions data in every fake-store test — a delayed hydrate could echo back a stale
  snapshot and silently clobber a test's freshly-written board, intermittently breaking several
  unrelated template/dimension tests. Fixed by making `boards/` paths inert in the fake store
  (reads as not-found, writes reject as unavailable), the same behavior a real deployment gets with
  no relay configured. Retired the "no persistent database, ever" language in this file, `README.md`,
  and `docs/standalone-plan.md` for good — board sync's default-on rollout is what that
  language was always going to give way to once proven. Full 30-file Playwright + 38-test unit
  suite passing with zero regressions.
- 2026-09-13 — **Test suite performance pass.** Runtime, not behavior: no product code changed.
  Confirmed every file in `tests/test_*.py` is fully independent (its own unique `build_page()`/
  `write_plain_index()` output filename, its own hardcoded relay port where a relay-backed file
  spawns one — no two files share either), so added `tests/run_all.sh` to run the suite as parallel
  processes instead of the serial `for` loop tests/README.md used to suggest. Measured on this
  machine: serial ~170s → 2-at-a-time ~75s (zero failures) → 4-at-a-time ~41s but with one real,
  reproducible flake (`test_relay_cross_device_sync.py`, an element read right after a genuine
  WebSocket round trip, purely from CPU contention on a 4-core box with no headroom) — so
  `run_all.sh` defaults to 2, not `nproc`. `.github/workflows/tests.yml` now shards the Playwright
  suite three ways across separate runners (each running `run_all.sh` internally at 2), and split
  the relay/unit checks into their own job that runs concurrently with the Playwright shards rather
  than serially before them. Separately, converted the small number of `wait_for_timeout(N)` calls
  that were guessing at a REAL relay round trip's duration (right after `#startSessionBtn`, a
  join-by-code, or before touching `#experimentNoteBox`) to `page.wait_for_selector(...)` on
  whatever that round trip actually produces — same fixed pattern that was causing the P=4 flake
  above, now fixed at the source rather than by capping concurrency alone. Deliberately did NOT
  touch the much larger set of `wait_for_timeout` calls with no equivalent DOM signal to wait on
  (a write with no visible effect, several independent listeners settling) — converting those
  would mean guessing a different, unproven condition rather than removing a real one, which is not
  a safe trade at suite-wide scale. Also audited `tests/unit/*.js` vs. several Playwright files
  that looked like candidates for trimming duplicate pure-logic coverage (consolidation/tie-
  breaking, scored-template math) — found each one already earns its slower cost per this file's
  own established rule (real DOM rendering, live-toggle persistence through the shared session doc,
  wiring from actual clicks through to the real aggregation code path, not just re-checking the
  math), so none were removed. Full 30-file Playwright + 38-test unit suite passing with zero
  regressions throughout, including three consecutive clean runs of the suite's most timing-
  sensitive file after the wait-condition changes.
- 2026-09-13 — **Real bug report, three devices (Mac facilitator, iPhone + iPad participants),
  fixed.** Diagnostics from all three showed different board-sync room ids -- three unrelated
  teams -- even though a retro was shared between them: iPhone and iPad had each joined only the
  retro session's OWN participant join link, never the facilitator's separate team link, so a
  finished retro (and, separately, a squad rename tried on one device) never reached the others in
  either direction. Root cause and fix are exactly what the product owner proposed: unify the two
  mechanisms, matching the Excalidraw "one link, one shared document" model this repo's docs
  already reference, rather than requiring a second, separate team-link step. `joinUrlFor()` (and
  `coFacilitateUrlFor()`, same gap) now appends the facilitator's own current team secret as
  `&team=<secret>` whenever they have one connected (the default per step 7); `board-sync.js`'s
  existing `autoConnectFromLink()` already applies a `?team=` param generically and runs before the
  default-bootstrap step, so no other production code needed to change. A facilitator who
  explicitly stopped syncing produces a plain, session-only link exactly like before this fix --
  the join link never forces a team onto anyone. New `tests/test_retro_join_link_carries_team_sync.py`
  proves both directions over the real relay (a device that only ever opens the join link ends up
  team-synced and sees the facilitator's real board; the reverse also reaches the facilitator live)
  plus the rainy day above. A separate reported bug ("Starting retro session" stuck on iPhone/iPad
  while Mac worked fine) is very likely explained by the same diagnostics -- both mobile devices
  show repeated relay disconnect/reconnect cycles roughly every 30-90s (absent on Mac), consistent
  with a mobile network's NAT dropping an idle WebSocket with no application-level keep-alive to
  prevent it (`relay/server.js` has no ping/pong). Not fixed this round -- flagged as a follow-up
  (a server-side heartbeat, and/or a client-side connection-attempt timeout in `relay-client.js`'s
  `connectRoom()` so a hung initial connect can't block a brand-new session's `.set()` forever) --
  since it's a distinct, separately-scoped resilience improvement to the wire protocol rather than
  a one-line fix, and wasn't confirmed as an infinite hang (only a real, repeated slowdown) in the
  captured diagnostics.
- 2026-09-13 — Two small UI fixes from the same bug report. (1) The session card's "Close session"
  button sits right next to "Finish retro & apply results" and was reported as easy to mistake for
  also saving results -- renamed it and both confirm-dialog OK labels that lead to the same
  `closeSession()` action to "Close session without applying results" / "Close without applying
  results". Text-only; the action itself is unchanged. Regression assertion added to
  `test_retro_join_flow.py`. (2) Added a one-click "Copy diagnostics" button to both diagnostics
  panels (Admin view and the participant join screen) -- `diag()`'s own selection-preserving logic
  already existed because a fast-moving log made manual select-and-copy fiddly; a button sidesteps
  that entirely by reading the log's current text at click time. Falls back to a hidden-textarea +
  `execCommand("copy")` if the Clipboard API isn't available. New assertions in
  `test_uncaught_error_diagnostics.py` verify the REAL clipboard content (not just "didn't throw"),
  which needed granting the test's browser context `clipboard-write`/`clipboard-read` permissions
  Playwright doesn't have by default. Full 31-file Playwright + 38-test unit suite passing.
- 2026-09-13 — **Test-runner portability fix, plus a second wait-condition pass.** `tests/run_all.sh`
  failed on macOS with `xargs: command line cannot be assembled, too long` -- even for a single,
  short test file, which ruled out an actual argument-length overflow. Root cause: `xargs -I{} sh
  -c '<inline script>'` combined with `-P` (parallel) is a known-broken combination on BSD/macOS's
  `xargs` specifically; it worked fine on this machine's Linux/GNU findutils, which doesn't share
  the limitation, and would have kept looking "fine" here indefinitely without a macOS test.
  Fixed by extracting the per-file run/report logic into its own file, `tests/_run_one.sh`, and
  dispatching to it with `xargs -n 1 -P "$JOBS" tests/_run_one.sh` -- no `-I`, no inline script for
  xargs to reconstruct, which is the standard macOS-safe parallel-xargs idiom and behaves
  identically on GNU findutils. Verified: one explicit file, two explicit files, the full suite, and
  intentional failures (a missing file, a genuinely failing assertion) all propagate a real nonzero
  exit with useful per-file output, no false success. (Could not literally run this on macOS from
  this session's environment -- the fix is evidence-based on BSD xargs's documented `-I`+`-P`
  limitation and the exact error text matching, not directly re-verified on that OS; flagging this
  honestly rather than claiming a test that didn't happen.)

  Re-audited `wait_for_timeout` across the suite rather than assuming the prior pass's "leave the
  other ~400 alone" conclusion was still complete -- it wasn't: the SAME pattern fixed last time in
  one relay file (a fixed sleep guessing a real relay round trip's duration, right before reading
  what that round trip produces) turned out to still exist, unconverted, in several sibling
  files -- `test_board_sync_finish_retro_convergence.py`, `test_cofacilitator_join.py`,
  `test_relay_cross_device_sync.py`, `test_board_sync_hydrate_on_boot.py`,
  `test_board_sync_live_subscribe.py`, `test_board_sync_default_on.py`,
  `test_retro_join_link_carries_team_sync.py`. Converted each to `page.wait_for_selector(...)` or
  `page.wait_for_function(...)` on the SPECIFIC result the very next assertion checks (a cell
  leaving "unscored", a squad name matching the expected rename, `.direct-row` appearing, a join
  screen's heading changing away from its "Connecting..." placeholder) -- not a generic "wait for
  everything to settle" guess, which the prior pass correctly identified as unsafe. Two `cell_color`
  helper files gained a matching `wait_for_scored(page, squad, dim)` used only where the test
  already expects that exact cell to become scored. Also converted a few `fake_store`-backed
  boot-wait sites in `test_local_store.py`/`test_retro_join_flow.py`/`test_retro_join_exit_and_return.py`
  where a real, non-guessed boot marker existed (`.squad-pick-btn` is rendered from `state.squads`,
  not static HTML; `#syncText` transitions away from its literal "Connecting..." placeholder).
  Left the deliberate rainy-day "make sure X did NOT arrive" waits, the relay backoff-timing test's
  own `wait_for_timeout(1800)` (verifying a specific point in the retry schedule, which IS the
  point of that test), and the Copy-diagnostics fade timer's wait (a known, deterministic 1500ms
  constant, not a guess) exactly as they were -- none of those have a "did the work finish" signal
  to wait on, because either nothing is supposed to happen, or the wait itself IS the thing under
  test.

  One of the `.squad-pick-btn` boot-marker conversions initially SEEMED safe (passed 3 clean runs
  in `test_local_store.py`) but was actually a lucky pass, not a correct fix: `wait_for_selector()`
  defaults to requiring the element `state="visible"`, and `.squad-pick-btn` lives inside whichever
  of Tribe/Squad view is currently hidden -- `test_local_store.py` happened to already be on Squad
  view before its reload, so the element stayed visible throughout, but the same conversion in
  `test_board_sync_finish_retro_convergence.py` (reloading from a context where Tribe was the
  active view) hung for the full 30s default timeout and failed for real. Fixed by adding
  `state="attached"` everywhere this boot marker is used, which only requires the element to exist
  in the DOM -- the actual "has this render happened" signal intended, regardless of which view is
  currently shown. A reminder that a passing run isn't proof a wait-condition change is correct;
  re-verifying is what caught this before it shipped.

  Measured before/after on this machine: serial suite runtime ~158.7s → ~142.1s from this session's
  wait-condition changes (on top of the four files already fixed last session); combined with the
  parallel runner, full suite (unit + relay + all Playwright files) now completes in ~72-73s at the
  default `TEST_JOBS=2`, vs. serial's ~142s -- essentially unchanged ratio from before (parallelism
  was always the bigger lever than trimming individual waits), but both numbers dropped together.
  Slowest single file post-fix: `test_board_sync_finish_retro_convergence.py` at ~11.3s (two full
  rounds of a real 3-device relay scenario -- genuine work, not waiting). No Playwright file was
  removed or weakened,
  no relay/crypto/localStorage integration behavior changed, and `fake_store.html`'s architecture
  was not touched -- re-examined the prior pass's "do not change" list specifically for this task
  and found no evidence to override any of it. Fixed a stale "30-file"/"30 Playwright files" count
  in `tests/README.md`'s Performance section (a live, current-facts section, unlike this dated log)
  by rewording to avoid hardcoding a count that will keep drifting, rather than just bumping the
  number to 31. Full unit + relay + 31-file Playwright suite passing, including repeated runs of
  every modified file.
- 2026-09-13 — **Multi-language support, Story 1: hardened Hebrew/RTL test coverage.** First step
  of the product owner's multi-language roadmap (Hebrew UI, persisted language switcher, a
  translate-everything DOD, human-correctable translations) -- this step is test-only, no new
  feature. The one existing RTL check (in `test_template_switching_and_csv_import.py`) only
  confirmed `dir="auto"` was present in markup on 3 of the ~35 such locations across the app, never
  that real Hebrew content actually resolves to rtl. New `tests/test_hebrew_rtl_coverage.py` types
  or seeds real Hebrew (paired with an English control on a sibling element, so an always-rtl false
  positive would be caught) across every `dir="auto"` surface: admin's dimension manager and squad
  list, Squad view, the rating modal, Tribe view's grid/legend/header-tooltip/hotspots, Templates,
  the retro facilitator card and join/direct-rating flow, plus a CSV export/re-import proving
  `csv.js`'s Dimension Key column (not the label text) is really what survives a dimension being
  re-translated after export, per that file's own header comment. Writing it for real (not just
  re-confirming the attribute exists) found two genuine bugs, now fixed: `render.js`'s Tribe-view
  legend and `retro-join.js`'s direct-rating green/red anchor line both put `dir="auto"` on a `<p>`
  shared with a hardcoded English "Green:"/"Red:" bold prefix -- per the HTML auto-directionality
  algorithm (first strong character in tree order), that prefix's leading "G"/"R" forced the whole
  line ltr even when the translatable content behind it was pure Hebrew, silently defeating RTL for
  exactly the content this feature exists to support. Fixed by moving `dir="auto"` onto a `<span>`
  wrapping just the translatable content, leaving the English label outside it (`index.html`'s
  matching modal fields already did this correctly, which is how they passed while these two
  didn't). Old narrow sanity check removed as superseded. Full 32-file Playwright + 38-test unit
  suite passing (one `test_relay_board_path_sync.py` failure seen under `run_all.sh -P2` reproduced
  as this file's own documented CPU-contention flake -- passed clean standalone, unrelated to this
  change, no relay/board-sync file touched).
- 2026-09-13 — **Multi-language support, Story 2: i18n infrastructure + a first translated module
  (Admin panel) + the AI-human correction workflow.** Deliberately scoped as one small, INVEST-shaped
  vertical slice per the product owner's explicit redirect on the first draft plan (which had spread
  infra/translation/DOD across separate stories) -- infra, a real translated screen, and a working
  correction mechanism, all in one story, or none of it proves anything end to end. New
  `locales/en.js` (source of truth) and `locales/he.js` (AI-translated, flagged for human review in
  its own header comment) are plain `key: "text"` objects, not `.json` files as first sketched in
  planning -- this app's static `<script>` architecture can't `fetch()` a same-origin JSON file over
  `file://` (the Playwright suite's own transport), so locale data follows the exact same
  no-build-step pattern as every other `public/js/*.js` file instead. New `i18n.js`'s `t(key, vars)`
  falls back to English for any key missing from the active locale (generic by locale, not
  hardcoded to Hebrew, so a future third language degrades the same way); `[data-i18n]`/
  `[data-i18n-placeholder]` cover static markup, JS-built Admin strings (`squads.js`'s aria-labels,
  delete-confirm dialogs, the CSV-mismatch-adjacent "Untitled X" fallback, `render.js`'s
  unit-interpolated "+ Add {unit}") call `t()` directly. Translated the ENTIRE Admin screen except
  modal interiors (Edit dimensions/Templates/CSV import stay English -- explicitly later stories):
  Board setup, Team sync (including `board-sync.js`'s dynamically-set "Connected..." status line,
  easy to miss since it's not in static markup -- caught by screenshotting the live Hebrew page,
  not just reading the diff), Squads, Diagnostics. `dir`/`lang` scope to `#viewAdmin` ONLY, not the
  document root -- the rest of the app is still English-only, so a page-wide RTL flip would visibly
  break it; confirmed by asserting Tribe view's own heading stays unaffected while Admin is in
  Hebrew. New `.lang-switch .lang-btn` CSS is a scoped duplicate of `.view-btn`'s look (same
  reasoning as the existing `.reveal-toggle .reveal-btn`, see that rule's own comment) -- reusing
  `.view-btn` literally would have both mis-toggled these buttons' active state AND, worse,
  attached `app.js`'s boot-time `.view-btn` click listener to them, firing `setView(null)` on every
  language switch and hiding all three main views; caught before shipping by re-reading that
  existing CSS comment rather than by a failing test. `state.ui.locale` persists via
  `squadpulse:lang` in `localStorage`, same try/catch pattern as `squadpulse:view`/`squadpulse:squad`
  in `state.js`. The AI-human correction workflow is git-native, not an in-app editor (deferred,
  separable scope per the product owner's own plan): `locales/he.js` is a plain file a human edits
  directly and commits; `tests/unit/test_i18n.js`'s key-parity check (every `LOCALE_EN` key has a
  `LOCALE_HE` counterpart and vice versa, plus no blank Hebrew values) is the mechanical guardrail
  that stands in for the DOD until it's formalized as written policy in Story 3 -- it catches a
  missing/blank translation, not a wrong one; wording quality is still the product owner's own
  read-through, exactly as `he.js`'s header comment says. New `test_admin_language_switch.py`
  proves the switcher end to end: defaults to English, Hebrew renders (static + JS-built strings),
  `#viewAdmin` flips to rtl while `<html>` doesn't, Tribe view is unaffected, the choice survives a
  reload via the real `localStorage` key, and switching back to English fully restores everything.
  Full 33-file Playwright + 45-test unit suite passing.
- 2026-09-13 — Fixed the Admin panel's "Language / Beta" heading badge misalignment under Hebrew
  (reported after the Story 2 push): a hardcoded `margin-left` plus `.model-badge`'s `margin-top`
  (meant for that class's other, header context) don't survive a `dir="rtl"` flip -- replaced with
  a `.heading-with-badge`/`.beta-badge` flex-row-plus-`gap` layout, direction-agnostic by
  construction. Merged a human correction to `locales/he.js`'s Squads hint pushed directly to the
  branch -- exactly the git-native correction workflow Story 2 was built for.
- 2026-09-13 — **Multi-language support, Story 3: formalized the Definition of Done.** New
  `docs/DefinitionOfDone.md` is the standing quality bar every change clears -- Testing (points to
  the `tdd` skill for the how), Multi-language support (every i18n-supported screen's strings go
  through `t()`, every locale carries every key -- enforced by `test_i18n.js`'s parity check --
  `dir="auto"` never shares a container with a hardcoded label, no hardcoded directional CSS
  `margin-left`/`-right` near text ANYWHERE in the app, not just translated screens, since the cost
  of doing it right from the start is near zero and the alternative is re-discovering the exact
  badge-alignment bug above on every future screen), and Delivery workflow (branch/`main` discipline,
  session-log entries). Deliberately distinct from, and cross-referencing rather than duplicating,
  `STATUS.md`'s "Decisions locked in" (specific architecture/product choices, not a standing bar)
  and the `tdd` skill (the how-to for this doc's Testing section). New `CLAUDE.md` (didn't exist
  before) and updates to `README.md`, this file, `tests/README.md`, `tests/unit/README.md`, and the
  `tdd` skill all point to `docs/DefinitionOfDone.md` as the answer to "is this done," rather than
  leaving that judgment implicit or scattered.
- 2026-09-13 — **Multi-language support, Story 4: Tribe view, Squad view, and the shared rating
  modal.** Translated every piece of chrome on both main screens and the modal that isn't
  template-sourced dimension content (labels/green/red text stays whatever the active template
  defines -- Stories 5-7's job): stats cards, cross-squad hotspots, squad-by-squad breakdown and
  ranking, the dimension legend, both empty states and the grid, the squad picker, "Your hotspots,"
  entry list, and the rating modal's Health/Trend/Note chrome, swatch and trend titles, and
  Cancel/Save. `dir`/`lang` now scope to `#viewTribe`, `#viewSquad`, and `#backdrop` too (`i18n.js`'s
  `RTL_SCOPED_CONTAINERS`) -- not the document root, so the still-untranslated retro flow and every
  other modal don't visually break. The retro session card renders INSIDE `#viewSquad` but stays
  English (Stories 9-10), so it now sets its own `dir="ltr"` to opt out of inheriting the RTL flip,
  same pattern documented in `docs/DefinitionOfDone.md` for any future still-English widget embedded
  in a translated container. `colorWord()`/`trendWord()` (`helpers.js`) were deliberately NOT made
  locale-aware directly -- they're also called from retro-facilitator.js/retro-join.js, which aren't
  translated yet, and doing so would leak Hebrew into an untranslated screen the moment the language
  switches; new `colorWordLocalized()`/`trendWordLocalized()` (`i18n.js`) are used only from the
  Tribe-/Squad-view call sites Story 4 actually covers.

  Real, non-obvious bug found and fixed while building this (now written into the DOD, Multi-language
  section, so it doesn't have to be rediscovered per screen): a value interpolated into a translated
  string can visually reorder relative to the surrounding text once that sentence's language flips
  the container to `rtl`, even though `.textContent` (the logical string) stays correct throughout.
  `"{count} {unit} tracked"` rendered with `{count}` and `{unit}` visually swapped. Fixed generically
  in `t(key, vars)`: every substituted value is now wrapped in Unicode bidi isolate marks (U+2066
  LRI / U+2069 PDI) -- plain, invisible Unicode characters, so this works for a bare `.textContent`
  assignment, not just `innerHTML`. Two follow-on findings while verifying the fix, both empirical
  (confirmed with a minimal standalone repro page before touching the real app): isolating two
  adjacent placeholders SEPARATELY doesn't help when only neutral punctuation sits between them (a
  `"{scored}/{total}"` fraction still reordered) -- fixed by building the whole fraction as one
  value (`common.scoreLine`'s new `{fraction}` var) and isolating it once; and a value with NO
  strong-direction character at all (`#statAssessed`'s bare `"0.0 / 3"` ratio, no translated word
  nearby to anchor it) still gets reversed by an RTL ancestor regardless of isolation, needing its
  own explicit `dir="ltr"`. Updated three existing tests whose exact-`.textContent` assertions
  predated `t()`'s isolate marks (`test_admin_language_switch.py`, `test_tribe_hotspots.py` --
  the latter gained a small `strip_bidi()` helper other tests can reuse) -- all real breakage from a
  real (correct) behavior change, not flakes. New `test_main_screen_language.py` covers the
  translated chrome, the dir-scoping (including the session-card opt-out), the bidi-isolate fix on
  four different composite strings, and full restore on switching back to English. Full 34-file
  Playwright + 45-test unit suite passing, verified both at `TEST_JOBS=2` and serially at
  `TEST_JOBS=1` (one `test_relay_board_path_sync.py` failure seen at `TEST_JOBS=2`, reproduced as
  this file's own documented CPU-contention flake -- passed clean standalone and at `TEST_JOBS=1`,
  unrelated to this change, no relay/board-sync file touched).
- 2026-09-13 — **Story 5: translated the Spotify Squad Health Check starter template's own dimension
  content into Hebrew (label/green/red per dimension, plus its attribution line).** This is different
  from Stories 1-4's work: those translated UI CHROME (through `t()`/`data-i18n`, looked up live on
  every render); a template's dimension content is board DATA -- plain strings copied into mutable
  `state.dimensions` the moment a template is loaded, never looked up through `t()` again afterward.
  New `SPOTIFY_DIMENSIONS_HE` + `SPOTIFY_ATTRIBUTION_HE` (`state.js`), AI-translated/pending human
  review exactly like `locales/he.js`, keyed by the same stable dimension keys `PLACEHOLDER_DIMENSIONS`
  already uses (never positional) so a future reordering can't silently mismatch a translation to the
  wrong dimension. New pure `localizedStarterDimensions(dims, translations)` (`state.js`) merges a
  translation table over a base dimensions array with per-FIELD English fallback (a translation
  entry missing e.g. `red` keeps the English `red`, not a blank) -- same fallback principle as `t()`
  itself. `SPOTIFY_TEMPLATE` now carries `i18n: { he: { attribution, dimensions } }`; `loadTemplate()`
  (`templates.js`) consults it at load time under the currently-active locale and writes the
  localized content instead of the template's own English fields. Deliberately scoped as a ONE-TIME
  SNAPSHOT, not live re-translation: switching language after a template is already loaded does not
  retroactively change already-written dimensions, same as any other board content today. Explicitly
  OUT of scope (self-decided, called out here rather than assumed): the fresh-board first-boot seed
  (`PLACEHOLDER_DIMENSIONS` assigned directly to `state.dimensions`, never through `loadTemplate()`)
  stays English; the Templates-modal's own list/display-name chrome stays English (Story 8's job) --
  verified explicitly by a test assertion that `activeTemplateName` stays "Spotify Squad Health Check"
  even when Hebrew is active. Five Dysfunctions/Tuckman are untouched (their own future stories).
  **(Superseded the same day — see the correction entry right below: the ONE-TIME SNAPSHOT design
  described in this paragraph turned out to be wrong. Kept here rather than rewritten, so the record
  of what was tried and why it didn't hold up stays honest.)**
  True test-first this time, including a correction mid-flight: wrote and watched fail
  `tests/unit/test_template_locale.js` (6 tests: substitution, per-field English fallback, untouched
  when a key has no entry, no-op when no table at all, DOD-style non-blank-per-key check, non-blank
  distinct-from-English attribution) before writing `localizedStarterDimensions()` or the `i18n` data.
  For the `loadTemplate()` wiring, the implementation was written before its Playwright test by
  mistake (an ordering lapse caught immediately, not after the fact) -- corrected by stashing the
  `templates.js` change, writing the new scenario in `test_starter_template_spotify.py`, running it
  against the un-wired code to confirm it failed for the right reason (content still English), then
  popping the stash and re-running to confirm it passed. **(This specific scenario -- and the
  "one-time snapshot" claim it proved -- no longer reflects the real behavior; see the correction
  entry below. Left as-is for the honest record of the ordering-lapse correction it does still
  describe accurately.)** Also added, this session: a project-level `.claude/settings.json`
  `PreToolUse` hook (Edit/Write on `public/js/*.js`/`public/local-store.js`/`relay/*.js`, excluding
  test files) that injects a test-first reminder before any such edit -- makes the DOD's test-first
  policy a standing default for this repo rather than something each session has to remember to
  invoke; confirmed firing live during this same session's `state.js`/`templates.js` edits. Full
  suite verified: 51-test unit suite and the full 34-file Playwright suite both green, run serially
  (`TEST_JOBS=1`) with zero regressions and zero JS errors.
- 2026-09-13 — **Correction to the Story 5 entry above, from real-usage feedback the same day: the
  "one-time snapshot at load time" design was wrong.** The product owner tried it on the actual
  running app and found Hebrew dimension content never appeared at all: the DEFAULT board (the one
  every fresh session actually has) never goes through `loadTemplate()` -- it's seeded directly into
  `state.dimensions` -- so the load-time snapshot never had anything to trigger it, and switching the
  language on the default board did nothing to the dimension text. The fix isn't a missing
  `DEFAULT_CONFIG_HE` (the product owner's own initial guess at the cause) -- it's a different
  architecture entirely: dimension label/green/red and the board's `attribution` are now localized
  LIVE, at RENDER time, the same philosophy `i18n.js`'s `t()` already uses for UI chrome, rather than
  ever being baked into stored data. `loadTemplate()` (`templates.js`) reverted to always writing
  plain English (removing the locale-awareness added earlier the same day); `state.js` replaced the
  now-unused `localizedStarterDimensions()` with two render-time helpers -- `localizedDimText(dim,
  field)` and `localizedAttribution(attribution)` -- both of which refuse to translate a field an
  admin customized away from the Spotify template's own English default (exact-string match against
  `PLACEHOLDER_DIMENSIONS`/`SPOTIFY_ATTRIBUTION`), so a hand-edited dimension is never silently
  overwritten by a translation the admin didn't write. Wired into every DOM render site that displays
  a dimension's label/green/red or the attribution: `render.js` (Tribe stats hotspot, hotspot list,
  grid column headers + cell aria-labels, legend, header tooltip), `squads.js` (Squad view hotspot
  row, entry-list label/green/red/aria-label), and `modals.js` (the shared rating modal). Deliberately
  left untouched: `dimensions.js`'s Edit Dimensions list (must keep showing/editing the raw English
  value -- localizing an editable form field would silently rewrite an admin's custom text as
  translated text the moment they saved), `csv.js`'s export (re-import matching keys off the raw
  English label), and `retro-facilitator.js`/`retro-join.js` (the retro flow stays English-only until
  its own future stories, same precedent already set for `colorWordLocalized()`/`trendWordLocalized()`
  in Story 4). Two of Story 4's own existing test assertions were asserting the OLD, now-intentionally-
  wrong behavior (`test_main_screen_language.py`: `#statHotspot` and `.entry-row .entry-label` stay
  "Easy to release" under Hebrew) -- updated to expect the Hebrew text, per the DOD's standing rule
  that an assertion asserting old behavior gets updated, not preserved, when the behavior change is
  deliberate. `test_starter_template_spotify.py`'s Hebrew scenario rewritten end to end: proves the
  underlying dimension docs and `meta/config` stay English always (single source of truth), that the
  Tribe legend's label/green/red/attribution display in Hebrew immediately after just flipping the
  language switch (no template reload at all), and that switching back to English immediately restores
  English display -- live both directions, not a one-time bake-in. True test-first throughout:
  `tests/unit/test_template_locale.js` rewritten for `localizedDimText()`/`localizedAttribution()` and
  watched fail (undefined exports) before implementing; the Playwright scenario was written against
  the reverted (pre-fix) `templates.js` and watched fail for the right reason (stored English, no
  Hebrew in the DOM) before the render-site wiring went in. Full 55-test unit suite and full 34-file
  Playwright suite green, serial (`TEST_JOBS=1`), zero regressions.
- 2026-09-13 — **Fixed a real bug, reported from usage: the Tribe grid's dimension-header hover
  tooltip could get stuck open.** Root cause identified by code review: `renderGrid()` rebuilds the
  whole `<thead>` via one `innerHTML` write on every render (a teammate's live edit, a rating save, a
  language switch, ...), and the tooltip's mouseenter/mouseleave/focus/blur listeners were bound
  fresh, per `.dim-th-label` node, on every render (`bindGridHeaderTooltips()`) -- a listener bound to
  a node that a later render destroys can never fire again, so a re-render happening while a tooltip
  was open could orphan it with nothing left able to hide it. (Synthetic reproduction of the exact
  "re-render while hovering" race in headless Chromium didn't itself produce a stuck-forever state --
  this browser recomputes hover and re-fires the events on the replacement node at the same pointer
  position, which happened to self-heal the specific sequence tried -- so the precise trigger the
  product owner hit in real usage wasn't nailed down 1:1. Fixed the underlying fragility either way,
  since relying on that recompute behavior at all was never the intent.) Fix: delegated the tooltip's
  event handling to `.table-scroll` (the STABLE wrapper around `#gridTable` that renderGrid() never
  itself replaces) via `mouseover`/`mouseout` (with a `relatedTarget` check) and `focusin`/`focusout`,
  bound exactly once at load, instead of re-binding per-node on every render -- removes the whole
  failure class regardless of exact trigger. `renderGrid()` also now calls `hideDimTooltip()`
  unconditionally before every rebuild as defense in depth. New Playwright coverage in
  `test_tooltip_busy_overlay_and_csv_key.py`: hover to open the tooltip, fire a live "remote"
  dimension edit (`window.__NOTIFY__`) while still hovering (content refreshes correctly, tooltip may
  legitimately stay open since the pointer never moved), then genuinely move the pointer away and
  confirm it hides -- not orphaned by whatever render happened while it was open. Full suite verified
  green alongside the Story 5 correction above (same session, same full-suite run).
- 2026-09-13 — **Two tech-debt follow-ups from the product owner reviewing the two fixes above.**
  1. *Why didn't a test catch the missing Hebrew dimension text?* Two real, distinct gaps, not one
     "buggy test": `test_main_screen_language.py` (Story 4) asserted dimension text STAYS English
     under Hebrew (`#statHotspot`/`.entry-row .entry-label` == "Easy to release") -- correct for the
     code as designed at the time (Story 4's own deliberate, but ultimately wrong, scope decision),
     so that test wasn't lying, it was locking in a decision that needed reversing later, which is
     exactly what the correction above did. Separately, this session's OWN first Story 5 test only
     ever exercised the "explicitly reload the template via the Templates modal" path (matching the
     wrong one-time-snapshot design) -- it never tested the actual real-world path (the untouched
     DEFAULT board, just flip the language switch), which is exactly where the bug lived. A test that
     only validates its own implementation's assumption instead of the real acceptance criterion
     catches nothing. Both gaps are closed by the rewritten tests in the correction commit above,
     verified still passing here (55-test unit + 34-file Playwright, serial).
  2. *Is the Tribe grid's mouse-hover state under-tested?* The dimension-header tooltip is the ONLY
     JS-driven hover interaction anywhere in the Tribe/Squad grids (`.cell-btn:hover`'s
     `filter:brightness(1.08)` is pure decorative CSS, no JS state to test) -- and it already had
     hover/leave + keyboard focus/blur coverage, plus the re-render-race regression test added
     alongside the delegation fix above. But one real path had zero coverage even after that fix
     landed: moving the pointer DIRECTLY from one header to an ADJACENT one (no neutral "away"
     position first) -- the most common real usage (scanning across columns), and the one path that
     specifically exercises the delegated `mouseout` handler's `relatedTarget`/`.contains()` check
     the delegation fix introduced. New scenario in `test_tooltip_busy_overlay_and_csv_key.py`: hover
     "release", hover "process" directly (no gap), confirm the tooltip updates to "Suitable process"
     (not stuck on the old content), then confirm a genuine leave afterward still hides it. Full suite
     verified green (55-test unit + 34-file Playwright, serial `TEST_JOBS=1`).
- 2026-09-13 — **Multi-language rollout Stories 6-9: app header/nav chrome, Tuckman + Five
  Dysfunctions template content, and the Templates modal's own chrome.**
  - **Story 6 (header/nav):** new `#appHeader` id on `<header class="top">`, added to
    `RTL_SCOPED_CONTAINERS`. New `header.*` locale keys for the tagline (now `t()`-driven instead of
    hardcoded string concatenation in `render.js`'s `renderHeader()`), the sync-status text
    (`db.js`'s `setSyncStatus()`), "Join a retro"/"← Back to my retro", and the Tribe/Squad/Admin
    view-switch buttons. `header.appName` ("Squad Pulse") is a deliberate BRAND-NAME PASS-THROUGH --
    same literal value in every locale, still routed through `t()` so it satisfies "every string on
    an i18n-supported screen goes through `t()`" mechanically without translating a proper noun; the
    model badge (a TEMPLATE's own display name) is correctly untouched (Story 9's territory, not
    this one's). New `tests/test_header_language.py`.
  - **Stories 7-8 (Tuckman / Five Dysfunctions dimension content):** required generalizing Story 5's
    `localizedDimText()`/`localizedAttribution()` FIRST -- they were hardcoded to `SPOTIFY_TEMPLATE`
    specifically. New `activeStarterTemplate()` (`state.js`) looks up whichever `STARTER_TEMPLATES`
    entry is active BY NAME and uses THAT template's own `.i18n` table, so any starter template that
    declares one gets live-render-time translation for free, no per-template special-casing at any
    render call site. Proven with a throwaway synthetic template in
    `tests/unit/test_template_locale.js` BEFORE writing the generalization (watched fail), and the
    old Spotify-specific tests rewritten to run generically across every `STARTER_TEMPLATES` entry
    that declares `.i18n` (Tuckman/Five Dysfunctions join the DOD-parity checks automatically the
    moment they declare one -- no test-code changes needed per template going forward). New
    `TUCKMAN_DIMENSIONS_HE`/`TUCKMAN_ATTRIBUTION_HE` and
    `FIVE_DYSFUNCTIONS_DIMENSIONS_HE`/`FIVE_DYSFUNCTIONS_ATTRIBUTION_HE` (`state.js`), same
    AI-translated/pending-human-review status and label/green/red-only scope as Spotify's (not
    `.statements`/`.strategies` -- nothing outside the retro statement-survey flow reads those, and
    that flow stays English by design, see below). New scenarios appended to
    `tests/test_scored_template_tuckman.py`/`tests/test_scored_template_five_dysfunctions.py`:
    switching to Hebrew shows Hebrew content in the Tribe legend live (no reload), stored dimension
    docs stay English always, and -- for Tuckman, which that file already has a live retro session
    running -- the ALREADY-STARTED session's participant-facing results stay English, since the retro
    flow itself is still untranslated (its own future story), same precedent Story 5 established.
  - **Story 9 (Templates modal chrome):** new `templates.*` locale keys for the modal's title/hint,
    "Starter templates"/"Your templates" headings, Load/Delete buttons and their confirm dialogs, the
    save-as-template row, Close, the busy-overlay "Switching to..." message, and the per-row meta
    line (dimension count/unit/scored-count, now correctly bidi-isolated via `t()`'s interpolation --
    fixed one existing test, `test_starter_template_spotify.py`, whose exact-substring assertion on
    that line predated the isolate marks, same category of fix the DOD already documents). Template
    NAMES and a starter template's own dimension content stay untouched, per the same "admin's own
    content, not app chrome" principle as a manually customized dimension. `templatesBackdrop` added
    to `RTL_SCOPED_CONTAINERS`. **Real bug caught before it shipped, not after:** `templates.js`
    named its template-object parameter/local variable `t` throughout (`templateRowHtml(t, opts)`,
    `loadTemplate(t)`, a `var t = findAnyTemplateById(id)` inside `renderTemplateList()`) -- which
    SHADOWS the global `t()` translation function for the rest of that scope. Calling `t("some.key")`
    inside a scope where `t` had been reassigned to a template object would have thrown a TypeError
    at runtime the moment Hebrew was active and that code path ran. Caught while writing this
    story's own i18n wiring, before ever running it, by recognizing the naming collision -- fixed by
    renaming every template-object reference in the file to `tpl` (verified via `grep` that no `t`
    binding remains anywhere in `templates.js` besides the explanatory comment). New
    `tests/test_templates_language.py`.
  - All four stories' Playwright tests were written and watched fail for the right reason before
    their implementation landed, per this repo's test-first policy. Full suite verified: 65-test unit
    suite and the full 36-file Playwright suite (2 new files this session), run entirely serially
    (`TEST_JOBS=1`, no parallelization, per explicit instruction), zero regressions after one real
    fix along the way (the bidi-isolate assertion above).
- 2026-09-13 — **Delivery workflow change: `claude/optimistic-keller-holuql` is now a shared preview
  branch, not a workspace every session commits straight to.** Prompted by real, repeated pain, not a
  hypothetical: two concurrent Claude Code sessions (this relay/testing work and the multi-language
  rollout above) plus a local VSCode checkout all pushed directly to this one branch throughout the
  day, colliding several times -- each collision needing a manual `git fetch` + merge to untangle
  (documented earlier this same log: a full commit-graph forensic trace of exactly when each session's
  local HEAD went stale relative to the other's pushes, confirming the pattern was symmetric and
  unavoidable under "everyone commits straight to one branch," not a sign either side was failing to
  pull). Considered three options: leave it as-is (kept failing), tighten how often each session
  fetches (reduces the WINDOW but not the possibility), or give each session its own short-lived
  branch merged deliberately into a shared trunk (chosen). New rule, in `docs/DefinitionOfDone.md`'s
  Delivery workflow section (not duplicated here): branch from the current tip of
  `claude/optimistic-keller-holuql` for a unit of work, merge the latest back in and re-validate before
  merging out, never commit to the shared branch mid-work. `main` promotion is unaffected -- still
  solely the product owner's call, unchanged by this.
- 2026-09-14 — **Fixed a real bug, reported from usage, that turned out to have nothing to do with
  translation: loading Tuckman's template left the dimension grid correctly showing Tuckman's 5
  stages, but the model name/attribution regressed back to Spotify's.** First suspected as an i18n
  gap (same shape as the Story 5 bug); ruled that out by reproducing against the real `index.html` +
  real `local-store.js` with no relay involved at all -- worked perfectly. The actual reproduction
  needed a REAL relay subprocess: **board sync is default-on for every device** (STATUS.md's "Board
  sync" plan, step 7), and `templates.js`'s `loadTemplate()` writes the new dimension docs and the
  new `meta/config` doc as two SEPARATE Firestore-like operations. Each one independently fires a
  `db.js` `onSnapshot` listener that calls `pushBoardSnapshotIfConnected()` -- so the instant the new
  dimension docs land (before the config write follows), a push escapes built from `state` at that
  exact moment: the NEW dimensions, but still the OLD config. With a live subscription open (which
  every default-on device has, to its own default room -- no explicit team link needed to hit this),
  that inconsistent intermediate snapshot echoes straight back and `board-sync.js`'s
  `applyRemoteBoardSnapshot()` rewrites the local `meta/config` to match it, regressing
  `activeTemplateName`/`attribution` to the PREVIOUS template. `board-sync.js` already had an
  established guard for exactly this class of problem -- the `hydrating` flag suppresses pushes while
  a multi-doc REMOTE snapshot is being applied -- but nothing equivalent existed for a multi-doc LOCAL
  rewrite. New `suppressBoardPushDuring(work)` (`board-sync.js`): a second flag
  (`suppressingLocalRewrite`, checked alongside `hydrating` in `pushBoardSnapshotIfConnected()`'s
  guard) rather than reusing `hydrating` itself, since that flag carries `pendingRemoteApply`
  bookkeeping this case has no use for; fires exactly one consistent push once the wrapped work
  settles (success or failure). `loadTemplate()`'s live-mode branch now wraps its whole
  delete-dimensions → write-dimensions → write-config sequence in it. True test-first: new
  `tests/test_board_sync_template_switch_race.py` spins up a real `relay/server.js` subprocess
  (board sync can't be reproduced against the fake store or a relay-less `local-store.js` -- both
  silently no-op the push/hydrate calls this bug lives in), loads Tuckman while connected, and
  watched it fail for the right reason (`activeTemplateName` regressed to Spotify's, dimensions
  correctly Tuckman's) before the fix, then confirmed passing after -- including that a page RELOAD
  picks up the same correct state from the relay, not a regressed one. Full suite verified: 65-test
  unit suite and the full 37-file Playwright suite (1 new file), serial (`TEST_JOBS=1`), zero
  regressions.
- 2026-09-14 — **Multi-language rollout Stories 10-12: retro join flow, retro facilitation flow,
  and the Edit Dimensions modal.** Each done on its own short-lived branch off
  `claude/optimistic-keller-holuql` per the new delivery workflow, merged back after full-suite
  validation.
  - **Story 10** (`retro-join.js`, `#viewJoin`, `#joinCodeBackdrop`): the "Join a retro" code-entry
    modal, the join screen's connecting/ended/unreachable/not-open states, the survey form chrome
    (scale buttons, the "Squad health check" sub-heading, Green:/Red: anchors reusing the Tribe
    legend's own labels, swatch titles, Submit), and the personal-result screen. Replaced the join
    heading's hardcoded `dir="ltr"` (a workaround for mixing untranslated English chrome with a
    Hebrew squad name) with `t()`'s own bidi-isolate wrapping now that the whole sentence
    translates and `#viewJoin`/`#joinCodeBackdrop` are RTL-scoped.
  - **Story 11** (`retro-facilitator.js`): the session card (no-session hint + Start button,
    session code block, live/hold reveal toggle, live results / results held, the
    response-consolidation table, sprint-experiment note, finish/close buttons), the per-dimension
    override editor (shares the rating modal's markup), the co-facilitate error paths, and every
    confirm dialog. Dropped the session card's hardcoded `dir="ltr"` opt-out now that its own
    chrome translates -- it inherits RTL scoping from `#viewSquad` (Story 4) like the rest of
    Squad view.
  - **Story 12** (`dimensions.js`, `#dimBackdrop`): the modal's title/hint, per-row move/remove
    control titles, the name input's aria-label/placeholder, the Green/Red looks-like labels and
    placeholders, the statement-count hint, Add/Done buttons, the empty-state hint, and the remove
    confirm dialog.
  - **Consistent scope boundary across all three**, same principle Story 9 established for
    template names: dimension/session content itself (label/green/red/statement text, a freshly
    added dimension's default "New dimension" label) stays untranslated -- it's the admin's own
    authored content, not app chrome. `colorWordLocalized()`/`trendWordLocalized()` (i18n.js) --
    previously unused outside Tribe/Squad view because Stories 10-11 weren't done yet -- are now
    used by both retro files for band/pill/trend vocabulary, replacing hardcoded English ternaries.
  - Four now-stale exact-text assertions in pre-existing tests needed updating, all for the same
    reason (`t()`'s bidi-isolate wrapping around a newly-translated interpolated value, or a
    dropped `dir="ltr"` opt-out) -- not new bugs, just tests written before these strings went
    through `t()`: `test_hebrew_rtl_coverage.py` (join heading selector/direction),
    `test_main_screen_language.py` (session-card dir/heading), `test_retro_override_and_response_table.py`
    and `test_retro_reveal_mode_and_consolidation.py` (response-row-label / count-line
    `startswith`), `test_scored_template_five_dysfunctions.py` (statement-count hint substring).
  - New test files, one per story: `test_join_flow_language.py`, `test_facilitator_language.py`,
    `test_dim_manager_language.py`. Full suite verified after each story and again at the end:
    65-test unit suite, 42-file Playwright suite, zero regressions.
  - Backlog table: Stories 1-12 now **DONE**. Story 13 (CSV import/export chrome) remains --
    deliberately last, since `csv.js`'s column-matching/re-import logic keys off raw English
    labels and needs its own design pass, not just a translation pass.
- 2026-09-14 — Copilot (via VSCode) profiled the full sequential suite and flagged the ten
  slowest Playwright files, most of it fixed `wait_for_timeout()` calls with no causal link to
  the thing being waited for. Assessed as a legitimate, safe optimization (not a new
  architecture, unlike the earlier no-browser integration-tier proposal this repo already
  rejected) because `local-store.js`'s subscription notify genuinely runs on a `setTimeout(0)`
  tick -- these waits aren't purely decorative, they're covering a real one-tick async gap, just
  with a guessed constant instead of a real completion signal. Piloted the fix on
  `test_hebrew_rtl_coverage.py` (Copilot's #2-ranked file) on its own short-lived branch
  (`claude/perf-condition-waits`) per the delivery workflow: removed every `wait_for_timeout()`,
  relying on Playwright's own auto-wait on `click()`/`fill()` where the next action was one of
  those (redundant already), and adding `wait_for_selector()`/`wait_for_function()` only where
  the next call was `query_selector()`/`eval_on_selector()`/`evaluate()` (none of which auto-wait).
  Found two real bugs empirically, not by inspection, via a 10x stress-test loop: `wait_for_selector`
  defaults to `state="visible"`, which hung when the first DOM-order match was a hidden duplicate
  of near-identical markup from an inactive (but still-mounted) view, or sat inside a collapsed
  `<details>` not yet expanded -- both fixed with `state="attached"`, matching what
  `eval_on_selector`'s own DOM-presence-only semantics already assumed everywhere in this test.
  Result: ~8.5s -> ~3.2-3.5s per run locally, 10/10 clean, then re-verified against a same-file
  merge from the concurrent i18n session (Stories 10-12) and the full 41-file suite, zero
  regressions. Deferred the rest of Copilot's list (other flagged files, duration-aware shard
  balancing, shared-browser-per-worker) rather than batching them in -- each file needs the same
  per-site empirical verification this one took, not a mechanical find-and-replace.
- 2026-09-14 — **Fixed a real bug, reported from usage with screenshots: a retro participant's join
  screen stayed English even when the facilitator had switched the whole app to Hebrew before
  starting the session.** Root cause: `state.ui.locale` (i18n.js) is pure per-device UI state, saved
  only to that one browser's own `localStorage` -- never part of what a session/join link carries, so
  a brand-new device (no prior localStorage) always booted at the "en" default regardless of the
  facilitator's own choice. The only workaround was exiting the join screen, digging into Admin,
  switching languages, then tapping "back to my retro" to return -- real friction the product owner
  called out directly. Fixed with the same shape as the existing team-sync-via-join-link mechanism:
  `joinUrlFor()`/`coFacilitateUrlFor()` (`helpers.js`) now also carry the facilitator's CURRENT
  locale as a `&lang=` param (new `langParamFor()`, omitted entirely for the "en" default so an
  all-English board's links are unchanged); `state.js`'s boot-time `loadUiPrefs()` applies it, but
  ONLY as a fallback default when this device has no locale of its own already saved -- an existing
  preference always wins, and a device that picks one up this way remembers it as its own from then
  on (persisted to `localStorage`), so it doesn't need re-discovering on a later, un-tagged visit.
  New `tests/test_join_link_carries_language.py` covers all three cases: the link carries `&lang=he`
  only while the facilitator is on Hebrew, a fresh device opening a Hebrew-tagged link boots straight
  into Hebrew with no exit/switch/return needed, and a device with its own already-saved preference
  is never overridden. Full suite verified: 65-test unit suite, 43-file Playwright suite, zero
  regressions.
  - **Still open, raised by the same usage report, needing a product decision rather than a code fix
    yet:** (1) the retro survey's actual STATEMENT/strategy text (e.g. Tuckman's/Five Dysfunctions'
    20 assessment statements) has never been translated -- Stories 5/7/8 deliberately scoped
    dimension-content translation to label/green/red/attribution only, explicitly excluding
    `.statements`/`.strategies` (see `state.js`'s own header comments on `TUCKMAN_DIMENSIONS_HE`/
    `FIVE_DYSFUNCTIONS_DIMENSIONS_HE`), so there is no Hebrew statement text anywhere to show yet --
    translating it is a real, scoped addition (new AI-translated content needing the same
    pending-human-review treatment as the existing translations), not a bug in Stories 10/11's own
    work. (2) The Edit Dimensions modal (Story 12) shows a dimension's name/green/red as the raw
    STORED English value even under Hebrew, unlike Tribe/Squad view's live-localized read-only
    display (Story 5/7/8) -- this is intentional, not an oversight: `localizedDimText()`'s safety
    check only auto-translates a field while its stored value still exactly matches the template's
    own English default, and Edit Dimensions is an EDIT surface -- showing translated text in an
    editable input risks the admin saving that Hebrew text back as the new "customized" value,
    permanently breaking the live-translation match for every other viewer (including a future
    English-locale one). Surfaced to the product owner as a real but consciously-made tradeoff worth
    a second look, not silently fixed either way.
- 2026-09-14 — **Translated the retro survey's own statements/strategies (Tuckman + Five
  Dysfunctions), closing the open item raised by the join-link-language usage report above.**
  Product owner approved translating them after that report's screenshots showed the join screen's
  chrome in Hebrew but the actual survey questions ("Team members are still learning about each
  other's roles...") still English -- Stories 5/7/8 had deliberately scoped dimension-content
  translation to label/green/red/attribution, explicitly excluding `.statements`/`.strategies`.
  Added Hebrew translations for both templates' full statement/strategy arrays to
  `TUCKMAN_DIMENSIONS_HE`/`FIVE_DYSFUNCTIONS_DIMENSIONS_HE` (`state.js`), same array shape/order as
  the English default (read by index -- see `retro-join.js`'s `interleavedStatements()`). Extended
  the localization mechanism itself along the way: `dimensionValuesMatch()` replaces the
  reference-equality (`!==`) customization check with a value-based one for array fields --
  reference equality would wrongly treat a value-identical-but-different-array-instance statements
  list (exactly what happens once a value round-trips through a session doc's own JSON-shaped
  storage/relay transport) as "the admin customized this," permanently blocking translation, a bug
  class label/green/red's plain-string fields never had. New `localizedSessionDimText()` (sharing
  `localizedFieldForTemplate()`'s core logic with `localizedDimText()`) is keyed off a retro
  SESSION's own frozen `templateName` rather than the live board's currently active template --
  `openSessionOverrideEditor()` already documented why a session can't just reuse
  `activeStarterTemplate()` (the board's template may have moved on since the session started);
  this generalizes that same reasoning into the translation lookup itself. Wired into every
  session-scoped dimension field read in `retro-join.js` (interleaved statement text, a
  direct-rating dimension's openly-shown label/green/red, the personal-result screen's
  label/message/strategies) and `retro-facilitator.js` (live result dimension names, the response
  table header, the override editor, the finish-confirm summary) -- a Hebrew-speaking facilitator
  now sees the same consistently-translated retro their Hebrew-speaking teammates do. New
  `tests/test_retro_statement_language.py`; extended `tests/unit/test_template_locale.js` with
  `localizedSessionDimText()` coverage and a mechanical statements/strategies length+non-blank
  check alongside the existing label/green/red one. Full suite verified: 69-test unit suite,
  44-file Playwright suite, zero regressions.
  - **Still open from the same usage report, by the product owner's own choice (not yet designed):**
    letting an admin edit BOTH the English and Hebrew text of a dimension at the template level --
    a genuine architecture change (today's translation tables are hardcoded template constants, not
    editable board data) the product owner asked to see a design proposal for before any
    implementation starts.
- 2026-09-14 — Second file in the condition-based-wait perf pass (see the 2026-09-14 entry above
  on `test_hebrew_rtl_coverage.py` for the full rationale): `test_template_switching_and_csv_import.py`
  (Copilot's #9-ranked file), on its own short-lived branch. Same treatment -- removed every
  `wait_for_timeout()`, relying on `click()`/`fill()`'s own auto-wait where the next action was one
  of those, and adding `wait_for_selector()`/`wait_for_function()` only where the next call was
  `query_selector()`/`eval_on_selector()`/`evaluate()`. Unlike the RTL file, this one needed no
  `state="attached"` correction -- clean on the first 10x stress-test pass, likely because this
  file's post-action reads are mostly `evaluate()` polls on `window.__FAKE_STORE__` fields
  (`wait_for_function`, no visibility concept at all) rather than `eval_on_selector()` calls whose
  selectors happened to also match hidden markup elsewhere. Result: ~5.25s -> ~1.6-2.0s per run
  locally, 10/10 clean, then the full 43-file suite (69-test unit suite included), zero
  regressions.
- 2026-09-14 — Third file in the condition-based-wait perf pass: `test_tribe_hotspots.py`
  (Copilot's #3-ranked file), on its own short-lived branch. Same treatment. The `rate()` helper's
  5-click chain needed no waits at all -- Playwright's `click()` auto-waits on every step, and
  nothing reads state between the 7 calls to it, so the whole chain just needed to be left alone.
  One read needed care beyond a plain "did the element land" check: after the 7 ratings,
  `#statHotspot` already held content from the earlier "None yet" case, so simple selector
  presence wasn't a real completion signal for the POST-rating value -- polled
  (`wait_for_function`) for the actual expected text instead, the same value the assertion right
  after it re-checks (the same pattern this repo's own `wait_for_scored()` helper already uses
  elsewhere for a comparable "wait for the real end-state, not just some transition" case).
  Result: ~7.2s -> ~2.3-2.6s per run locally, 10/10 clean, then the full 43-file suite, zero
  regressions.
- 2026-09-14 — Fourth file in the condition-based-wait perf pass: `test_tooltip_busy_overlay_and_csv_key.py`
  (Copilot's #4-ranked file), on its own short-lived branch. This one caught a genuinely new
  failure mode, not just a repeat of `state="attached"`: `showBusy()`/`hideBusy()` (`modals.js`)
  bracket a Promise chain (`templates.js`'s `loadTemplate()`) that this fake store resolves fast
  enough to complete within the SAME JS turn as the click that triggers it. A `wait_for_function`
  polling for `busyOverlay.hidden === false` -- an EXTERNAL CDP call that only gets a turn once the
  page's own microtask queue drains -- timed out 15/15, because by the time any external poll runs,
  `hideBusy()` has usually already fired too. This is exactly what the file's own top-of-file
  comment already warned about ("polling at an arbitrary later point would otherwise likely just
  see the already-hidden end state") -- confirmed empirically the hard way instead of heeding it
  up front. `__busyHistory`, recorded by a `MutationObserver` running on the PAGE's own timeline
  rather than an external poll, is the only reliable record of that transient show; the fix waits
  for the cycle to fully settle (`hidden === true`) and reads the recorded history, rather than
  trying to catch the shown moment live. Every hover/focus/blur tooltip check got a
  `wait_for_function` tied to `dimTooltip`'s hidden state or exact expected content (those handlers
  run synchronously, so these resolve near-instantly); the three CSV-import waits became
  `pendingImportPlan !== null` polls, same as the other files in this pass. Result: ~6.9s -> ~2.1-2.2s
  per run locally, 15/15 clean (a bigger stress-test batch than the first three files, given the
  event-timing sensitivity here), then the full 43-file suite, zero regressions.
- 2026-09-14 — **Bilingual dimensions: made a dimension's Hebrew translation a real, editable field
  on the dimension itself, replacing the hardcoded template-level lookup table.** Product owner
  approved this from a working mockup (an Artifact reusing the app's real design tokens, with the
  actual toggle/expand interaction built rather than described — see the new Delivery-workflow
  policy this prompted, below) rather than a text proposal, then asked for it to be built along
  with two of the mockup's own open questions resolved: survey statements/strategies get the same
  EN+HE editing (not just label/green/red), and a third UI language is explicit backlog (YAGNI for
  now, recorded in the "Deliberately not built yet" table).
  - **The redesign itself** (`state.js`): `localizedDimText(dim, field)` now reads
    `dim.i18n.he.<field>` directly off the dimension object handed to it — no more matching the
    dimension's CURRENT value against a template's own English default to decide whether to
    translate. That old mechanism (Stories 5/7-9's `activeStarterTemplate()`-keyed lookup, and
    Stories 10/11's session-scoped `localizedSessionDimText()`/`starterTemplateByName()`
    variant, both now removed) was fragile in exactly the way a real usage report eventually
    surfaced: an array field (statements) round-tripping through a session doc's JSON-shaped
    storage broke reference-equality matching, and it could never be extended to a custom/saved
    template or a hand-edited dimension. The three built-in starter templates' own `dimensions[]`
    entries now each carry their own `i18n.he` (folding in the existing
    `SPOTIFY_DIMENSIONS_HE`/`TUCKMAN_DIMENSIONS_HE`/`FIVE_DYSFUNCTIONS_DIMENSIONS_HE` tables by
    reference, so no translated content was retyped) — these seed a dimension's translation the
    moment a starter template is loaded, but from there on it's the dimension's own editable data,
    same as label/green/red, carried forward by `loadTemplate()`, `saveCurrentAsTemplate()`, and
    `startSession()`'s session snapshot wherever the dimension itself travels. Array-field
    fallback (statements/strategies) is per-ELEMENT, not per-whole-array — the new editor lets an
    admin translate one statement at a time, so a real Hebrew array is very often partially
    filled, and an all-or-nothing fallback would show a blank line for every untranslated entry
    instead of its English text.
  - **Two real bugs found while wiring the redesign through the LIVE (relay-shaped) write path**,
    neither visible from the pure-logic unit tests alone: (1) `db.js`'s dimensions AND templates
    `onSnapshot` listeners both explicitly rebuild "brand-new plain objects" from each frozen
    `doc.data()` snapshot (deliberately, so `state.dimensions`/`state.templates` entries can be
    edited in place later) — and both listeners' explicit field lists dropped `i18n` entirely, so
    a just-saved translation echoed back through the device's own live subscription and vanished
    on the very next snapshot. (2) Once (1) was fixed by copying `data.i18n` across, a SECOND edit
    to the same dimension (e.g. green after label) started throwing, because `data.i18n` is nested
    inside the frozen snapshot clone — assigning it by reference (rather than cloning it) handed
    `dimensions.js` a frozen object it then tried to mutate in place on the next keystroke.
    Fixed by reusing `board-sync.js`'s existing `plainClone()` helper (built for the identical
    "frozen nested data, later edited in place" hazard in the opposite data-flow direction) rather
    than inventing a second deep-clone utility.
  - **The Edit Dimensions modal** (`dimensions.js`): every dimension row gets a collapsible
    "🇮🇱 Add a Hebrew translation" / "Hebrew translation — added" panel (open by default once a
    translation exists, closed by default otherwise, and the open/closed choice survives the
    full-innerHTML-rebuild every edit already triggers via a small `openI18nPanels` map keyed by
    dimension key) holding Hebrew label/green/red fields alongside the English ones. Survey
    statements/strategies are no longer read-only in either language: each renders as one input
    per item, English inline in the row and Hebrew inside the translation panel, aligned by index
    (a Hebrew array is padded to the English array's length before writing, so translating item
    #1 before #0 never leaves #0 as `undefined`).
  - New `tests/test_bilingual_dimension_editor.py` (Playwright) covers the full loop: an
    untranslated dimension's collapsed toggle and blank fields, filling one in and seeing it
    localize live in Tribe view, a Tuckman dimension's pre-filled/already-open panel naming its
    source template, and editing statements/strategies in both languages without disturbing
    sibling items. Rewrote `tests/unit/test_template_locale.js` for the new, simpler
    `localizedDimText()` contract (dropped every test of the removed session/template-matching
    machinery, added per-element array-fallback coverage). Updated `tests/fixtures/fake_store.html`
    and `public/local-store.js`'s seed data to carry the same per-dimension `i18n` shape a real
    board now has (`fake_store.html` deliberately leaves two of its three seeded dimensions
    untranslated, so tests needing a genuine "no translation yet" example still have one).
    Fixed four now-stale assertions in existing tests that depended on the removed
    template-level `i18n.he.dimensions` shape or the old read-only statements hint.
  - Full suite verified: 69-test unit suite, 44-file Playwright suite, zero regressions.
  - **New Definition-of-Done policy this round prompted** (`docs/DefinitionOfDone.md`'s Delivery
    workflow section): a genuine architecture/UX decision gets a working, interactive mockup built
    from the app's real design tokens before implementation starts, not a text description — this
    is specifically why the proposal above got a fast, confident "go ahead" rather than a round of
    clarifying questions. Also added: a new data shape must explicitly say whether it needs a
    migration path for existing stored data, even when the honest answer (as here) is "not yet,
    nothing real depends on the old shape."
- 2026-09-14 — Second file in the condition-based-wait perf pass (see the 2026-09-14 entry above
  on `test_hebrew_rtl_coverage.py` for the full rationale): `test_template_switching_and_csv_import.py`
  (Copilot's #9-ranked file), on its own short-lived branch. Same treatment -- removed every
  `wait_for_timeout()`, relying on `click()`/`fill()`'s own auto-wait where the next action was one
  of those, and adding `wait_for_selector()`/`wait_for_function()` only where the next call was
  `query_selector()`/`eval_on_selector()`/`evaluate()`. Unlike the RTL file, this one needed no
  `state="attached"` correction -- clean on the first 10x stress-test pass, likely because this
  file's post-action reads are mostly `evaluate()` polls on `window.__FAKE_STORE__` fields
  (`wait_for_function`, no visibility concept at all) rather than `eval_on_selector()` calls whose
  selectors happened to also match hidden markup elsewhere. Result: ~5.25s -> ~1.6-2.0s per run
  locally, 10/10 clean, then the full 43-file suite (69-test unit suite included), zero
  regressions.
- 2026-09-14 — Third file in the condition-based-wait perf pass: `test_tribe_hotspots.py`
  (Copilot's #3-ranked file), on its own short-lived branch. Same treatment. The `rate()` helper's
  5-click chain needed no waits at all -- Playwright's `click()` auto-waits on every step, and
  nothing reads state between the 7 calls to it, so the whole chain just needed to be left alone.
  One read needed care beyond a plain "did the element land" check: after the 7 ratings,
  `#statHotspot` already held content from the earlier "None yet" case, so simple selector
  presence wasn't a real completion signal for the POST-rating value -- polled
  (`wait_for_function`) for the actual expected text instead, the same value the assertion right
  after it re-checks (the same pattern this repo's own `wait_for_scored()` helper already uses
  elsewhere for a comparable "wait for the real end-state, not just some transition" case).
  Result: ~7.2s -> ~2.3-2.6s per run locally, 10/10 clean, then the full 43-file suite, zero
  regressions.
- 2026-09-14 — Fourth file in the condition-based-wait perf pass: `test_tooltip_busy_overlay_and_csv_key.py`
  (Copilot's #4-ranked file), on its own short-lived branch. This one caught a genuinely new
  failure mode, not just a repeat of `state="attached"`: `showBusy()`/`hideBusy()` (`modals.js`)
  bracket a Promise chain (`templates.js`'s `loadTemplate()`) that this fake store resolves fast
  enough to complete within the SAME JS turn as the click that triggers it. A `wait_for_function`
  polling for `busyOverlay.hidden === false` -- an EXTERNAL CDP call that only gets a turn once the
  page's own microtask queue drains -- timed out 15/15, because by the time any external poll runs,
  `hideBusy()` has usually already fired too. This is exactly what the file's own top-of-file
  comment already warned about ("polling at an arbitrary later point would otherwise likely just
  see the already-hidden end state") -- confirmed empirically the hard way instead of heeding it
  up front. `__busyHistory`, recorded by a `MutationObserver` running on the PAGE's own timeline
  rather than an external poll, is the only reliable record of that transient show; the fix waits
  for the cycle to fully settle (`hidden === true`) and reads the recorded history, rather than
  trying to catch the shown moment live. Every hover/focus/blur tooltip check got a
  `wait_for_function` tied to `dimTooltip`'s hidden state or exact expected content (those handlers
  run synchronously, so these resolve near-instantly); the three CSV-import waits became
  `pendingImportPlan !== null` polls, same as the other files in this pass. Result: ~6.9s -> ~2.1-2.2s
  per run locally, 15/15 clean (a bigger stress-test batch than the first three files, given the
  event-timing sensitivity here), then the full 43-file suite, zero regressions.
- 2026-09-14 — **Added a translation export script for the product owner's own review workflow**
  (`scripts/export-template-translations.js`), the last item from the same usage-report follow-up
  as the bilingual-dimensions work above. Every starter template's dimension content is marked
  "AI-translated, pending human review" in `state.js`'s own comments -- this gives the product
  owner a plain JSON file (English and Hebrew side by side, per field, for every dimension of every
  starter template, including statements/strategies) to review and correct instead of editing
  state.js's hardcoded JS objects directly. Deliberately export-only: applying an edited file back
  is a Claude-assisted step (read the file, edit `state.js`), not an automated importer -- state.js
  is source code, not data a script should rewrite unattended. Output path defaults to
  `translations-export.json` at the repo root (gitignored -- a regenerate-on-demand scratch file,
  never checked in). Checked this repo (both branches) for a "revised JSON export format" the
  product owner mentioned another session was working on, specifically to align this script's shape
  with it if relevant -- found no trace of it here (no other branch, no committed file referencing
  it), so this export uses its own straightforward shape for now; worth reconciling once that other
  session's work is visible here.
- 2026-09-14 — Fifth file in the condition-based-wait perf pass: `test_cofacilitator_join.py`
  (Copilot's #5-ranked file, and the first RELAY-backed/multi-device file this pass has touched),
  on its own short-lived branch. Same treatment for the click chains and content-dependent reads
  (device D's session card landing, the confirm dialog's dismissal state, and -- the load-bearing
  fix here -- device B's live tally actually containing device C's real submission after a genuine
  relay round trip, tied to the exact text asserted right after rather than a flat 500ms guess).
  `#teamLinkInput`'s value also got a real poll instead of a guess, since it's populated by
  `crypto.subtle`-based key generation -- a real, non-instant async browser API, unlike this fake
  store's near-instant local writes.
  Deliberately left two waits untouched, matching this repo's own established precedent
  (`test_board_sync_finish_retro_convergence.py`'s comments on the identical pattern): the settle
  wait right after each of device B and device C opening device A's team link fresh. No documented
  DOM-based signal exists yet for "this device has finished adopting a team it just opened via
  URL," and getting that wrong on a relay-backed, cross-device write path risked a worse, harder-to
  -diagnose failure than the modest time these two waits cost -- unlike the other conversions in
  this pass, which only ever risked a slower/more-verbose failure if wrong.
  Result: ~7.4s -> ~4.6-5.0s per run locally (a more modest cut than the four purely-local files,
  expected given the two intentionally-kept waits), 15/15 clean (matched the bigger stress-test
  batch used for the tooltip file, given the relay/multi-device stakes here). Landed via a real
  merge, not a fast-forward, since Stories 13-14 (bilingual dimension editor, CSV import/export
  chrome) merged into the shared branch while this was in progress -- re-verified against that
  merged state: 5x stress-test rerun clean, full 44-file suite (69-test unit suite included), zero
  regressions.
- 2026-09-14 — **Fixed a real deadlock in 12 relay-backed Playwright test files**, found live: a
  full regression run was stuck for 55+ minutes on `test_board_sync_hydrate_on_boot.py` (normally
  finishes in under 2 minutes). Root cause: every relay-backed test's `wait_for_port()` gives the
  `node server.js` subprocess a 5s window to start listening; on timeout, the error path calls
  `relay_proc.stdout.read()` to include the relay's own output in the raised `RuntimeError` — but
  `.read()` blocks until EOF, and a relay process that's simply running LATE (confirmed via `lsof`:
  it did bind the port, just after the 5s window closed, under `-P 2` CPU contention from the
  parallel suite) never closes its stdout, since it's a live server, not a process that exits.
  Confirmed via `/proc/<pid>/stack` showing the Python process blocked in `anon_pipe_read`, reading
  a pipe whose write end (`node`'s stdout/stderr) was still held open by a very-much-alive relay
  process. Fix, applied identically to all 12 relay-backed test files: `.terminate()` (then
  `.wait(timeout=5)`, falling back to `.kill()`) the relay process BEFORE reading its stdout, so
  the pipe is guaranteed to hit EOF. Verified the happy path still passes standalone, then re-ran
  the full suite fresh (69 unit tests + full Playwright regression) to confirm zero regressions from
  the fix itself, on its own short-lived branch.
- 2026-09-14 — Copilot perf pass, file 6/9: `test_retro_join_flow.py`. Replaced nearly all
  `wait_for_timeout()` calls with real conditions: `wait_for_selector(state="attached")` for reads
  via `query_selector()`/`eval_on_selector()` after a per-squad detail render or a native
  `<details>` toggle (both synchronous once the target lands, so the only real gap is DOM
  attachment -- confirmed the QR/diag-log content in question was already rendered into the
  collapsed-but-attached markup, not built lazily on open), `state="visible"`/`"hidden"` for the
  join-code modal's own open/close toggles, and `wait_for_function()` polling
  `window.__FAKE_STORE__` for session-doc writes (the fake store's `set()`/`update()` write
  synchronously, but the wait verifies the actual condition -- a specific session's status, or a
  fresh key landing -- rather than assume that timing holds). A few click-then-click chains with no
  intervening read needed no wait at all, since `click()`/`fill()` already auto-wait for their own
  next target to become actionable. Kept exactly one fixed wait: after the copy-join-link button,
  since `navigator.clipboard.writeText()` rejects asynchronously without clipboard permissions in
  this headless run, and that rejection surfacing as a `pageerror` is precisely what the following
  assertion checks -- there's no DOM signal to poll for it instead. Verified byte-for-byte identical
  output against the original (aside from randomized session codes/timestamps), then stress-tested
  10x clean at ~2.9-3.1s per run (down from ~6.6s). Landed via a fast-forward-then-merge onto the
  preview branch after the relay-deadlock fix above landed concurrently; re-verified the merged
  state: 5x stress-test rerun clean, full 44-file Playwright suite, and the 69-test unit suite, zero
  regressions.
- 2026-09-14 — **Fixed a real regression in the bilingual-dimensions redesign**, reported live by
  the product owner: "the HE template from state.js is not loading, neither to the squad/team/retro
  view, nor to the edit dimensions modal." Root cause: `i18n` is only ever WRITTEN onto a dimension
  doc when `loadTemplate()`/`startSession()` actually runs, or on a brand-new seeded board -- an
  already-saved dimension doc from BEFORE the redesign shipped is never retroactively backfilled, so
  it has no `i18n` at all. The OLD mechanism the redesign replaced matched a dimension's current
  VALUE against `STARTER_TEMPLATES` regardless of when it was saved, so it kept working for any
  pre-existing board; the redesign silently dropped that safety net -- confirmed by reproducing it
  directly against `public/local-store.js` (the real, non-test backend) with a simulated
  pre-redesign-shaped board: Tribe/Squad view and Edit Dimensions all showed plain English under
  Hebrew for a legacy Tuckman dimension, a fresh board showed Hebrew correctly everywhere.
  Fixed with `state.js`'s new `builtinDimTranslation(dim, field, index, locale)`: a fallback tier
  UNDER the dimension's own `i18n` (an admin's real translation always wins), matching a built-in
  starter template's dimension by its stable KEY -- but unlike the old shadow table, which compared
  by fragile REFERENCE equality (the exact thing that broke for an array field round-tripping
  through a session doc's JSON-shaped storage), this fallback is additionally gated on the field's/
  element's own current VALUE still matching the built-in's English default: a string comparison
  can't break on a JSON round-trip, and it also means a field an admin HAS since edited away from
  the default correctly falls back to plain English instead of showing a stale, unrelated built-in
  translation. `localizedDimText()` now calls this shared helper (used by every display site --
  Tribe/Squad/Retro), and `dimensions.js`'s Edit Dimensions panel gained its own locale-independent
  `effectiveHeValue()` built on the same helper, so a legacy dimension's translation panel shows the
  same in-effect Hebrew content the rest of the app does, pre-filled and still freely editable --
  closing the third place the product owner named. Purely a display/pre-fill fallback: nothing is
  written to a dimension's own `i18n` until an admin actually edits a field.
  Found a real test-fixture coupling while fixing this: `tests/fixtures/fake_store.html`'s "process"/
  "value" dimensions (used elsewhere as a "genuinely untranslated" example) turned out to be
  unmodified Spotify Squad Health Check defaults by label, so they now correctly pick up the built-in
  fallback too -- `test_bilingual_dimension_editor.py` updated to use a freshly-added custom
  dimension for the "no built-in match at all" case, and to assert the new partial-fallback behavior
  (label translated via fallback, synthetic green/red correctly NOT translated since their test
  content doesn't match Spotify's real text) as its own explicit scenario. Test-first throughout
  (5 new unit tests in `test_template_locale.js` proving the fallback, its value-gating, and its
  per-element array behavior, written and confirmed failing before the `state.js` change). Full
  74-test unit suite + 44-file Playwright suite green, on its own short-lived branch.
- 2026-09-15 — Copilot perf pass, file 7/9: `test_scored_template_tuckman.py`. Removed every
  `wait_for_timeout()` call. Most click-then-click chains needed no wait at all (`click()`/`fill()`
  auto-wait for their own next target); reads via `query_selector()`/`eval_on_selector()`/
  `evaluate()` got real conditions instead: `wait_for_selector(state="attached")` for native
  `<details>` content and per-view renders that are synchronous once the target lands,
  `state="visible"` for the confirm modal's open toggle, and `wait_for_function()` polling
  `window.__FAKE_STORE__` for the template-load and session-creation writes. One spot needed no
  wait for a non-obvious reason: directly writing to `window.__FAKE_STORE__` and calling
  `window.__NOTIFY__()` (simulating a relay push) invokes the fake store's listener callbacks
  SYNCHRONOUSLY -- unlike a real `onSnapshot`'s first delivery, which the fixture intentionally
  delays via `setTimeout` -- so `state.sessionResponses` is already updated by the time that
  `evaluate()` call returns, before the facilitator even clicks to reveal the live tally. Verified
  output identical to the original (aside from a timestamp), then stress-tested 10x clean at
  ~3.1-3.4s per run (down from ~6.5s). Landed via a clean fast-forward (no concurrent changes to
  this file), full 44-file Playwright suite + 74-test unit suite green, zero regressions.
- 2026-09-15 — Copilot perf pass, file 8/9: `test_scored_template_five_dysfunctions.py`. Same
  treatment as its Tuckman sibling (same starter-template test shape): removed every
  `wait_for_timeout()`, using auto-wait for click chains, `wait_for_selector(state="attached")` for
  synchronous-once-rendered content, `state="visible"` for the confirm modal, and
  `wait_for_function()` polling the store for template-load/rating writes. One condition needed
  more thought than Tuckman's: reloading the SAME already-active template rewrites the same
  dimension keys, so "dimensions/trust exists" is already true before the reload even starts -- not
  a real completion signal there. Used `meta/config.updatedAt` instead, which `loadTemplate()`
  stamps fresh on every load regardless of content -- captured its value before the reload and
  polled for it to change. Verified output identical to the original (aside from timestamps), then
  stress-tested 10x clean at ~2.2-2.3s per run (down from ~5.7s). Landed via a clean fast-forward,
  full 44-file Playwright suite + 74-test unit suite green, zero regressions.
- 2026-09-15 — Copilot perf pass, file 9/9 (last one): `test_retro_statement_survey_submission.py`.
  Removed every `wait_for_timeout()`, including the small per-click waits inside a 14-iteration
  answer loop: `refreshSubmitEnabled()` (retro-join.js) runs synchronously inside each scale-btn's
  own click handler, so `submitBtn.disabled` is already up to date the instant `click()` returns --
  no wait needed between clicks, or before reading it right after the loop ends. The setup section
  mirrors the Tuckman/Five Dysfunctions files' established treatment (same starter-template-load +
  start-session shape); the facilitator's manual store write + `window.__NOTIFY__()` call needed no
  wait at all, for the same synchronous-listener reason established in the Tuckman file. Verified
  output identical to the original (aside from the randomized session code), then stress-tested 10x
  clean at ~2.5-2.7s per run (down from ~5.2s). Full 44-file Playwright suite + 74-test unit suite
  green, zero regressions.

  This closed out 9 of Copilot's flagged test-performance list. The 10th and last,
  `test_board_sync_finish_retro_convergence.py` (lowest Copilot priority, largest/most
  relay-timing-sensitive file in the list), got its own dedicated pass -- see below.
- 2026-09-15 — Copilot perf pass, file 10/10 (the last one): `test_board_sync_finish_retro_convergence.py`.
  A real two-device, relay-backed convergence test (not the local fake-store harness the other 9
  files use), so treated with more caution throughout. Replaced 30 of its 32 `wait_for_timeout()`
  calls: click chains needed no wait (including the direct-rating swatch-click loops --
  `refreshSubmitEnabled()` updates synchronously in the click handler, same finding as the
  statement-survey file's scale-btn loop); device A/C's team-link generation got
  `wait_for_function` polling `#teamLinkInput`'s value (step 7's `crypto.subtle`-backed key
  generation is genuinely async), matching `test_cofacilitator_join.py`'s established fix.
  Two spots needed real thought specific to this file being genuinely relay-backed: submitting the
  statement/direct-rating survey calls `state.db.add()`, a REAL relay round trip here (this file's
  own db, not a fake store) that only resolves once the relay acks the write, and
  `afterSubmit()` (retro-join.js) only re-renders the personal-result page once that resolves --
  waited for `.personal-result` to appear instead of guessing, which also closes a real
  navigate-away-before-the-write-lands risk the original fixed wait didn't guarantee against.
  Switching reveal mode to "live" is ALSO a real, non-optimistic relay round trip on the clicking
  device's own UI (`setRevealMode()`'s live branch waits for its own session listener to reflect
  the write rather than rendering immediately) -- waited for the toggle to gain `.active` instead
  of guessing. Kept exactly 2 waits: device B's initial team-link open (same "no documented
  adoption-finished signal" precedent as `test_cofacilitator_join.py`), and the rainy-day check's
  margin for proving a cell STAYS unscored (this file's own `wait_for_scored()` helper already
  documents that it can't be used to prove a negative -- there's no positive condition to poll for
  "nothing arrived and nothing ever will"). Verified output identical to the original (aside from
  randomized session codes/secrets), then stress-tested 15x clean at ~5.7-6.0s per run (down from
  ~11.6-11.7s), matching the larger stress-test batch this pass reserves for relay/multi-device
  stakes. Full 44-file Playwright suite + 74-test unit suite green, zero regressions -- re-verified
  again after a clean fast-forward onto the preview branch (5x rerun).

  This closes out all 10 of Copilot's flagged test-performance files.
- 2026-09-15 — Copilot's re-run (after syncing to the pulled branch) flagged a fresh top-10 slowest
  list; started a new pass on the 8 local-fake-store files it flagged (deferring the one relay-
  backed file in that list to its own careful pass, and deprioritizing
  `test_relay_error_handling.py`, which deliberately times a real bounded-retry/give-up window
  against an unreachable relay rather than working around a missing signal). File 1/8:
  `test_facilitator_language.py` (23 waits, the highest count in the new list). Same treatment as
  the rest of this pass: click chains needed no wait, including a modal-closing click immediately
  followed by clicking a target the modal's backdrop was covering (actionability itself waits for
  the backdrop to close); `wait_for_selector(state="attached"/"visible")` for native `<details>`
  content, session-card renders, and the rating/override modal (`#backdrop`) plus confirm dialogs;
  `wait_for_function()` polling the store for template-load/session-creation writes. Two spots had
  a checked reason for no wait: saving the sprint-experiment note sets its "Saved" hint's
  `hidden=false` SYNCHRONOUSLY in the click handler (the `setTimeout` it also schedules only
  re-hides it 1800ms later), and the manual store write + `window.__NOTIFY__()` call needed none
  either, matching the by-now-established synchronous-listener finding. Verified output identical
  to the original (aside from the randomized session code), then stress-tested 10x clean at
  ~2.3-2.4s per run (down from ~5.7s). Full 44-file Playwright suite + 74-test unit suite green,
  zero regressions.
- 2026-09-15 — Copilot pass file 2/8: `test_view_navigation_and_squad_admin.py` (19 waits, tied for
  highest in the new list). Same established treatment throughout: `wait_for_selector`
  `state="attached"`/`"visible"` for renders/modals, `wait_for_function()` polling the store for
  squad rename/add/remove/rate writes. Two spots got a stronger justification than "probably
  synchronous": clicking a read-only Tribe-grid cell (asserted to do nothing) needed no wait at
  all, confirmed STRUCTURALLY by reading render.js/squads.js -- Tribe's cells are plain `<div>`s
  with no click listener bound anywhere, so nothing could ever open the modal, delayed or not; and
  the pre-reload squad selection needed no wait before `reload()` either, since `selectSquad()`
  writes to `localStorage` synchronously (a blocking browser API). The dimension-header tooltip
  hover kept a real `wait_for_function` on `#dimTooltip`'s hidden state, matching the established
  idiom from the tooltip and RTL files earlier in this pass. Verified output byte-for-byte
  identical to the original, then stress-tested 10x clean at ~2.3-2.4s per run (down from
  ~5.3-5.4s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
- 2026-09-15 — Copilot pass file 3/8: `test_bilingual_dimension_editor.py` (19 waits, tied for
  highest in the new list). The dimension-manager's field-edit functions
  (`updateDimensionField`/`updateDimensionI18nField`/`updateDimensionArrayItem`/
  `updateDimensionI18nArrayItem`, all in `dimensions.js`) mutate the dimension, call
  `renderAll()`/`renderDimList()`, AND write to the store all SYNCHRONOUSLY inside the 'change'
  handler -- confirmed by reading the handlers, not assumed -- so every `dispatch_event("change")`
  in this file needed no wait at all before the next read or re-query (the file's own existing
  comment about `renderDimList()` rebuilding `#dimList`'s innerHTML on every change already covers
  the correctness angle of re-querying; this only removes the now-unnecessary timing guess around
  it). The i18n-panel toggle click needed no wait either -- it only flips `panel.hidden` directly,
  no store write or re-render involved. Everything else got the by-now-established treatment: the
  initial boot marker, `wait_for_selector(state="attached"/"visible")` for renders and the confirm
  modal, `wait_for_function()` polling the store for the new-dimension and Tuckman-load writes.
  Verified output byte-for-byte identical to the original, then stress-tested 10x clean at
  ~2.0-2.2s per run (down from ~4.8-4.9s). Full 44-file Playwright suite + 74-test unit suite green,
  zero regressions.
- 2026-09-15 — Product owner adopted four working agreements into `docs/DefinitionOfDone.md`,
  proposed off the back of this session's perf pass and the two Copilot-sync incidents above:
  (1) Playwright waits use a real condition, never a fixed `wait_for_timeout()`, except where no
  positive signal can exist, with any exception commented; (2) a change to a test's wait/timing
  logic gets stress-tested 10x (15x relay-backed/multi-device) during its own dev cycle, not folded
  into the standing regression run; (3) the full suite's serial wall-clock time gets logged here
  when it moves meaningfully, as the signal to suggest a performance pass rather than a hunch;
  (4) another agent's or tool's analysis of "current" repo state gets a freshness check (synced to
  the branch tip?) before anyone acts on it. A fifth candidate -- an OS-level per-test timeout in
  `tests/_run_one.sh` -- was deferred: the incident that prompted it (the relay stdout-pipe
  deadlock, already fixed above) was a real code bug, not evidence a bug-free test can legitimately
  run that long, so it needs its own analysis before becoming a standing rule.
- 2026-09-15 — Copilot pass file 4/8: `test_starter_template_spotify.py` (18 waits). Same
  established treatment throughout: `wait_for_selector(state="attached"/"visible")` for the
  templates list, native `<details>` content (the Tribe legend, under Hebrew and after switching
  back), and the confirm modal; `wait_for_function()` polling the store for the Five
  Dysfunctions/Spotify template-load and session-creation writes -- using `dimensions/release` (a
  key unique to Spotify, absent while Five Dysfunctions was active) as the real signal for
  "Spotify's dimensions landed back", adapting the by-now-standard template-load idiom to a
  load-then-reload-the-original sequence rather than a first-time load. Verified output identical
  to the original (aside from timestamps), then stress-tested 10x clean at ~1.9-2.0s per run (down
  from ~5.0-5.1s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
- 2026-09-15 — Copilot pass file 5/8: `test_retro_statement_language.py` (17 waits). Setup mirrors
  the established Tuckman-load treatment from earlier in this pass. One condition needed more
  thought than the usual synchronous-fake-store case: `joinSessionByCode()` (retro-join.js) renders
  the "Connecting..." placeholder synchronously (`state.joinSession` starts null), and only shows
  the real statement form once `listenJoinSession()`'s `onSnapshot` listener delivers its FIRST
  snapshot -- a genuine async gap the fake store deliberately delays (unlike its later, synchronous
  `notify()` calls) -- so this waits for `.stmt-row` to attach instead of guessing. The answer
  loop's per-click waits were removed too, same `refreshSubmitEnabled()`-is-synchronous finding as
  the statement-survey file's identical loop. Verified output byte-for-byte identical to the
  original, then stress-tested 10x clean at ~2.9-3.2s per run (down from ~5.7-6.0s). Full 44-file
  Playwright suite + 74-test unit suite green, zero regressions.
- 2026-09-15 — Copilot pass file 6/8: `test_retro_join_exit_and_return.py` (17 waits).
  `exitJoinScreen()`/`returnToJoinScreen()` (retro-join.js) are both fully synchronous DOM toggles
  -- `returnToJoinScreen()` re-renders from already-cached `state.joinSession`/
  `joinSubmittedResults`, no new fetch involved -- so neither needed any wait before the next click
  or read. The direct-rating swatch-click loops needed none either (same synchronous
  `refreshSubmitEnabled()` finding as the statement-survey/statement-language files); the two
  submission points got `wait_for_selector('.personal-result', state="attached")` instead of a
  guess; both fresh-page boots got the established real boot markers. Verified output byte-for-byte
  identical to the original, then stress-tested 10x clean at ~2.2-2.4s per run (down from
  ~5.1-5.2s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
  **Full-suite timing trend** (per the DoD's new tracking rule, `tests/run_all.sh`,
  `TEST_JOBS=2`, wall-clock): the commit right before this whole wait-condition pass began
  (`172594f`, 38 Playwright files) ran in **102.5s**; now, 44 files later (6 of them added by
  unrelated concurrent feature work, not this pass) and 10 files converted, it runs in **81.1s** --
  down ~21.4s (~21%) despite running more tests.
- 2026-09-15 — Copilot pass file 7/8: `test_retro_experiment_note_and_finish.py` (17 waits). One
  finding reverses a caution from earlier in this pass: this file's reveal-mode toggle needed NO
  wait before the next click, unlike the identical-looking click in
  `test_board_sync_finish_retro_convergence.py`. There, a REAL relay write genuinely round-trips
  before that device's own listener reflects it. Here, using the local fake store, the ongoing
  sessions listener (subscribed once at boot in `db.js`) fires SYNCHRONOUSLY on every `.update()`
  call -- so `setRevealMode()`'s write and the resulting re-render (including the `.override-btn`
  the next click needs) are both already done by the time `click()` returns. The lesson: "this
  exact click needed a wait in file X" doesn't transfer to file Y without checking which backend
  (real relay vs. local fake store) that specific test uses -- confirmed by reading the handlers
  each time, not assumed from precedent. Same synchronous-write reasoning covered
  `saveExperimentNote()`, `setSessionOverride()`, and `finishRetroAndApply()`. Verified output
  identical to the original (aside from the randomized session code), then stress-tested 10x clean
  at ~1.9-2.0s per run (down from ~4.6-4.8s). Full 44-file Playwright suite + 74-test unit suite
  green, zero regressions. Full-suite `tests/run_all.sh` now **79.5s** (down from 81.1s two entries
  ago, 102.5s at the start of this pass).
- 2026-09-15 — Copilot pass file 8/8 (last local-fake-store file): `test_dimension_and_template_admin.py`
  (16 waits). Builds its page via its own custom fake Firestore-like store (`FAKE_CLAUDE_JS`, not
  the shared `fixtures/fake_store.html`) -- confirmed it has the same synchronous-`notify()`/
  async-first-`onSnapshot`-delivery shape as the shared one before relying on that assumption, same
  discipline as every other file in this pass (read the handler, don't assume from precedent). Same
  established treatment throughout: `wait_for_function()` polling the store for dimension add/
  reorder/delete/rate and template save/load, `wait_for_selector(state="attached"/"visible")` for
  renders and modals, no wait for confirmed-synchronous field edits. The template-load step needed
  a one-time marker rather than a generic "dimensions changed" check: `meta/config` is never
  written by anything before the first `loadTemplate()` call in this fixture, so its mere existence
  is a reliable signal. Verified output identical to the original (aside from timestamps -- this
  included confirming a pre-existing, unrelated test quirk where an unqualified selector loads the
  first starter template row instead of the just-saved custom one, present identically before and
  after, left untouched as out of scope for a timing-only pass), then stress-tested 10x clean at
  ~2.8-3.0s per run (down from ~5.8-5.9s). Full 44-file Playwright suite + 74-test unit suite green,
  zero regressions. Full-suite `tests/run_all.sh` now **82.9s** (within normal run-to-run variance
  of the 79.5s/81.1s figures above -- this pass's 8 local-fake-store files are now all done; only
  the relay-backed `test_retro_join_link_carries_team_sync.py` remains from Copilot's second-pass
  list).
- 2026-09-15 — Copilot pass file 9/9 (the last one): `test_retro_join_link_carries_team_sync.py`
  (13 waits, the only relay-backed file in this second pass). Analyzed in full before touching
  anything, per explicit instruction, then applied at a 15x stress-test bar (not the usual 10x)
  given the relay/multi-device stakes. Replaced 12 of 13 waits: the team-link boot wait collapsed
  into the established `wait_for_function` on `#teamLinkInput`'s value; click chains and the
  direct-rating swatch loop needed none (same synchronous-handler findings as every join-screen
  file in this pass); `teamDisconnectBtn` needed none either, confirmed by reading
  `setTeamSecret("")`/`stopTeamBoardSubscription()` -- both purely local, no relay ack required to
  disconnect your own subscription. One removal needed real justification beyond a category match:
  the squad-1 rename's 400ms margin on device A, before device B opens the join link. `renameSquad()`
  updates local state synchronously before the relay write even starts, and the actual condition
  that margin stood in for (the rename reaching the relay before B connects) is already re-checked,
  far more patiently, by B's own `wait_for_function` two lines later -- and a single WebSocket
  connection preserves message order regardless, so the rename/session-start writes can't arrive at
  the relay out of order just because the local pause is gone. Verified this specifically holds
  under the 15x repetition, not just once. Kept exactly 1 wait: device C's fresh join-link open,
  the same "no documented device-adoption signal" precedent as `test_cofacilitator_join.py` and the
  board-sync convergence file. Verified output structurally identical to the original (aside from
  randomized codes/secrets), stress-tested 15x clean at ~3.5-3.6s per run (down from ~5.3-5.6s).
  Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
  Full-suite `tests/run_all.sh` now **77.2s**.

  **Coverage audit** (requested explicitly, covering all 19 files touched across this whole
  wait-condition pass, from `test_hebrew_rtl_coverage.py` through this file): diffed the exact set
  of `assert` statements -- not just their count -- between each file's state immediately before
  and immediately after its own conversion commit. Zero assertions were added, removed, or
  reworded anywhere; the only non-`wait_for_timeout` lines ever touched were a handful of
  pre-existing comments absorbed into more detailed replacement comments alongside the wait
  changes. Coverage is unchanged from before this pass began -- the only behavior change anywhere
  was HOW each test waits, never WHAT it checks. (Two files, `test_dimension_and_template_admin.py`
  and `test_template_switching_and_csv_import.py`, have zero `assert` statements of their own even
  before this pass -- a pre-existing property relying on `page.on("pageerror")`/console-error
  capture instead, unrelated to and unchanged by this work.)

  This closes out Copilot's second-pass list in full (9 files: `test_facilitator_language.py`,
  `test_view_navigation_and_squad_admin.py`, `test_bilingual_dimension_editor.py`,
  `test_starter_template_spotify.py`, `test_retro_statement_language.py`,
  `test_retro_join_exit_and_return.py`, `test_retro_experiment_note_and_finish.py`,
  `test_dimension_and_template_admin.py`, `test_retro_join_link_carries_team_sync.py`) on top of
  the first pass's 10 -- 19 files total, `tests/run_all.sh` down from 102.5s to 77.2s (~25% faster)
  despite the suite growing by 6 files across that span from unrelated concurrent work.
- 2026-09-15 — After Copilot's own re-sync confirmed a legitimate (non-stale) third top-10 list,
  screened it before starting: `test_board_sync_finish_retro_convergence.py` is already done (2
  waits left, both deliberate); `test_board_sync_template_switch_race.py` and
  `test_relay_error_handling.py` deliberately left alone -- read both in full and confirmed at
  least one wait in each exists specifically to let a race/retry window happen before checking the
  outcome, not to work around a missing signal (the same category of thing this pass has
  consistently protected throughout). File 1/6 of the remaining local candidates:
  `test_main_screen_language.py` (15 waits). Traced `app.js`'s `setView()` directly rather than
  assuming from precedent: it calls `applyViewVisibility()` AND `renderAll()` SYNCHRONOUSLY inside
  the click handler, so every view switch freshly re-renders all views in whatever locale is
  active, not lazily -- confirming every "click a view, read its translated content" pair in this
  file (and, retroactively, every other language-screen file already fixed in this pass) needed no
  wait at all. The rest got the standard treatment: the initial boot marker,
  `wait_for_selector(state="attached"/"visible")` for native `<details>` content and the rating
  modal, `wait_for_function()` for the rating write. Verified output byte-for-byte identical to the
  original, then stress-tested 10x clean at ~1.8-1.9s per run (down from ~4.3-4.5s). Full 44-file
  Playwright suite + 74-test unit suite green, zero regressions. Full-suite `tests/run_all.sh` now
  **76.1s**.

  A claim from Copilot's own investigation was checked and not corroborated: it reported
  `test_retro_experiment_note_and_finish.py` failing at commit `f53d8d0` (the exact commit this
  session was also on), attributing it to the wait-condition fix in `8de2811` assuming a
  synchronous store write that supposedly wasn't. Re-verified at that same SHA: 20 isolated runs
  clean, 6 more launched simultaneously to induce CPU contention (the most plausible way a
  genuinely-synchronous write could appear to race) also clean -- 26/26, and a fresh re-read of the
  full `saveExperimentNote()` call chain found no deferred step anywhere in it. No code change was
  made pending the specific failure detail (exact assertion value, traceback, Copilot's own
  Playwright/Chromium version) that would let this be reproduced rather than taken on report alone.
- 2026-09-15 — File 2/6 of the remaining local candidates from Copilot's third top-10 list:
  `test_retro_override_and_response_table.py` (15 waits). Same established Five Dysfunctions-load
  setup treatment as earlier files, plus the session-override editor got the same finding as
  `test_retro_statement_language.py`'s identical flow: `setSessionOverride()`/
  `clearSessionOverride()` (retro-facilitator.js) both write to the store and re-render
  synchronously in their click handlers. Verified output identical to the original (aside from the
  randomized session code), then stress-tested 10x clean at ~1.9-2.1s per run (down from
  ~4.4-4.6s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
  Full-suite `tests/run_all.sh` now **74.7s**.
- 2026-09-15 — File 3/6 of the remaining local candidates from Copilot's third top-10 list:
  `test_retro_direct_rating_flow.py` (14 waits). Same established treatment throughout: the initial
  boot marker, `wait_for_function()` for session-creation/override/finish-retro writes, and the
  join screen's genuine async gap (`listenJoinSession()`'s `onSnapshot` first delivery, matching
  `test_retro_statement_language.py`'s identical case) covered by
  `wait_for_selector('.direct-row', ...)` instead of a guess. The direct-rating swatch-click loop
  needed no waits between clicks (`refreshSubmitEnabled()` runs synchronously, same finding as
  every other join-screen file in this pass). Verified output identical to the original (aside from
  the randomized session code), then stress-tested 10x clean at ~1.9-2.0s per run (down from
  ~4.5-4.7s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
  Full-suite `tests/run_all.sh` now **74.0s**.
- 2026-09-15 — File 4/6 of the remaining local candidates from Copilot's third top-10 list:
  `test_retro_reveal_mode_and_consolidation.py` (14 waits). Standard treatment for the Five
  Dysfunctions-load setup; the reveal-mode toggle got the same local-fake-store synchronicity
  finding as `test_retro_experiment_note_and_finish.py`'s identical click (explicitly distinguished
  in the test's own new comment from the REAL relay case in the board-sync convergence file, where
  the write genuinely round-trips before the device's own listener reflects it). One spot needed
  real thought: switching to squad-2 and back to squad-1 re-subscribes
  `subscribeSessionResponses()` from scratch, and a fresh subscription's first `onSnapshot`
  delivery is a genuine async gap this fixture deliberately delays -- unlike every other reveal-mode
  read in this file. Kept a real `wait_for_function` on the reveal-btn's active class there rather
  than assume it's already correct, since this is precisely the scenario the test exists to verify
  ("re-subscribes correctly"). Verified output identical to the original (aside from the randomized
  session code), then stress-tested 10x clean at ~1.9-2.0s per run (down from ~4.6-4.7s). Full
  44-file Playwright suite + 74-test unit suite green, zero regressions.
