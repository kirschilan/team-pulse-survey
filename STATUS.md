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
| `board-export-import.js` | JSON board export and import (squads/ratings, dimensions, templates, board settings) — the only board export/import format; CSV's own runtime code was deleted, and this file was renamed from `csv.js` to match, in Story 13 item 4. |
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
(There's one other `window.claude.use(...)` call, for `"downloads"` in `public/js/board-export-import.js`, and a
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
- **SEC-2 (split from SEC-1), PO decision, NOT YET IMPLEMENTED as of 2026-09-16: drop the typed
  6-character join code, QR/link only.** Product owner call: the "type this code in" join path
  (the join-code modal, and the code front-and-center on the session card — see Story 3 in
  `docs/facilitated-retro-spec.md`) goes away entirely. A retro session is joined only by scanning
  its QR code or opening its link — the existing "Or scan/share a link" fallback becomes the *only*
  path, promoted out of "collapsed by default." This also retires the premise the code-derived-key
  decision above leaned on ("the app's *primary* join path is typing the 6-character code by
  hand") — whoever implements this should decide then whether the session key stays derived from
  the code (now purely internal, never shown/typed) or moves to a separate link/QR-carried secret
  to match the board-sync model (see "Security fix" below). Ship it with a security notice
  wherever a join or co-facilitate link/QR is shown (the session card, the link/QR fallback, and
  the co-facilitator link/QR from Story 10 — all carry the same exposure):
  > Note: Anyone with this link — or who scans this QR code — can see the data in this Squad Pulse
  > session. Share it only over a secure channel, and make sure the QR code itself is visible only
  > to people who should have access.

  (Tightened from the PO's original draft — "secure media" → "secure channel," and calling out that
  the link and the QR grant identical access rather than treating them as separately risky.) Not
  coded yet; tracked here for whoever picks up the implementation.
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
| 13 | CSV import/export chrome — deliberately last: `csv.js`'s column-matching and re-import logic key off raw English labels, so this needs its own careful design pass, not just a translation pass. Redesigned as a full JSON board export/import replacing CSV (see session log): (1) JSON board export (beta), additive — **DONE** (2026-09-15); (2) JSON import — squads/ratings — **DONE** (2026-09-15); (3) JSON import — dimensions/templates/board settings — **DONE** (2026-09-15); (4) delete the CSV runtime code, rename `csv.js` → `board-export-import.js` — **DONE** (2026-09-16) | **DONE** |

## Deliberately not built yet (and why)

| Not built | Why it's cut for now | What would trigger building it |
|---|---|---|
| Relay deployed anywhere public | Built, tested, and now deploy-ready (`render.yaml` + `SQUAD_PULSE_RELAY_URL`-driven build step — see `relay/README.md`), but this session has no hosting/Vercel account access to actually click "deploy" | Whoever has account access runs the Render blueprint (or any equivalent host) and sets the Vercel env var — see `relay/README.md`'s "Wiring the deployed static site to this relay" for the exact steps, including testing it on a Preview deployment before merging to `main` |
| Save-board / Load-board-to-file | `local-store.js` already persists the board via `localStorage`, which covers the same browser/device | Once someone needs a board to move between browsers/devices without a relay |
| Relay deployed on Vercel itself (one deployment, not two) | Deliberately rejected, not just deferred — see the locked decision above and `relay/README.md`'s "Why not a Vercel Function" | Only if Vercel's WebSocket support later guarantees same-instance routing without an external store, which would remove the reason this was rejected |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |
| A third UI language (beyond English/Hebrew) | YAGNI, per the product owner's own call (2026-09-14) — `SUPPORTED_LOCALES`/`t()`'s fallback (i18n.js) are already written generically enough to add one without a redesign, and the bilingual-dimensions editor (see the session log) is a per-dimension `i18n` object keyed by locale code, not hardcoded to exactly two languages, so neither needs rework specifically to add a third | A real request for a specific third language — at that point, design its own toggle/picker UX (today's per-dimension editor hardcodes one Hebrew panel) rather than assuming the two-language shape generalizes without a look |

## Introduction and help backlog (2026-09-15)

Priority is separate from the stable story ID. Each story ships English/Hebrew,
RTL, keyboard support, and focused regression coverage. Story 1 was merged through PR #2. Stories 2–4 and outside-click dismissal
are on `codex/about-guides` for review before integration.

| Priority | Story | User value and acceptance criteria | Status |
|---|---|---|---|
| 1 | 1 — On-demand introduction | As a visitor, open About & help from every view, including participant mode, understand the app's purpose, and close back to the same context without changing data or drafts. | Merged via PR #2 (2026-09-15) |
| 2 | 6 — First-visit introduction | As a first-time visitor, see an introduction on an ordinary visit. Remember dismissal locally; bypass it for participant/co-facilitator/team links; retain manual access; storage failure never blocks entry. | Implemented on `codex/welcome-credits-terms`; review pending |
| 3 | 2 — Participant guide | As a participant, understand code/link entry and answering; open the existing join flow or return to an active retro without losing answers. | Implemented on `codex/about-guides`; PR review pending |
| 4 | 3 — Facilitator guide | As a facilitator, follow setup, template and squad selection, start, invite, discuss, and finish/apply; distinguish team and session links. | Implemented on `codex/about-guides`; PR review pending |
| 5 | 4 — Reading results | As a viewer, understand colors, trends, Squad/Tribe views, and hotspots through expandable guidance matching actual behavior. | Implemented on `codex/about-guides`; PR review pending |
| 6 | 5 — Credits and licenses | As a user, inspect verified model sources, Dr. Agile contributions, application license, and third-party notices; preserve contextual board credits. Verify the source of Tuckman assessment scoring. | Credits UI implemented; source/rights questions remain in `docs/credits-and-terms-review.md` |
| 7 | 7 — Terms and conditions of use | As a user, read terms before choosing to use the app and reopen them from About & help. Publish owner-approved English/Hebrew terms covering permitted use, responsibilities, data/sharing behavior, and limitations; show effective date/version and accessible links. Explicitly decide whether acceptance tracking is needed before implementation; do not imply consent through mere dismissal. | Informational/no tracking confirmed by owner; draft wording implemented for review |

Stories are small independently testable UI increments; stories 2–5 and 7 can
be ordered independently once the common panel is available. Story 6 was moved
to priority 2 by the product owner. Terms are a separate content/behavior story,
not implicit acceptance added to story 1.

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
- 2026-09-15 — File 5/6 of the remaining local candidates from Copilot's third top-10 list:
  `test_join_link_carries_language.py` (13 waits). The session-start and locale/view-switch clicks
  got the by-now-established synchronicity treatment (`setView()`/`setLocale()`/`selectSquad()` all
  render synchronously); the one write needing a real wait was `startSessionBtn`'s click, covered
  with `wait_for_function()` polling the fake store for the new session doc, since `startSession()`'s
  live branch writes through the fake store's `set()` -- which mutates `STORE` and calls `notify()`
  synchronously, re-rendering `#sessionJoinLink`/`#coFacilitateLink` via the long-lived
  `db.collection("sessions").onSnapshot()` listener `db.js` registers at boot, in that same
  synchronous call. Both fresh-participant-device joins got the same genuine-async-gap treatment as
  other join-screen files, this time as `wait_for_function("() => state.joinSession && ... === 'open'")`
  rather than a DOM selector, since `listenJoinSession()`'s callback calls `renderJoinScreen()`
  synchronously right after setting `state.joinSession`. One of the two participant devices' first
  page load (only there to seed `localStorage` before the real navigation) needed no wait at all --
  `page.goto()` already waits for the load event, and that throwaway page's own boot state doesn't
  matter. Verified output byte-for-byte identical to the original (aside from the randomized
  session/team codes), then stress-tested 10x clean at ~1.85-1.89s per run (down from
  ~4.58-4.59s). Full 44-file Playwright suite + 74-test unit suite green, zero regressions.
  Full-suite `tests/run_all.sh` now **71.9s**.
- 2026-09-15 — File 6/6, the last of Copilot's third top-10 list: `test_uncaught_error_diagnostics.py`
  (10 waits, 3300ms total). Unlike every other file in this pass, most of the win here came from
  removing waits outright rather than swapping in a condition: the initial boot-completion wait
  dropped entirely, since nothing in this file reads anything gated on the async store load --
  `#diagLog`/`#diagPanel`/the copy buttons are all static `index.html` markup, already present the
  instant `page.goto()` returns (its default `waitUntil="load"` guarantees `helpers.js`'s own
  `error`/`unhandledrejection` listener registration has already run). The admin-view click and both
  `<details>` toggles needed no wait either, same synchronous-setView()/synchronous-native-toggle
  reasoning as every prior file. The two synthetic-error scenarios (a bare `setTimeout` throw, an
  uncaught promise rejection) got `wait_for_function()` polling `#diagLog` for the specific message,
  since `evaluate()` only awaits the scheduling call, not the callback the window listener catches.
  Both copy-button clicks got the same treatment, polling for the "Copied!" label instead of
  guessing how long `navigator.clipboard.writeText()` takes. One wait stayed a REAL wait, the first
  of its kind flagged and deliberately left in this pass: `showCopied()`'s own `setTimeout(...,
  1500)` reverting the button label is a genuine, intentional UI timer being tested (same category
  as the 1500ms in `test_board_sync_template_switch_race.py`) -- converted to `wait_for_function()`
  polling for the actual revert (shaving the original's ~200ms padding) rather than eliminated;
  doing that would need clock-mocking (Playwright 1.62, installed here, has a Clock API for this),
  which this pass deliberately did not introduce given it would virtualize `Date`/timers
  page-wide and change what's actually being verified, a bigger step than this pass's scope.
  Verified output byte-for-byte identical to the original (aside from timestamps), then
  stress-tested 10x clean at ~2.8-2.9s per run (down from ~4.6-4.65s -- the smallest percentage cut
  in this pass, since ~1.5s of what remains is that one legitimate timer). Full 44-file Playwright
  suite + 74-test unit suite green, zero regressions. Full-suite `tests/run_all.sh` now **69.2s**.
  This closes out Copilot's screened third top-10 list -- the two deliberately-skipped race/retry-
  timing files remain untouched, and no further candidates are queued pending a future re-scan.
- 2026-09-15 — Closed the open Copilot dispute over `test_retro_experiment_note_and_finish.py`
  (first flagged, and not corroborated, earlier the same day). Copilot came back with an actual
  reproduction this time: a hand-rolled diagnostic harness (not the real test file) run on a
  different machine/Chromium build, reproducing 8/10 times, with a trace showing the "Saved" hint
  going visible (proving the click handler ran) while the fake-store value stayed unchanged and a
  condition wait on it timed out completely. Re-traced the full chain from source a third time
  (`liveOr()` -> `saveExperimentNote()` -> the fake store's `docRef.update()`) and it's still
  provably synchronous on every machine this session has access to -- 26/26 clean here (20 isolated
  + 6 concurrent, on top of the original investigation's own 26/26) -- and found no code-level
  mechanism that would make it race; the most likely explanation is the harness itself, which
  Copilot's own trial-and-error log shows going through several self-admitted bugs while being
  built, not the app's actual write path. Regardless of root cause, this exact click/read pair
  turned out to be the ONE place in the whole wait-condition pass that read a "provably
  synchronous" fake-store write with a bare `evaluate()` and no defensive `wait_for_function()`
  poll -- every analogous site (session creation, override save, finish-retro) already polls
  despite identical synchronicity reasoning, specifically as insurance against exactly this kind of
  environment-dependent report. Added the poll, matching that established convention, which closes
  the report either way (a genuine environment difference, or a harness artifact) at zero cost.
  Verified output byte-for-byte identical to the original, full 44-file Playwright suite + 74-test
  unit suite green.

- **2026-09-15 — Introduction story 1, private PR branch.** Added a header
  About & help control and an on-demand native dialog describing Squad Pulse,
  Squad/Tribe/Admin views, and Dr. Agile authorship. English/Hebrew, scoped RTL,
  full-screen mobile layout, Escape dismissal, focus containment/restoration;
  no navigation, draft mutation, automatic display, or persistence. No migration
  needed: no stored data shape changes. Product owner authorized implementation
  on a private branch for review before integration; preview/main remain untouched.
  Recorded the introduction backlog above, moved story 6 to priority 2, and added
  terms-and-conditions story 7. Test-first: new test failed on missing control
  before implementation, then passed; existing live participant test additionally
  verifies help preserves an actual selected answer. Reviewed English desktop and
  Hebrew mobile screenshots. Validation: 74/74 Node tests pass; 44/45 browser files
  pass in two full runs. The experiment-note save test fails at line 88 on this
  branch AND an untouched archive of baseline 786c3d5; this pre-existing failure
  is left visible, so the full green Definition of Done is not yet satisfied.
  Draft PR is for review, not a claim of release readiness.

- 2026-09-15 — ROI review of `run_all.sh` for a proposed Playwright Clock API pass (see the
  "clock-mocking" DoD question raised the same day) found the win too small to justify the
  investment: only 3 `setTimeout()` calls exist anywhere in `public/js/`, one of them (the
  save-experiment-note hint auto-hide) isn't waited on by any test at all, and the other two are
  either isolated to one file (~1.5s) or entangled with real relay/WebSocket I/O and already
  flagged do-not-touch. While doing that review, found a much bigger, zero-new-risk opportunity
  instead: 22 files still carried old-style fixed `wait_for_timeout()` sleeps using the exact same
  guessed-sleep pattern already converted in 19 files across this pass, totaling ~36 seconds of raw
  sleep budget (2 of those 22 are the already-known deliberate exceptions). Started converting the
  other 20. File 1/4 of this batch: `test_join_flow_language.py` (14 waits -> 0) -- standard boot
  marker + synchronous setView()/setLocale()/joinCodeBtn-click treatment. One scenario needed real
  thought: `joinSessionByCode()` (retro-join.js) is itself fully synchronous, and for a code that
  never existed, its FIRST synchronous render already shows the final "not open" state (sess is
  null both before AND after `listenJoinSession()`'s async first delivery, since the doc never
  exists either way) -- so THAT one scenario needed no wait at all, unlike the two that pre-seed a
  real doc (closed/open sessions), which do hit the genuine first-delivery gap and got
  `wait_for_function()` on `state.joinSession.status`. File 2/4: `test_dim_manager_language.py`
  (14 waits -> 0) -- `openDimManager()`/`closeDimManager()`/`openConfirm()`/`closeConfirm()` all
  confirmed synchronous by reading `dimensions.js`/`modals.js` directly; reused established
  templates-modal/Five-Dysfunctions-load treatment from prior files for the detour through it.
  File 3/4: `test_templates_language.py` (13 waits -> 0) -- `openTemplates()`/`closeTemplates()`
  confirmed synchronous; `saveCurrentAsTemplate()`'s live-branch write is picked up by the
  long-lived "templates" `onSnapshot` listener (`db.js`), which re-renders synchronously via
  `notify()` since the modal is open, but a `wait_for_function()` on the new row still stands in
  for the guessed sleep rather than assuming that timing. File 4/4: `test_header_language.py`
  (10 waits -> 0) -- `setSyncStatus()` (`db.js`) confirmed as a plain two-line synchronous DOM
  update, so `evaluate()`'s own already-awaited script execution was sufficient. All 4 files
  verified output byte-for-byte identical to their originals, each stress-tested 10x clean. Full
  suite green: 74/74 unit tests, 45/45 Playwright tests (test count grew by one from the merged
  About & help PR) via `tests/run_all.sh` (67.7s). 16 files remain in this batch.
- **2026-09-15 — Introduction stories 2–4 and outside-click dismissal.**
  Private branch `codex/about-guides` starts at freshly fetched preview 401fec7,
  including merged PR #2 and current condition-wait strategy (8375a2f and the
  recent wait-removal passes). Fetched again before delivery; preview unchanged.
  Added expandable participant, facilitator, and results guides in English/Hebrew.
  Participant action opens existing code entry or returns to the current survey
  without dropping its draft. Outside clicks close the native dialog through the
  same close path; inside clicks and drags originating inside do not dismiss it.
  No new data shape, persistence, or migration. Automatic first-visit display,
  attribution/license details, and terms remain separate stories.
  Test-first dismissal regression failed before implementation; expanded guide
  and language checks pass, as does the real participant draft-return test.
  No new fixed sleeps: retrying DOM assertions/condition waits follow current
  strategy. Visually checked English desktop and Hebrew mobile layouts.
  74/74 Node tests pass; full `tests/run_all.sh` reports 44/45 passing files.
  The experiment-note test still times out at its new wait_for_function at line
  89 on this machine, reproduced against an untouched archive of 401fec7 too.
  Thus the latest wait patch is incorporated but does not resolve the baseline
  failure here. Draft PR for review; full-green Definition of Done outstanding.
- 2026-09-15 — Batch 2/5 of the remaining wait-condition files: `test_admin_language_switch.py`
  (10 waits -> 0, standard boot marker + synchronous setView()/setLocale()/openConfirm() treatment;
  a real `page.reload()` correctly kept its own boot-marker wait, since a reload genuinely re-runs
  the whole async boot sequence, unlike every other click in the file), `test_view_switch_refreshes_
  stale_state.py` (6 waits -> 0, the simplest file in the batch -- this is the file guarding the
  exact bug this whole methodology depends on staying fixed, setView() calling renderAll() on every
  switch, so it got read carefully rather than assumed), and `test_csv_import_column_matching.py`
  (9 waits -> 0, the one genuinely new async mechanism found so far in this batch: `csvFileInput`'s
  change handler reads the file via `FileReader.readAsText()`, a real async I/O callback rather than
  a promise/microtask, before rendering the preview and unhiding `#importBackdrop` -- both CSV-import
  scenarios now wait on that backdrop instead of guessing). Verified output byte-for-byte identical
  to each original, each stress-tested 10x clean. Full suite green: 74/74 unit tests, 45/45
  Playwright tests via `tests/run_all.sh` (66.0s). 13 files remain in this batch.
- 2026-09-15 — Batch 3/5: `test_local_store.py` (12 waits -> 0) and
  `test_encryption_no_plaintext_on_wire.py` (8 waits -> 0). `local-store.js`'s `docRef.set()`/
  `update()` confirmed synchronous within a tab (same shape as `fake_store.html`) -- same-tab
  rating saves got `wait_for_function()` polls on the cell's DOM class directly, since no
  `window.__FAKE_STORE__` global exists outside the fake-store fixture. The one genuinely async
  gap in that file: a second tab only picks up the first tab's write via the browser's native
  `storage` event, which never fires in the writing tab and only fires asynchronously in others --
  that one kept a real wait, stress-tested 15x given the cross-tab timing sensitivity. The
  encryption file is real-relay-backed: `ensureDefaultTeamSecret()`/`renderTeamSyncStatus()`
  (`board-sync.js`) confirmed synchronous at script-load time, so device A's team link needed no
  wait at all (the original comment's "no click needed" was right, but the wait after it wasn't
  needed either). The two genuine relay round trips (squad rename, experiment-note save) can't use
  a `page.wait_for_function()` -- what needs to settle is the Python-side WebSocket frame capture,
  not browser state -- so a small `wait_for_new_frame()` poll on the capture replaced the guessed
  sleep, which also makes the test strictly more rigorous: it now proves traffic for that specific
  action actually happened rather than assuming enough time passed. Verified output byte-for-byte
  identical to each original (one incidental, non-assertion frame-count print differs, expected
  since the test no longer waits around collecting incidental traffic), both stress-tested 15x
  clean given the real relay/cross-tab timing involved. Full suite green: 74/74 unit tests, 45/45
  Playwright tests via `tests/run_all.sh` (63.9s). 11 files remain in this batch.
- 2026-09-15 — Batch 4/5: three real-relay-backed board-sync files (`test_board_sync_default_on.py`,
  `test_board_sync_hydrate_on_boot.py`, `test_board_sync_live_subscribe.py`, 9+7+7 = 23 waits -> 1
  deliberate). The key finding was distinguishing which writes are genuinely async from which only
  looked that way: `ensureDefaultTeamSecret()`/`renderTeamSyncStatus()`/`autoConnectFromLink()`/
  `connectWithSecret()` (`board-sync.js`) are all synchronous at script-load/click time, so a
  device's team link, connected status, and the disconnect handler's own immediate UI effects
  needed no wait at all -- contrary to what several of these files' own original comments assumed
  ("no click needed" was right, but the wait after it wasn't). By contrast, `relay-client.js`'s
  `collRef.add()` (used by every `addSquadBtn` click) is genuinely async even for its OWN device's
  optimistic local update -- unlike `putDoc()` elsewhere, `add()` gates entirely on `room.ready`
  resolving first -- so those kept or gained a real `wait_for_function`, reusing the style
  `test_board_sync_hydrate_on_boot.py` already had for its hydrate checks. The default-on file's
  squad-rename push needed a different mechanism since what has to settle is the RELAY's own copy
  of the board doc, not local browser state -- a small Python-side `poll_pushed_board()` helper
  re-fetches it until the rename shows up. The live-subscribe file's disconnect-then-push scenario
  is "proving a negative" (same category as `test_board_sync_finish_retro_convergence.py`'s
  established device-C-never-syncs check) -- kept a real fixed wait there, but strengthened it: the
  writing device's own optimistic update is now waited on for real first, before the fixed window
  checks the disconnected device never got it. Verified output byte-for-byte identical to each
  original, each stress-tested 15x clean given the real relay round trips. Full suite green:
  74/74 unit tests, 45/45 Playwright tests via `tests/run_all.sh` (60.6s). Only
  `test_board_sync_opt_in_push.py` plus the relay re-check task remain in this batch.
- 2026-09-15 — Batch 5/5, closing out the run_all.sh ROI review's remaining candidates:
  `test_board_sync_opt_in_push.py` (6 waits -> 0, same reasoning as batch 4 -- reused
  `poll_relay_board()` for the squad-rename push, and the disconnect-then-push "proving a negative"
  scenario got the same strengthened treatment as `test_board_sync_live_subscribe.py`'s). Also
  caught and fixed a mistake from batch 4: `test_board_sync_hydrate_on_boot.py`'s `addSquadBtn`
  waits carried a factually wrong comment blaming relay-client.js's `room.ready` gate --
  `local-store.js`'s `routedCollRef()` only sends "sessions"/"boards" paths to the relay, so
  "squads" is a purely local, synchronous write (same shape as `fake_store.html`) and never touches
  `room.ready` at all. Removed both now-unnecessary waits and fixed the comments; re-verified
  byte-identical output and 15/15 clean. Then did the promised re-check of the smaller relay files:
  `test_cofacilitator_join.py`'s 2 remaining waits are the already-documented "no DOM signal for
  team/link adoption via URL open" exception from earlier in this pass and were left alone, but
  `test_relay_config_injection.py` (1 wait), `test_relay_board_path_sync.py` (4 waits, previously
  commented as deliberate "ordinary page-bootstrap settling"), and `test_relay_cross_device_sync.py`
  (8 waits) all turned out to have room left: the same synchronous-shim/synchronous-click reasoning
  established throughout this pass applied cleanly to all of them, verified empirically with 15x
  stress runs before trusting it over the older comments. This closes out every file identified in
  the original run_all.sh ROI review with zero files skipped except the intentional exceptions.
  Verified output byte-for-byte identical to every original. Full suite green: 74/74 unit tests,
  45/45 Playwright tests via `tests/run_all.sh` (58.9s).

- **2026-09-15 — Introduction stories 6, 5, and 7.** Private branch
  `codex/welcome-credits-terms` builds on updated PR #3 (`cfea8df`), including
  latest preview `ab2eaf5`. First ordinary visit shows the existing splash;
  dismissal is remembered locally and invitation links bypass it even when team
  sync strips the query parameter. Blocked storage never prevents dismissal.
  Added English/Hebrew credits with source links and bundled Apache/MIT/font
  license notices, plus informational draft terms (owner explicitly chose no
  acceptance tracking). Terms wording remains for owner review before publication.
  Source checks found unresolved assessment reuse permissions and Tuckman scale
  provenance; see `docs/credits-and-terms-review.md` for evidence and open decisions.
  New local preference only; no board-data migration. Existing users see the new
  welcome once, then their browser remembers dismissal. Shared test builder marks
  existing feature tests as returning visitors; the new first-visit test opts out.
  Test-first new regression failed on missing automatic display before changes.
  PR #3 merged during implementation; branch fast-forwarded to preview 01fd256
  before delivery. Validation: 74/74 unit tests pass; two full run_all.sh runs
  report 45/46 browser files passing, with the same existing experiment-note
  store-write timeout. Focused first-visit checks pass, including Escape and
  outside-click preference persistence; English/Hebrew terms visually inspected.
  Draft PR only; full-green Definition of Done and content approval outstanding.
- **2026-09-15 — Story 13 (CSV import/export chrome), first slice: JSON board export
  (beta), additive.** `csv.js`'s `buildBoardExport()`/`toJSON()` export the FULL board
  (config, every dimension's full definition including scored-template
  statements/scoreBands/strategies and its Hebrew `i18n.he.*` override verbatim, custom
  templates with their own `i18n`, and every squad's ratings) as one JSON file, behind a
  new "Export JSON (beta)" button in Admin — alongside `toCSV()`'s existing flat
  ratings-only export, not replacing it (that's items 3a/3b/4 below). Deliberately
  excludes `sessions` (ephemeral) and any team-sync secret (a durable credential has no
  business in a downloadable file); squad `id` is left out too, same reasoning as
  `toCSV()`'s squad matching — it's a storage artifact, not a portable identity, so
  import (not built yet) will match by name, same as CSV today.
  Reconciles the open item from the 2026-09-14 translation-export-script entry: this
  export intentionally does NOT reuse `scripts/export-template-translations.js`'s
  flattened `{en,he}`-per-field shape — that shape serves human review of AI-translated
  starter-template copy; this one serves board backup/restore fidelity, so it passes
  `state.js`'s real `i18n.he.{...}` structure straight through unchanged. Both agree on
  the same underlying field (`i18n.he.*`), just shaped for different readers.
  New data shape, migration decision stated per DoD §3: `formatVersion:1`, no migration
  needed — first version of the format, nothing existing depends on an older shape.
  Mockup-before-implementation (DoD §3) judged not to apply here: the new button is a
  visual/behavioral clone of the already-approved "Export CSV" button (same icon style,
  same click → real download via `window.claude.use("downloads")` → same
  `window.open`+`<pre>` fallback), not a new UX shape — the genuine UX decisions in this
  story (the import-preview panel, the merge/replace toggle) are items 3a/3b, still
  ahead, and will get a real mockup before implementation.
  i18n per DoD §2: new button goes through `t()`/`data-i18n` (`admin.boardSetup.exportJson`),
  both `en.js`/`he.js` updated in the same change, Playwright-verified in both languages.
  Test-first per the `tdd` skill: `tests/unit/test_json_export.js` (7 tests, pure-function
  coverage of `buildBoardExport()`/`toJSON()` — config passthrough, dimension/template
  `i18n` passthrough, squads-by-name with no `id` leak, `sessions`/secret exclusion,
  pretty-printed round-trip) written and confirmed failing before `csv.js` had the
  functions; `tests/test_json_export.py` (English label, real click → real parseable
  JSON with the right shape, Hebrew label) written and confirmed failing (missing
  button) before the HTML/locale change. Full suite verified green after: 81/81 unit
  tests, all 46 Playwright files (including relay-backed ones, after `relay/`'s own
  `npm install`), relay's own protocol suite. Story 13 table status moved to
  **In progress** — squads/dimensions/templates JSON import (items 3a/3b) and deleting
  the CSV runtime code (item 4) remain, tracked in the backlog conversation this session
  continues from. Implemented on branch `story13-json-board-export`, pushed as a PR per
  explicit instruction rather than merged into `claude/optimistic-keller-holuql` directly
  — not yet in the shared preview branch.
- 2026-09-15 — A second, more rigorous investigation into `test_retro_experiment_note_and_finish.py`'s
  cross-machine failure report (see the `codex/about-guides` entry above: reproduced there against
  commit 401fec7, `wait_for_function()` timing out on that machine). This session's environment:
  HEAD `f970639`, Python 3.11.15, Playwright 1.62.0, Chromium 151.0.7922.34. Rather than re-run the
  test as a black box, wrapped the actual runtime call chain
  (`state.db.collection("sessions").doc(sid).update(patch)`) to trace every step: whether
  `collection()`/`doc()`/`update()` were even called, the store's content immediately before and
  after the synchronous part of `update()`, and whether its returned promise resolved or rejected.
  Ran this instrumented version 20 times sequentially plus 6 concurrently (26 total) in this
  environment: every single run showed the identical, correct sequence (`collection_called` ->
  `doc_called` -> `update_called` with the store still empty -> `update_returned_sync` with the
  store already holding the new note text, synchronously, before the promise even settled ->
  `update_resolved`) and the test's own poll landed on its very first check every time. No call
  skipped, no rejection, no case of the promise resolving without the mutation. This is stronger
  evidence than the earlier 26/26 (which only checked the outcome, not the mechanism), and it still
  could not reproduce the reported failure.
  This does NOT establish the other machine's report as wrong -- there is no way to test its exact
  Chromium build from here, and the claim is not being overturned on that basis. What the
  investigation did surface: this repo pinned no Playwright/Chromium version anywhere (`pip install
  playwright` with no version in `tests/README.md`, no requirements file at all), so two machines
  running "the same test" had no guarantee of running the same browser engine, and no way to tell
  from the repo alone. Fixed that gap directly: added `tests/requirements.txt` pinning
  `playwright==1.62.0` (which also pins the Chromium build), updated `tests/README.md`'s setup
  instructions to install from it, and added a `docs/DefinitionOfDone.md` working agreement to
  check both sides' Playwright/Chromium versions before concluding a cross-machine test-timing
  report is a real bug, a flake, or a harness artifact. No production code or test wait logic was
  changed -- the instrumented trace gave no reason to believe either needs it.
- 2026-09-15 — Product-owner retrospective on the whole wait-condition saga: the standing
  "log a rising `run_all.sh` time in STATUS.md" agreement (added earlier the same day) stayed
  passive too long in practice -- the suite grew from ~102.5s to over 5 minutes, one
  individually-defensible `wait_for_timeout()` at a time, added to one new test after another,
  before anyone treated the trend itself as worth stopping for. Nobody could see that trend
  without manually timing every run and remembering to compare, which is exactly what wasn't
  happening. Closed that gap with an actual mechanism rather than another paragraph: `tests/run_all.sh`
  now times itself and compares the result against a new tracked file, `tests/.timing_baseline`
  (currently 60, matching this session's own measured ~59-62s range), printing a loud warning if
  the full suite runs more than 15% over that number -- pointing at the new `wait_for_timeout()`
  audit and baseline-update steps in `docs/DefinitionOfDone.md`'s new "growth budget" entry.
  This is explicitly scoped to every contributor now working in this repo -- Copilot (VS Code),
  Codex, Claude Code, and a human writing a test by hand -- since none of them can be expected to
  notice a compounding trend from their own one new test in isolation; the check now lives where
  the suite itself runs, not in any one tool's habits. `tests/README.md` cross-references it.
  Verified: `run_all.sh` reports its own elapsed time and does not false-trigger on a clean run
  (60s, under the 69s threshold); the trigger arithmetic was separately verified against a
  temporarily-lowered baseline. 81/81 unit tests and the full 46-file Playwright suite still pass
  unchanged -- this only added self-reporting, no test behavior changed.
- 2026-09-15 — Local Mac reproduction and repair of the experiment-note timing
  failure plus runner setup diagnostics. A fresh worktree initially turned relay
  failures into misleading `Cannot find module 'ws'` errors because ignored
  `relay/node_modules` was absent; `tests/run_all.sh` now fails fast with the
  exact `python3`/`relay && npm ci` setup commands instead. Instrumenting the
  real `state.db.collection().doc().update()` chain found the test's patch was
  `{experimentNote: ""}`: the delayed initial fake-store session snapshot
  re-rendered the textarea after the test filled it and before Save was clicked.
  The test now waits for that session listener state, yields for the documented
  otherwise-unobservable callback, and still polls/asserts the stored note.
  Verified with 10 focused runs, the full 46-file Playwright suite through
  `run_all.sh` (TEST_JOBS=2, 3 shards, 32s), and the Node unit suite; all green.
- 2026-09-15 — **Fixed finding #3 of a full app-wide untranslated-text scan**: five screen-reader-
  only `aria-label`s were never wired to `t()`/`data-i18n` at all, so a Hebrew-locale screen-reader
  user always heard them in English regardless of locale (invisible to a plain visible-text scan --
  caught by a separate static-attribute grep). Four are static markup: the header's Tribe/Squad/
  Admin view switcher ("View"), the Tribe stats section ("Snapshot at a glance"), the Admin
  language switcher ("Language"), and the team-link input ("Team link" -- reused the existing
  `admin.teamSync.linkLabel` key rather than duplicating it, since the visible label right next to
  it already says the same thing). `i18n.js`'s `applyStaticTranslations()` gained a
  `[data-i18n-aria-label]` handler, mirroring its existing `-placeholder`/`-title` ones. The fifth
  (`retro-facilitator.js`'s reveal-mode toggle, "Reveal mode") is JS-rendered, so it calls `t()`
  directly instead, matching this file's own established pattern for JS-built aria-labels. New
  locale keys: `header.viewSwitchAriaLabel`, `tribe.stats.sectionAriaLabel`,
  `admin.language.ariaLabel`, `retro.reveal.ariaLabel`. Test-first: new
  `tests/test_aria_label_language.py` covers all five, confirmed failing before the fix (the fifth
  via a real retro session's reveal-toggle), passing after. Full 81-test unit suite + 48-file
  Playwright suite green.
- **2026-09-15 — Story 13, item 3a: JSON import for squads & ratings**, additive alongside `toCSV()`'s
  existing CSV import. Design reviewed first as a real, interactive Artifact mockup ("Squad Import
  Preview" -- see the conversation this continues from) before any code, per DoD §3; the product
  owner's decisions from that review, implemented as specified:
  - **Merge/Replace is a real choice, offered every time, at BOTH the squad level and the per-squad
    rating level.** Merge (default) adds/updates squads and ratings from the file; a board squad
    absent from the file is left alone, and a matched squad's own rating for a dimension the file
    doesn't mention is left alone too. Replace removes a squad absent from the file (named in a
    warning before applying) AND clears a matched squad's own ratings the file doesn't mention (also
    named). `buildSquadImportPlan()`/`mergeSquadDimensions()` (`csv.js`) are the pure planning/merge
    functions; squads still match by NAME (`buildImportPlan()`'s existing rule, unchanged) and each
    rating's dimension still matches by KEY against the board's current set, reporting (not guessing)
    a key not found today -- same mechanism CSV import already proved.
  - **No second confirm dialog for Replace.** Instead, the warning offers a one-click "download a
    backup of this board first" (reuses item 1's `toJSON()`), plus a text tip pointing at an external
    open-source diff/merge tool (Meld) for anyone who'd rather reconcile two files by hand than trust
    either mode.
  - A real bug, caught before it ever shipped: the first draft of Replace's write path sent the
    already-clipped `dimensions` object through `.update()`, same as Merge. `local-store.js`'s
    `deepMerge()`/`relay-client.js`'s matching `update()` are additive-only -- they never drop a key
    absent from the patch -- so that would have silently left "removed" ratings sitting in the
    PERSISTED doc, merged right back in, even though the in-memory `state.squads` copy looked correct.
    Fixed by having Replace's write use `.set()` with the whole doc instead, which genuinely replaces
    the stored value. `tests/test_json_import.py` asserts on `window.__FAKE_STORE__` directly (not
    `state`, not the DOM) specifically to catch a regression of this exact mistake.
  - New data shape: none (reuses item 1's existing board-export shape); no migration question, per
    DoD §3.
  - i18n per DoD §2: the new button and the whole preview modal (mode switch, chips, warnings, skip
    list, error states) go through `t()`/`data-i18n`, `en.js`+`he.js` updated together, count-sensitive
    strings via a `countKey()` helper (One/Many key pairs, same convention as `templates.js`'s
    `templates.meta.dimensionsOne/Many` -- `t()` has no built-in pluralization).
  - Test-first per the `tdd` skill: `tests/unit/test_json_import.js` (14 tests -- `parseBoardImportFile()`'s
    version/shape checks, `buildSquadImportPlan()`'s merge/replace/skip logic, `mergeSquadDimensions()`'s
    pure merge math) written and confirmed failing before `csv.js` had the functions.
    `tests/test_json_import.py` (button/label, both error states, a full Merge apply, a full Replace
    apply including the backup offer, Hebrew label) written and confirmed failing (missing button)
    before the HTML/locale change; every wait is a real condition (`wait_for_function` polling
    `window.__FAKE_STORE__` directly, since `state.live` is true under this harness and new-squad
    creation takes the async branch) per DoD §1, stress-tested 10x clean.
  - Full suite green: 95/95 unit tests, all 47 Playwright files, relay's own protocol suite.
    `tests/.timing_baseline` updated 60 -> 78s -- legitimate growth (two new, real Playwright files
    this story added, `test_json_export.py` and `test_json_import.py`, neither with a `wait_for_timeout()`
    call), not slop, per DoD §1's growth-budget rule.
  - Story 13 table status: item 3a now **DONE**. Remaining: item 3b (JSON import for
    dimensions/templates/config, its own mockup first) and item 4 (delete the CSV runtime code).
    Implemented on branch `story13-json-import-squads`, pushed as a PR rather than merged into
    `claude/optimistic-keller-holuql` directly, matching item 1's delivery pattern.
- **2026-09-15 — Story 13, item 3a: four review findings on PR #7, all real, all fixed.** Verified
  each against the actual code before touching anything, then fixed test-first:
  1. **Backup "success" shown even when the backup never happened.** The backup-first button's
     `catch` swallowed a rejected `downloads.save()`, and the fallback `window.open()` returning
     `null` (a blocked popup) both still reached the unconditional "Backup downloaded" line --
     exactly the wrong failure mode for the one safety net Replace mode offers instead of a confirm
     dialog. Now tracks success explicitly and shows a new `importJson.backupFailed` message
     ("try again, or use Export JSON instead") when it isn't real. Playwright-tested by actually
     forcing the failure (monkeypatching `window.open` to return `null`, the real code path this
     harness's `downloads` capability always takes since it's always `null`), not just inspecting.
  2. **A REPLACE plan that only clears existing ratings couldn't be applied.** The Apply button's
     disabled condition checked `ratingCount`/`newSquadNames`/`squadsToRemove` but not
     `clearedRatings` -- a file naming every board squad but with fewer ratings than before (a
     legitimate "restore to unscored" case) left Apply permanently disabled. Extracted the check
     into its own pure `planHasChanges()` (now unit-tested directly, 2 new tests) rather than an
     inline HTML-string condition.
  3. **A malformed squad entry crashed instead of showing the error UI.** `buildSquadImportPlan()`
     ran directly inside `FileReader.onload` with no try/catch; a `null` entry in `squads`, or a
     non-string `name`, threw an uncaught exception instead of the intended "can't read this file"
     message. Fixed by validating each entry's shape in `parseBoardImportFile()` itself (the one
     function that already decides ok:true/false) -- a non-object entry, a non-string `name`, or a
     non-plain-object `dimensions` now all fail cleanly as `invalid-squad`, before
     `buildSquadImportPlan()` ever sees them. 4 new unit tests, 1 new Playwright scenario.
  4. **The import modal wasn't in `RTL_SCOPED_CONTAINERS`.** Its strings were translated, but
     `#importJsonBackdrop` was never in `i18n.js`'s list of containers `applyScopedDirLang()`
     flips -- confirmed with Hebrew selected: `dir`/`lang` were empty and computed direction was
     `ltr` despite Hebrew text on screen. Added it to the list (matching how `#aboutDialog` was
     added for the About & Help story); the existing Playwright test only checked the *button*
     label in Hebrew, so extended it to also open the modal and assert `dir="rtl"`,
     `lang="he"`, and a real `getComputedStyle().direction` check, not just the button.
  All four confirmed fixed end-to-end via `tests/test_json_import.py` (now 4 new scenarios: a
  malformed-entry error, a forced backup failure, a ratings-only-clear Apply + real persisted
  result, and the RTL/lang check), stress-tested 10x clean; `tests/unit/test_json_import.js` grew
  from 14 to 20 tests (`invalid-squad` validation, `planHasChanges()`). Full suite green: 101/101
  unit tests, all 48 Playwright files, relay's own protocol suite. Pushed to the same
  `story13-json-import-squads` branch/PR rather than opening a new one.
- **2026-09-15 — Story 13, item 3a: a fifth review finding on PR #7, on re-review of the fix
  above, real and more severe than it first reads.** `parseBoardImportFile()`'s new validation
  checked the squad/dimensions CONTAINERS but not a rating's own field types -- a file with
  `{color:"good", note:123}` passed validation, got persisted, then crashed rendering
  (`render.js`'s/`squads.js`'s `cell.note && cell.note.trim()` assumes a string). Verified the
  repro directly before fixing. **Found something broader while fixing it**: `color`/`trend` are
  interpolated UNESCAPED into a CSS class attribute in both of those same files
  (`'cell-btn '+color+'"'`) -- always safe before because every existing writer (the rating-modal
  UI, CSV's `colorFromWord()`) only ever produces one of a fixed enum, but this JSON import path
  copied whatever string a file contained, which is real attribute-injection room for a
  color/trend value containing a `"`. Fixed both with the same check: `isValidRating()`
  restricts `color` to the app's actual 4-value enum and `trend` to its actual 3-value enum (not
  just "must be a string"), `note` to a string, applied per-rating inside
  `parseBoardImportFile()`'s existing squad-shape loop. 6 new unit tests (bad container, bad
  note/color/trend, and two "still accepts a well-formed/empty rating" negatives so the check
  isn't just permissive-by-accident). New Playwright regression, per the review's explicit ask:
  imports the exact `note:123` repro, confirms the friendly error shows, zero uncaught page
  errors, AND (the part that actually proves the fix, not just the symptom) an EXACT equality
  snapshot of the target squad's persisted `dimensions` before vs. after the rejected import --
  catching a partial/silent write, not just "the literal bad value isn't there." Stress-tested
  10x clean. Full suite green: 107/107 unit tests, all 48 Playwright files, relay's own protocol
  suite. Same branch/PR again.
- **2026-09-15 — Story 13, item 3a: a sixth review finding on PR #7, a third round on the same
  validation fix, all three parts real.** The rating-enum check added for finding #5 used bracket
  lookup (`VALID_RATING_COLORS[r.color]`) directly on an untyped value -- unsafe three distinct
  ways, each independently verified with a throwaway `node -e` repro before touching anything:
  (1) a non-string COERCES to a matching key string (`["good"]` stringifies to exactly `"good"`,
  so an array passed the check); (2) a string naming an INHERITED `Object.prototype` property
  (e.g. `"constructor"`) read truthy even though it was never one of the four real colors; (3) an
  object with a non-callable `toString` THROWS converting itself into a property key
  (`TypeError: Cannot convert object to primitive value`) -- uncaught, the same
  "bypasses the friendly error UI" failure as finding #3, just reached through the rating check
  this time instead of the squad-shape check. Fixed with `isValidEnumWord()`: requiring
  `typeof value === "string"` FIRST means a throw can never happen (only strings ever reach the
  lookup) and forecloses the coercion case; `Object.prototype.hasOwnProperty.call()` (not bracket
  lookup) means an inherited property name never counts as a match. 5 new unit tests (array
  coercion and inherited-property cases for both `color` and `trend`, plus the throwing case
  wrapped in `assert.doesNotThrow`), plus one new Playwright scenario for the throwing case
  specifically (the one genuinely crash-capable of the three -- the other two are pure
  validation-logic mistakes with no throw risk, so left at unit-level coverage, proportionate to
  what each actually risks) -- confirms the friendly error shows, zero uncaught page errors, and
  the persisted store is untouched, same before/after-equality-snapshot rigor as finding #5's
  regression. Stress-tested 10x clean. Full suite green: 112/112 unit tests, all 48 Playwright
  files, relay's own protocol suite. Same branch/PR a third time.
- 2026-09-15 — **Fixed two gaps from a full app-wide untranslated-text scan** (findings #1/#2 of
  4; #3, five untranslated `aria-label`s, deferred; #4/#5, CSV import/export chrome and file
  content, explicitly out of scope -- product owner call): the generic confirm modal
  (`modals.js`'s `openConfirm()`, shared by every "remove/close/delete/finish" confirmation in the
  app) had two real gaps under Hebrew. (1) Its Cancel button (`#confirmCancel`) was never touched
  by `openConfirm()` -- title/message/OK button are all set per-call via `t()`, but Cancel stayed
  at its static English HTML default in every locale, on every confirm dialog in the app. Fixed
  with a new shared `common.cancel` key (`locales/en.js`/`he.js`, alongside the existing
  `common.ok`) and a `data-i18n="common.cancel"` on the static button -- no `modals.js` change
  needed, since `i18n.js`'s `applyStaticTranslations()`/`setLocale()` already handle a static
  `data-i18n` element for free. (2) `#confirmBackdrop` was missing from `i18n.js`'s
  `RTL_SCOPED_CONTAINERS` list, so even with correctly-translated Hebrew text, the dialog box
  itself never got `dir="rtl"` -- added it. Test-first: extended
  `test_dim_manager_language.py`'s existing remove-confirm-dialog scenario with both assertions,
  confirmed failing before either fix, passing after. Full 81-test unit suite + 47-file Playwright
  suite green.
- 2026-09-15 — Follow-up (PR #6 review), first attempt was wrong, caught by a second
  review before merge. First pass replaced that fix's `page.wait_for_timeout(25)` with
  `page.evaluate("() => new Promise(r => setTimeout(r, 0))")`, reasoning the stray
  re-render came from `local-store.js`'s `onSnapshot()` (a `setTimeout(fn, 0)`). Wrong on
  both counts: Playwright tests never load `local-store.js` at all -- `build_page()`
  splices in `tests/fixtures/fake_store.html` instead, whose every `onSnapshot()`
  delivers via `setTimeout(fn, 10)`, not 0. A second review (Codex) reproduced the gap
  directly: the zero-delay flush can resolve before that real 10ms delivery fires, so
  the original race stays possible; the first attempt's own 10/10 clean local runs never
  caught it because enough real time had already elapsed from preceding CDP round-trips
  to mask it, which is exactly the kind of false confidence a wall-clock-shaped wait
  produces. Traced the actual mechanism instead of guessing again:
  `retro-facilitator.js`'s `subscribeSessionResponses()` creates a fresh
  `sessions/<id>/responses` collection listener the FIRST time a new session's card
  renders (guarded so it never re-subscribes for the same id); that listener's callback
  re-renders the whole squad view, and the fake store's `setTimeout(..., 10)` for its
  first delivery is the actual pending timer that can land between `fill()` and `click()`.
  Fixed for real this time with a named, path-specific signal instead of any timer at
  all: `fake_store.html` now exposes `window.__FAKE_STORE_DELIVERY_COUNTS__`, a per-path
  delivery counter incremented at every `onSnapshot` callback invocation (both the
  delayed initial one and every `notify()`-triggered one), purely additive so every other
  test's behavior is unchanged. The test waits for
  `__FAKE_STORE_DELIVERY_COUNTS__['sessions/'+sid+'/responses'] >= 1` before typing --
  verified this is a real, non-vacuous condition (transitions 0 -> 1, not already-true
  from some unrelated delivery) via a standalone repro before trusting it. Verified with
  10 focused runs of `test_retro_experiment_note_and_finish.py` (all clean), the full
  47-file Playwright suite via `run_all.sh` (TEST_JOBS=4, 3 shards, 48s), and the 82/82
  Node unit suite -- zero regressions from the shared fixture's added instrumentation.
- **2026-09-15 — Story 13, item 3b: JSON import for dimensions, templates & board settings**,
  extending the same file/preview/Merge-Replace modal item 3a shipped rather than adding a second
  one. Design reviewed first as an updated Artifact mockup (the same "Full Board Import Preview"
  the item 3a mockup evolved into -- see the conversation this continues from) before any code,
  per DoD §3; the product owner's decisions from that review, implemented as specified:
  - **Dimensions and saved templates both match by LABEL/NAME, not key/id** -- initially proposed
    as key-matching for dimensions (consistent with 3a's rating-to-dimension matching) and
    name-matching for templates, the product owner asked why the two would differ. Investigating
    turned up a real fact neither of us had checked yet: a custom dimension's key
    (`"local-dim-"+Date.now()`, `dimensions.js`'s `addDimension()`) is exactly as device-local and
    random as a template's id (`"local-tpl-"+Date.now()`) -- only the three built-in starter
    templates' dimensions have meaningful, hand-picked keys. Key-matching a custom dimension would
    have imported it as "new" on every single re-import, including re-importing your OWN board's
    own file, defeating the whole point of this item (importing a template set between tribes).
    Settled on label/name matching for both, confirmed by the product owner. 3a's own
    rating-to-dimension matching (by KEY, against the board's CURRENT set) is a different question
    entirely and is untouched either way.
  - **A Squads-vs-Templates import SCOPE choice**, both checked by default, independently
    uncheckable -- the product owner's own stated reason: wanting to import a template set from
    one tribe into another board without dragging that tribe's squads/ratings along for the ride.
    "Templates" scope bundles dimensions + saved templates + board settings as one unit (matching
    how the backlog item itself was already grouped, confirmed over a 3-way-split alternative).
  - Merge/Replace still one single toggle governing everything in whichever scope(s) are checked,
    same mental model already approved for 3a, not a second control to learn. Replace's danger
    warning grew two new named groups (dimensions / saved templates) alongside 3a's existing
    squad/rating ones, same backup-first safety net, still no second confirm dialog. Board settings
    (config: unit/unitPlural/activeTemplateName/attribution) have no Replace/remove concept at all
    -- four named fields, not a collection, so whatever the file has just overwrites the matching
    field in either mode, shown as a plain before/after diff instead of chips.
  - **A real, serious bug caught before it ever ran against real data, not a review finding this
    time:** formatVersion:1 makes `dimensions`/`templates`/`config` genuinely OPTIONAL top-level
    keys (unlike `squads`, required since item 1) -- exactly the shape every existing item
    3a-only fixture already uses (`{"formatVersion":1,"squads":[...]}`, no other keys at all). The
    first draft of `buildDimensionImportPlan()`/`buildTemplateImportPlan()` treated "key absent"
    the same as "key present with an empty array," so opening an ordinary squads-only file in
    REPLACE mode would have silently wiped every dimension and every saved template off the board
    -- found by running `test_json_import.py`'s own pre-existing item 3a "replace" scenario after
    wiring the new code in, and seeing its warning box unexpectedly list every board dimension for
    removal. Fixed by having both planning functions return an untouched, empty plan when their
    input is `undefined` -- `undefined` (key absent, file has no opinion) and `[]` (key present,
    file explicitly claims zero) are different claims, and only the second one means anything. Two
    new unit tests lock this in (`buildDimensionImportPlan(undefined, "replace")`/
    `buildTemplateImportPlan(undefined, "replace")` must return empty plans), and the Playwright
    dimension/template-removal scenario deliberately unchecks the squads scope and asserts no
    squad-removal warning appears, proving the (separate, correctly-required) `"squads": []` in
    that same test file's own fixture doesn't leak into scopes it wasn't checked for.
  - New data shape: none (reuses item 1's existing board-export shape); no migration question, per
    DoD §3.
  - i18n per DoD §2: the scope checkboxes, new section headings (Dimensions/Saved templates/Board
    settings), new chip rows, the config diff, and the two new removal-warning groups all go
    through `t()`/`data-i18n`, `en.js`+`he.js` updated together, same `countKey()` One/Many
    convention as the rest of this modal. The now-inert old "also in this file, not imported here"
    stub note/keys (`importJson.scopeDimensions`/`scopeTemplates`/`scopeConfig`/`scopeNote`) were
    removed rather than left dead, since this item is exactly what replaces them.
  - Test-first per the `tdd` skill: `tests/unit/test_json_import.js` grew from 31 to 62 tests --
    `parseBoardImportFile()`'s new dimension/template/config shape validation (mirroring the
    squad/rating validation's parse-boundary rule), `buildDimensionImportPlan()`/
    `buildTemplateImportPlan()`'s label/name matching and merge/replace removal logic (including
    the undefined-vs-empty-array regression above), `buildConfigImportPlan()`'s known-fields-only
    diffing, and `entityImportPlanHasChanges()`'s Apply-button gate -- all written and confirmed
    failing before `csv.js` had the functions. `tests/test_json_import.py` gained 5 new scenarios
    (Apply disabled with no scope checked; a combined merge that adds+updates a dimension, adds a
    saved template, and changes a config field, all asserted against `window.__FAKE_STORE__`
    directly; a replace that removes a dimension and a saved template with the squads scope
    deliberately off; unchecking the templates scope leaves it out of both the DOM and the actual
    apply) -- every wait is a real condition per DoD §1, stress-tested 5x clean.
  - Full suite green: 143/143 unit tests, all 48 Playwright files (78s, at the existing baseline --
    no new file added this time, so no baseline update needed), relay's own protocol suite.
  - Story 13 table status: item 3b now **DONE**. Remaining: item 4 (delete the CSV runtime code).
    Implemented directly on `story13-json-import-squads`, continuing to push to the same branch --
    PR #7 (item 3a) turned out to have already been merged into `claude/optimistic-keller-holuql`
    partway through this session, so this item's own commit needed a fresh PR (#12) rather than
    riding PR #7; noted, not treated as a problem, since the branch itself was untouched either way.
- **2026-09-15 — Story 13, item 3b: a real review finding on PR #12 (P1), the product owner acting
  as reviewer, "fix before approval."** A combined squads+dimensions import silently dropped
  ratings whenever a rating's dimension key didn't literally exist on THIS board -- true for
  every genuine cross-board import, not an edge case, since item 3b's own design (see above)
  deliberately matches dimensions by LABEL rather than key, so two boards/devices never share a
  dimension's random `"local-dim-"+Date.now()` key even for "the same" labeled dimension.
  Reproduced independently before touching anything (`node -e` against the real functions,
  matching the reviewer's own real-browser repro exactly): a file with a brand-new custom
  dimension and a squad rating for it imported the dimension, but persisted the squad with
  `dimensions: {}` -- the preview even claimed "0 ratings to import" despite showing that exact
  dimension ready to add, since `buildSquadImportPlan()` only ever matched a rating's file-key
  against the board's CURRENT dimension set, built before either a new dimension exists or an
  existing one's real (different) key is known.
  Fixed two ways, both in `csv.js`:
  1. `buildSquadImportPlan()` now also tries a file-key -> label -> CURRENT-board-dimension-by-label
     fallback (using the file's own `dimensions` section to look up what label a rating's key
     refers to) before giving up -- covers an EXISTING same-labeled dimension whose key just
     differs from the file's, unconditionally (doesn't depend on the Templates scope being
     checked, since no dimension needs to be created for this case).
  2. A new optional third argument, `extraDimensionLabels` (`buildDimensionImportPlan()`'s own
     `added` list, passed in only when the Templates scope is actually checked -- otherwise
     nothing will create that dimension this round, and the rating correctly still reports "not
     found"), lets a rating for a dimension that doesn't exist YET but WILL by the time Apply
     finishes resolve to a `pendingDimensionKey()` marker instead of being skipped.
     `resolvePendingDimensionKeys()` turns that marker into the dimension's real key once it
     actually exists -- called from the Apply-button handler, which now sequences the two applies
     instead of firing them in parallel: `applyDimensionTemplateConfigImportPlan()` gained an
     optional `onDone` callback, fired only once every dimension/template write (including a
     brand-new dimension's real generated key) has actually landed in `state.dimensions`, and the
     squads/ratings apply now runs from that callback instead of immediately. Verified safe for
     both the fake-store test harness and real deployments before relying on it: both
     `tests/fixtures/fake_store.html` and the real `public/local-store.js` call their `add()`'s
     `notify()` SYNCHRONOUSLY, before the returned Promise even resolves, so `state.dimensions`
     is already current by the time the sequenced callback runs, in both.
  Found and fixed a second, self-inflicted bug while writing this fix: the first draft used an
  actual embedded NUL byte (`"\u0000pending-dimension:"`) as the marker prefix, meant as a
  belt-and-suspenders "can never collide with a real key" guard -- caught immediately because it
  turned `csv.js` into a binary file (`file` reported "data", `grep` refused to match it as
  text). Replaced with a plain, printable prefix (`"pending-dimension:"`); a collision was never
  actually reachable either way, since `fileDims`'s keys are always either a real destination
  dimension's own key or this constructed marker, never a file-supplied key used as-is.
  6 new unit tests (`tests/unit/test_json_import.js`, 62 -> 68: the label-fallback match, the
  "still not found" negative, the pending-marker path with and without `extraDimensionLabels`,
  and `resolvePendingDimensionKeys()`'s resolve/drop cases) plus one new Playwright scenario
  (`tests/test_json_import.py`) reproducing the reviewer's exact repro end to end -- a new custom
  dimension AND an existing dimension referenced under a different source key, both with real
  ratings, both scopes checked -- asserting the persisted squad doc under `window.__FAKE_STORE__`
  carries the ratings under real destination keys, with zero leftover pending markers. Stress-tested
  5x clean. Full suite green: 149/149 unit tests, all 48 Playwright files (75s, under the 78s
  baseline), relay's own protocol suite. Same branch/PR (#12).
- **2026-09-16 — Story 13, item 4: deleted the CSV runtime code and renamed `csv.js` →
  `board-export-import.js`.** JSON is now the board's only export/import format. Two decisions
  confirmed with the product owner before touching anything: (1) full removal (export AND import),
  not just the export button, since JSON already fully replaces both directions; (2) the rename
  target, `board-export-import.js` — matches this repo's existing `board-sync.js` naming pattern
  (names the domain, not the format), confirmed over `board-io.js` (too terse) and
  `json-export-import.js` (names the format instead).
  - Removed from `csv.js`/now `board-export-import.js`: `toCSV()` + the `exportBtn` handler, and
    the entire CSV import section (`parseCSV`, `colorFromWord`, `trendFromWord`,
    `mapImportColumns`, `buildImportPlan`, CSV's own `renderImportPreview`/`applyImportPlan`/
    `applyImportRatingsToSquad`). Everything left is JSON board export/import.
  - `index.html`: removed the `Export CSV`/`Import CSV` buttons, the `#csvFileInput`, and the
    entire CSV import preview modal (`#importBackdrop`). Removed the now-dead
    `admin.boardSetup.importCsv`/`exportCsv` i18n keys (`en.js`/`he.js`). No CSS changes needed --
    every class the CSV modal used (`.import-stats`/`.import-warning`/`.import-skips`/etc.) is
    shared with, and still actively used by, the JSON import modal.
  - **A real regression, caught by the full suite, not by writing a new test first:**
    `app.js`'s cross-cutting Escape-key handler had its own reference to CSV's `importBackdrop`/
    `closeImport()`, missed by every grep pass because it was scoped to `public/js/*.js` and
    `tests/`, never `public/app.js` itself. Pressing Escape anywhere threw an uncaught
    `ReferenceError` there and aborted the rest of that handler -- silently breaking Escape-to-close
    for the join-code modal too (the next line, never reached). Found by `test_retro_join_flow.py`
    failing (reproducibly, 3/3) after this change, confirmed as a genuine regression rather than a
    pre-existing flake by running the same test against the pre-refactor code via `git stash`
    (passed cleanly there). Fixed by pointing that line at the JSON import modal's own
    `importJsonBackdrop`/`closeSquadImport()` instead of deleting it outright -- which also fixes a
    separate, latent gap: the JSON import modal apparently never had Escape-to-close wired in at
    all, even after items 1/3a/3b. No new test needed for the fix itself: `test_retro_join_flow.py`
    already covers Escape-closing a modal and is what caught the break; re-run 3x clean after the
    fix, then folded into the full-suite pass below.
  - Test suite: deleted `tests/unit/test_csv.js` and `tests/test_csv_import_column_matching.py`
    outright (purely CSV). Trimmed and renamed two files that mixed CSV coverage with unrelated
    coverage rather than deleting them wholesale: `test_template_switching_and_csv_import.py` →
    `test_template_switching.py` (kept the template-switching scenarios, dropped the CSV-import
    half); `test_tooltip_busy_overlay_and_csv_key.py` → `test_tooltip_and_busy_overlay.py` (kept
    the tooltip coverage and the template-switch busy-overlay scenario; replaced the
    CSV-import-triggers-the-busy-overlay scenario with a JSON-import equivalent rather than
    dropping that coverage; dropped the CSV "Dimension Key column" round-trip scenario outright --
    that column only ever existed to work around CSV's flat-table format having no natural way to
    reference a dimension except by label, a problem JSON's `dimensions[key]` shape never had).
    Same trim for `test_hebrew_rtl_coverage.py`'s CSV Hebrew round-trip section (Section 9) and
    `test_json_import.py`'s existing Hebrew-label assertion (unrelated to this, left alone). Ported
    forward the one property actually worth keeping from the deleted "Dimension Key" coverage --
    re-importing an export still matches a rating to the right dimension after its label has been
    renamed/translated -- as a new, JSON-native unit test (`buildSquadImportPlan()` matches by KEY
    unconditionally, unrelated to label at all, so the property holds by construction; the test
    proves it directly rather than via CSV's column workaround). `test_local_store.py` and
    `test_view_navigation_and_squad_admin.py` each had one CSV-triggered scenario (a real-download
    check, an Admin-view smoke check) swapped for the JSON equivalent rather than deleted, since
    both were really testing something else (the `downloads` capability firing a real browser
    download; that Admin's buttons still open their modals) that just happened to use CSV as the
    trigger. `helpers.js`'s `fake_dom.js`, both READMEs (`tests/README.md`,
    `tests/unit/README.md`), and `.claude/skills/tdd/SKILL.md` updated to stop citing deleted
    files/functions as current examples -- `docs/refactoring-report.md`'s own `csv.js` references
    left untouched, since it's an explicitly dated 2026-09-12 snapshot report, not living
    documentation (same convention as this file's own "historical mentions... left as-is" rule for
    old test names).
  - Also fixed in passing: a self-inflicted NUL byte in this file's own previous session-log entry
    (quoting the buggy `" pending-dimension:"` marker literally embedded `csv.js`'s bug
    into STATUS.md's own bytes, the same mistake, caught by the same `file`/`grep` symptom) --
    escaped as readable text instead.
  - **Flagged, not fixed (out of scope for this rename/cleanup):** `local-store.js`'s
    `triggerBrowserDownload()` hardcodes `Blob` type `text/csv;charset=utf-8` for every download
    regardless of what's actually being saved -- pre-existing (already wrong for the JSON export
    button since item 1, unrelated to CSV's removal), low-impact (browsers generally trust the
    `download` attribute + filename extension over blob MIME type for a local save, which is why
    nothing user-visible broke), but worth a follow-up to derive the type from the filename.
  - Full suite green: 137/137 unit tests (down from the prior tier's count, minus `test_csv.js`'s
    own tests, deleted along with the file), all 47 Playwright
    files (one fewer than 48: `test_csv_import_column_matching.py` deleted outright), 71s --
    under the 78s baseline, no update needed. Relay's own protocol suite passing.
  - Story 13 status: **DONE** -- all four items complete. The CSV→JSON board export/import
    redesign this story tracked from its very first backlog conversation is finished.
- 2026-09-16 — PR #12, second review round (P1): `buildSquadImportPlan()` (`board-export-import.js`)
  still misattributed a rating whenever its file-key happened to COINCIDE with a destination-board
  key that meant something else -- the code tried a key match before a label match, so once the
  file's own `dimensions` section said a key now means a different label, that label was never
  even consulted. A built-in dimension's key is fixed and identical on every board, and renaming a
  dimension keeps its key too, so this wasn't a rare edge case: reviewer's real-browser repro was a
  source board's "release"-keyed dimension relabeled to "Custom imported dimension" (i.e. someone
  renamed their local copy of a starter dimension), landing its rating on the DESTINATION board's
  own differently-labeled "release" dimension instead, in both Merge (silently wrong target) and
  Replace (worse: the destination's real "release" dimension, correctly absent from the file's own
  label list, gets removed as unmentioned, orphaning the rating that was wrongly written under its
  key). Fixed by flipping the priority: whenever the file's `dimensions` section names a label for
  that key, matching goes by LABEL only (existing-by-label, or pending creation via the same
  `pendingDimensionKey()` mechanism as the first review round) -- key matching survives only as the
  fallback for a squads-only file with no `dimensions` section at all (the only case with no label
  to weigh instead, unaffected by this bug). Test-first: added 3 failing unit tests reproducing the
  exact repro (label-wins-over-coincidental-key, its pending-creation resolution, and the Replace
  variant with the correctly-orphaned board rating) before touching `board-export-import.js`
  itself; rewrote one prior test (`buildSquadImportPlan() still matches a rating by key after the
  board's dimension label has been renamed`) that had been asserting the OLD, now-disproven
  priority -- that test's real premise (own-board re-import after a label rename) turns out to
  already collide with item 3b's own established "dimensions match by label, not key" design even
  before this fix (re-importing your own renamed dimension creates a same-key duplicate under the
  old label either way, an already-accepted limitation, not something this fix changes); replaced
  it with a test for the genuine surviving case, a squads-only file with no `dimensions` section.
  No new Playwright scenario: this fix is entirely inside the pure planning function, and the
  wiring path it runs through (pending-marker creation + resolution + sequencing) is already
  proven end-to-end by the existing combined-import Playwright scenario from the first review
  round -- per this repo's own TDD skill, a scenario that would only re-verify matching logic
  already covered by a unit test doesn't earn its cost.
  - Also: this environment's pre-baked Playwright Chromium cache was pinned to an older browser
    revision (1194) than this repo's pinned `playwright==1.62.0` package expects (1234) --
    `BrowserType.launch` failed outright with "Executable doesn't exist." Worked around locally by
    symlinking the 1234-named paths the package looks up to the already-present 1194 binaries (no
    network fetch, nothing added/changed in the repo itself) so the full suite could actually run
    in this container; not a code change and not committed.
  - Full suite green: 141/141 unit tests, all 47 Playwright files (67s, under the 78s baseline),
    relay's protocol + storage suites passing.
- 2026-09-16 — Recorded a PO decision, not implemented yet (another session has the code): drop the
  retro session's typed 6-character join code, leaving QR code and link as the only ways to join,
  plus a security notice shown alongside the link/QR. Split out of a broader security backlog item
  (SEC-1 → SEC-2). Full detail, the exact notice copy, and the open question this raises for the
  session-key-derivation decision are in "Decisions locked in" above.
