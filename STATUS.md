# Squad Pulse — Status

One-page entry point for picking this project up cold. Update the session log at the bottom
whenever you finish a chunk of work — this is the one place "what's outstanding" lives; the other
docs in `docs/` are reference material this file points to, not duplicates of it.

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
- Two-tier regression coverage under `tests/`, all passing as of the last run (2026-09-12) — see
  `tests/README.md`. **`tests/unit/`**: 3 plain-Node files (`node:test`, nothing to install) for
  pure logic with no DOM dependency — consolidation/scoring math, CSV parsing/column-matching —
  running in ~0.1s total (see `tests/unit/README.md`). **`tests/test_*.py`**: 26 Playwright files
  (named for the feature/flow each one covers) for everything that needs a real browser, running in
  around 2 minutes total after two 2026-09-12 perf passes (see the session log below) — zero JS errors on
  the last run. Most drive the app through a fake in-memory store (`tests/fixtures/fake_store.html`
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
| `state.js` | Shared `state` object, starter templates, placeholder squads/dimensions, initial UI-prefs load. Loads first. |
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
own `window.claude` and loads after this file — see `build_page.py`). **Retro sessions now
genuinely sync across different devices/browsers** through the relay — see the new bullet above and
`relay/README.md`. Squads/dimensions/templates/config still don't sync across devices, per the
locked decision below; only a session's own content does.
(There's one other `window.claude.use(...)` call, for `"downloads"` in `public/js/csv.js`, and a
`window.claude.hot` hot-reload guard at the bottom of `app.js` that already degrades safely with no
`window.claude` present — neither of those blocks anything.)

## Decisions locked in (don't re-litigate these)

- **No persistent, multi-tenant database, ever — being deliberately reversed, incrementally, as of
  2026-09-12.** This was the original decision (a facilitator's own browser as the board's sole
  source of truth), but it's the direct cause of a real bug: two devices independently seed
  identical squad IDs, so per-device `localStorage` boards never actually agree once more than one
  device is involved in a retro. The replacement direction — **see "Board sync (major change, in
  progress)" below** — keeps the relay content-blind (server never sees plaintext, unchanged) but
  makes it a durable, pluggable, encrypted key-value store for the whole board, not just live
  session traffic. Being rolled out as a sequence of small, independently-tested,
  independently-shippable increments; nothing here breaks until a later increment explicitly wires
  board reads/writes through it.
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

## Board sync (major change, in progress)

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
7. Promote from opt-in to default-on once proven; retire the "no persistent database" language in
   this file, `README.md`, and `docs/standalone-plan.md` for good.

Also on deck, not yet scheduled into a specific step: a participant's way to leave the retro join
screen and return to the main app and back to their own participation; a co-facilitator join path
via code/link (payoff of steps 5–6 plus a facilitator-role join flow).

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

## Deliberately not built yet (and why)

| Not built | Why it's cut for now | What would trigger building it |
|---|---|---|
| Relay deployed anywhere public | Built, tested, and now deploy-ready (`render.yaml` + `SQUAD_PULSE_RELAY_URL`-driven build step — see `relay/README.md`), but this session has no hosting/Vercel account access to actually click "deploy" | Whoever has account access runs the Render blueprint (or any equivalent host) and sets the Vercel env var — see `relay/README.md`'s "Wiring the deployed static site to this relay" for the exact steps, including testing it on a Preview deployment before merging to `main` |
| Co-facilitator ACCESS (not ownership anymore) | The data-layer half of this is resolved (see "Board sync" step 6): once two devices are connected to the same team link, "Finish & apply" on either one reaches the other live, since both share the same synced `squads`/`dimensions`. What's left is the UI/access layer — a genuinely different device actually getting a facilitator-shaped view (live tally, override, finish button) for a session it didn't start, rather than the participant-only join screen. That's story 10 (co-facilitator join via barcode/link), not yet built. | Story 10 |
| Save-board / Load-board-to-file | `local-store.js` already persists the board via `localStorage`, which covers the same browser/device | Once someone needs a board to move between browsers/devices without a relay |
| Relay deployed on Vercel itself (one deployment, not two) | Deliberately rejected, not just deferred — see the locked decision above and `relay/README.md`'s "Why not a Vercel Function" | Only if Vercel's WebSocket support later guarantees same-instance routing without an external store, which would remove the reason this was rejected |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |

## Suggested next step

Two independent tracks, either can go first:

1. **Deploy the relay.** No code changes needed — the static site is already live on Vercel; the
   relay just needs someone with a Render (or equivalent) account to run the `render.yaml`
   blueprint at the repo root, then set `SQUAD_PULSE_RELAY_URL` in Vercel's project settings (scope
   it to Preview first to test on this branch before merging to `main`, then Production). Full
   steps: `relay/README.md`'s "Deploying it" and "Wiring the deployed static site to this relay".
   This is the real unblock for testing cross-device retro sessions with a real team, not just in
   this repo's own tests.
2. **Resolve the co-facilitator "finish retro" question** above, then build whatever it takes
   (likely a relay-carried "finish" action the session's owning device listens for and applies
   locally, rather than a raw squads-collection write from any device).

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
