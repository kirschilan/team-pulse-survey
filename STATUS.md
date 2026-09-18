# Squad Pulse — Status

One-page entry point for picking this project up cold: current state, locked-in decisions, and the
open backlog — this is the one place "what's outstanding" lives. The dated session log of past
work lives in **[`docs/session-log.md`](docs/session-log.md)** (split out 2026-09-18, REF-11, to
keep this file itself actually one page); append a dated entry there, not here, whenever you finish
a chunk of work. The other docs in `docs/` are reference material this file points to, not
duplicates of it.

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
  2026-09-12 via real testing on one). **The relay is deployed on Render.com** (confirmed by the PO
  2026-09-17 — this was done at the very start of implementing the retro feature, but never got
  logged here at the time; see the relay bullet below and `relay/README.md` for the deploy shape).
  The actual `SQUAD_PULSE_RELAY_URL` value isn't hardcoded here — it's a real, live Vercel env var
  that differs per environment (Production/Preview) and would go stale the moment it's rotated;
  `relay/README.md` documents how to find/set it. (Not a secrets concern — a Codex review on PR #25
  caught this file, and `ETHICS.md`, both drawing the wrong conclusion about why: the URL is a
  public, build-time-emitted service endpoint, not a credential — see `ETHICS.md`'s own corrected
  Section 1.)
- **Retro sessions now sync across real devices.** `relay/` is a small standalone Node/`ws`
  WebSocket server; `public/js/relay-client.js` + `public/js/crypto.js` route every
  `sessions`-rooted `db` call to it (encrypted, per the decision below) instead of `localStorage`,
  while squads/dimensions/templates/config stay local as before. Verified end to end — real relay
  process, two independent browser contexts, real WebSocket, real AES-GCM — by
  `tests/test_relay_cross_device_sync.py`. Deployed on Render.com and wired to the Vercel deployment
  via its own env var (see above) — see `relay/README.md` for the deploy/wiring steps this followed.

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
| `board-export.js` | JSON board export (squads/ratings, dimensions, templates, board settings) — the only board export format; CSV's own runtime code was deleted, and this whole area was renamed from `csv.js` to match, in Story 13 item 4. |
| `board-import-validate.js` | JSON board import's parse boundary — `parseBoardImportFile()` and every `isValid*` shape check a file must pass before anything downstream trusts it. |
| `board-import-plan.js` | JSON board import's pure merge/replace planning — given a parsed file and the board's current state, returns what WOULD change, without touching anything. |
| `board-import-preview.js` | JSON board import's own preview modal rendering — turns a plan into the chips/warnings/diff HTML the facilitator reviews before Apply. |
| `board-import-apply.js` | JSON board import's persistence execution — the only one of these six that actually writes; `board-import-preview.js`'s Apply button is its only caller. |
| `board-import-ui.js` | JSON board import's modal open/close lifecycle — the file picker, parse-and-dispatch, and the pending-plan state the other import files above share. |
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
by which point every file has finished loading, so the specific order between the eighteen files
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
(There's one other `window.claude.use(...)` call, for `"downloads"` in `public/js/board-export.js`/`board-import-preview.js`, and a
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
  Built 2026-09-11 — see `relay/` and `public/js/crypto.js`/`relay-client.js`. Originally (until
  SEC-2, below) the encryption key was **derived from the session code itself**
  (`SHA-256(code)`), not an independent random secret in a URL fragment — because the app's
  *primary* join path was typing the 6-character code by hand (the fix for a real iPhone QR-handoff
  bug already in this codebase), a path with no fragment to carry a separate key. **SEC-2 (2026-09-16)
  retired that premise**: the typed-code join path is gone, so retro sessions now use the exact
  same secret/room-id split team boards already used (see the "Board sync" security fix below) —
  a high-entropy secret, never typed, is what the key derives from, and the relay only ever sees a
  separate, one-way-derived room id. Full rationale and the researched Excalidraw/Vercel
  architecture this is based on: `docs/standalone-plan.md`.
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
- **SEC-1 (STATUS.md's "Security hardening backlog"), DONE as of 2026-09-17: bound relay
  abuse with configurable connection/message limits.** `relay/server.js` had only total-count
  caps (`MAX_ROOMS`/`MAX_DOCS_PER_ROOM`) and a per-envelope size check made *after*
  `JSON.parse` — no rate limiting, no cap on clients per room, no cap on connections per
  address, so one abusive source could exhaust capacity for everyone else. Added five
  independent, `DEFAULT_LIMITS`-configurable bounds, each a throttle a client recovers from
  rather than a ban: a transport payload ceiling (`ws`'s own `maxPayload`, enforced before this
  file's `JSON.parse` ever runs), a per-room concurrent-client cap, a per-address
  concurrent-connection cap, a global new-connection rate limit, a global room-creation rate
  limit (existing rooms are never subject to it), and a per-connection write-rate limit sized
  for real UI bursts (a full-board JSON import, a many-dimension starter template). Deployment-
  layer protection (hosting provider DDoS mitigation, CORS/Origin checks) is explicitly out of
  scope — this closes the application-layer gap only, per the backlog item's own acceptance
  criteria. Covered by six new tests in `relay/test/rate-limits.test.js`. This was implemented
  once already on an orphaned branch (`sec-1-relay-abuse-bounds`) that never got a PR opened
  against trunk and sat undiscovered until a full branch audit surfaced it — ported into trunk
  as-is (cherry-picked, verified against the current full suite) rather than redone, then the
  orphan branch deleted. See the session log entry below for the audit that found it.
- **PERF-1 (STATUS.md's "Runtime performance backlog"), DONE as of 2026-09-17: idle cross-tab
  sync feedback loop.** Two tabs of the same browser sharing `localStorage`, both team-synced
  and sitting idle, fell into a self-sustaining loop: `local-store.js`'s native `storage` event
  handler re-fired every listener on every event regardless of whether that path's data
  actually changed, and each of `db.js`'s listeners unconditionally re-pushes a board snapshot —
  so a pure echo still produced a fresh push, which the live subscription echoed back as a
  "newer" remote snapshot, applied locally, re-firing another `storage` event in the other tab,
  forever (reproduced independently: pinned a renderer badly enough that a trivial
  `evaluate("1+1")` took 21+ seconds). Two-part fix: (1) `local-store.js` only notifies
  listeners whose path genuinely changed since the last load, instead of blindly notifying
  everyone; (2) `board-sync.js` skips a board push when the board's actual content
  (squads/dimensions/config) hasn't changed since the last push, since
  `applyRemoteBoardSnapshot()` bakes a fresh `updatedAt` into each local doc on every apply,
  which defeated fix 1 alone. Covered by a new `tests/test_idle_tab_sync_loop.py` plus a unit
  test on `boardContentSignature()`. Same story as SEC-1 above: implemented once on an orphaned
  branch (`perf-1-idle-tab-sync-loop`), never merged, found by the same audit, ported as-is, and
  that branch deleted.
  - **Codex review fix on PR #15 (2026-09-17): the dedup baseline this fix introduced
    (`lastPushedBoardContent`) was only ever updated by THIS device's own pushes, never by a
    remote snapshot applied via `maybeApplyRemote()`** — shared by both the boot-time hydrate and
    the live subscription. A real cross-device repro found it: device A sets a squad name to
    "Original," device B changes it to "Remote change" and A receives it live, A reverts to
    "Original" — that revert was silently skipped, because A's baseline still read "Original"
    from ITS OWN earlier push, never having been told the board had since moved to "Remote
    change" and back. Fixed by updating `lastPushedBoardContent` to the just-applied remote
    content's signature inside `maybeApplyRemote()` itself, so the baseline always tracks the
    board's actual last-known-shared content, not just this device's own push history. New
    `tests/test_board_sync_revert_after_remote_change.py` proves the exact repro across two real
    devices sharing only the relay; `test_idle_tab_sync_loop.py` re-verified unaffected (the fix
    only corrects a stale baseline, it doesn't force extra pushes). Also fixed, found while
    working in this area: `test_idle_tab_sync_loop.py`'s `RELAY_PORT` (8799) collided with
    `test_relay_legacy_known_codes.py`'s, introduced by the same port not being re-checked when
    the orphaned PERF-1 branch was cut against an older trunk — moved to 8801.
- **PERF-2 (STATUS.md's "Runtime performance backlog"), DONE as of 2026-09-17: render
  amplification on a multi-doc write.** Separate from PERF-1's unbounded idle LOOP: profiling a
  single multi-doc write (a remote board snapshot applying N squads + M dimensions, or a local
  starter-template load) found `renderAll()` firing once per INDIVIDUAL doc written, not once for
  the whole batch. Root cause: `local-store.js`'s `set()` calls `notify(collectionPath)`
  synchronously per doc, and `db.js`'s squads/dimensions/config listeners each called
  `renderAll()` unconditionally on every notify — all 8 sub-renders, including every hidden view,
  on every single doc. Measured at two documented sizes with a real Playwright profiling
  harness: the app's own real default board (3 squads, 12 dimensions) cost **31** full
  `renderAll()` passes for one remote snapshot apply; a generous stress board (40 squads, 25
  dimensions) cost **66** — scaling with board size, not a fixed cost. (**Correction, Codex
  review on PR #17**: the first published version of this measurement reported 132 for the
  stress case — the profiling harness re-wrapped `window.renderAll` on every measurement instead
  of once, so the 2nd and later measurements in a run double-counted; re-verified directly
  against the pre-fix code with the harness fixed to install its counter exactly once: 66, not
  132. The small-board figure (31) was the FIRST measurement in the run, so it was never
  affected — unchanged.) One `renderAll()` pass at the stress size measured in the tens of
  milliseconds on its own (fast in isolation, but 66 of them back-to-back would still have
  blocked the main thread for over a second of real jank). Fixed by having `db.js`'s three
  listeners skip `renderAll()` while `hydrating` (a remote apply) or `suppressingLocalRewrite`
  (a local multi-doc rewrite) is set — `state` still updates on every fire either way, so nothing
  goes stale — and rendering exactly once when each of those windows closes (`board-sync.js`'s
  `maybeApplyRemote()` and `suppressBoardPushDuring()`), the same "coalesce, don't drop" pattern
  already used there for `pushBoardSnapshotIfConnected()`. Post-fix, both documented sizes
  measured **exactly 1** render for the same batch (re-verified with the corrected harness — the
  1/2 split in the original write-up was the same double-counting artifact), and an ordinary
  single edit measured **4** renders (not 12, same artifact) — a small constant, not proportional
  to board size. Deliberately did NOT attempt per-view conditional rendering (skip
  hidden-view sub-renders entirely) — riskier, and this exact class of bug (a view showing stale
  data after switching to it) has bitten this app before (see `test_view_switch_refreshes_stale_state.py`);
  the call-count fix alone addresses the measured amplification without touching that surface.
  New `tests/test_render_batching_on_multi_doc_apply.py` proves both documented sizes, confirms
  an ordinary single edit still renders normally (batching only targets the known-multi-doc
  windows), and records the per-call timing claim above.
- **SEC-5 (STATUS.md's "Security hardening backlog"), DONE as of 2026-09-17: documented the
  static-hosting wildcard CORS header — no code change.** Confirmed live against the deployed
  Vercel preview (`curl -I`, both an HTML page and a `.js` asset): `access-control-allow-origin: *`
  is present on every static asset, injected by Vercel's own static-hosting layer — neither
  `vercel.json` nor any app code sets it. Determined this needs no restriction: every asset this
  origin serves over HTTP is public application code (HTML/CSS/JS/fonts/the bundled QR library),
  never anything served with cookies or session credentials, and a permissive wildcard on public
  static assets is standard practice (the same as any CDN-hosted library) — restricting it would
  only break the app's own explicitly-supported embedding/self-host deployment shapes without
  protecting anything real. The one component that actually handles session/board data — the
  relay (`relay/server.js`) — speaks WebSocket only, which CORS doesn't govern at all (a browser's
  same-origin policy for `fetch`/`XHR` is a different mechanism than the WebSocket handshake); the
  relay does no `Origin` checking today, by the same already-locked-in design as the CSP
  `frame-ancestors` question ("CORS/Origin checks are not authentication" — see the SEC-1 comment
  in `relay/server.js`). Forward-looking guidance, per the backlog item's own acceptance criteria:
  any FUTURE sensitive HTTP endpoint (none exist today — the relay has no HTTP routes at all, only
  a WebSocket upgrade) must NOT inherit this static-asset default; it needs its own explicit,
  restrictive CORS and auth policy from day one.
- **SEC-2 (split from SEC-1), PO decision, DONE as of 2026-09-16: dropped the typed
  6-character join code, QR/link only.** Product owner call: the "type this code in" join path
  (the join-code modal, and the code front-and-center on the session card — see Story 3 in
  `docs/facilitated-retro-spec.md`) is gone entirely. A retro session is joined only by scanning
  its QR code or opening its link — the "Or scan/share a link" fallback that used to sit behind a
  collapsed `<details>` is now the *only* path, and is shown directly on the session card.
  Implementer's call on the question the PO decision left open (whether the session key stays
  code-derived or moves to a separate secret): moved to a separate secret, to match the board-sync
  model exactly — see the "Self-hosted relay + client-side encryption" decision above. `crypto.js`'s
  already-existing `generateSecret()`/`roomIdFor()` (built for board sync) are reused as-is, no new
  crypto primitives needed. A security notice is shown wherever a join or co-facilitate link/QR is
  shown (the join-link block and the co-facilitator `<details>` section — the session card's own raw
  code display this originally also applied to is gone, so that's now two places, not three):
  > Note: Anyone with this link — or who scans this QR code — can see the data in this Squad Pulse
  > session. Share it only over a secure channel, and make sure the QR code itself is visible only
  > to people who should have access.

  (Tightened from the PO's original draft — "secure media" → "secure channel," and calling out that
  the link and the QR grant identical access rather than treating them as separately risky.) Full
  implementation notes in this session's log entry below.
- **"This retro has ended" vs. "this retro isn't open" is a real distinction, but only within the
  relay's own room lifetime — not indefinitely.** `closeSession()` writes `status:"closed"` instead
  of deleting the doc, so the join screen can say "ended" for as long as that doc still exists (the
  relay's own room-empty grace period, or longer if someone's still connected). Once the relay has
  genuinely forgotten a room (garbage-collected, or the process restarted), a closed-long-ago code
  and a code that never existed are the same thing again — there is no way to keep that distinction
  forever without adding real persistence, which is exactly the trade-off already rejected for the
  relay itself (see the Vercel Function decision above). This is the deliberate stopping point.
- **SEC-3 (STATUS.md's "Security hardening backlog"), DONE as of 2026-09-16, except one directive
  left OPEN on purpose: browser-hardening headers.** Added a Content-Security-Policy (as a `<meta
  http-equiv>` in `index.html`, not just a `vercel.json` header, so it's enforced over `file://` and
  on a plain self-hosted static server too, not only on Vercel), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and a `Permissions-Policy` locking down camera/microphone/geolocation/payment/
  usb/magnetometer/gyroscope/accelerometer (`vercel.json` — these three have no meta-tag equivalent,
  so a self-hoster serving `public/` from their own web server needs to set them there themselves;
  `relay/README.md`'s deployment docs are the place to point them if this ever comes up).
  `frame-ancestors`/`X-Frame-Options` are **deliberately NOT set** — unlike the crypto question SEC-2
  left for its own implementer to decide, the SEC-3 backlog item explicitly named permitted embedding
  origins an **open product decision**, not an implementer's call, and `README.md`'s own "Deploying
  for real" section lists "embedding this somewhere public (e.g. a subdomain + iframe on a website)"
  as one of exactly two intended deployment shapes — shipping any default here (even `SAMEORIGIN`)
  risks silently breaking that for every deployment. Whoever the PO designates should decide which
  origins (if any) are allowed to embed this, then add `frame-ancestors <origins>` to both the CSP
  meta tag and a `X-Frame-Options` header compatible with it (see the SEC-3 backlog item's own
  wording in the PR that recorded it for the exact acceptance criteria). Getting the CSP's
  `script-src 'self'` to hold with zero `'unsafe-inline'`/hashes required moving `index.html`'s one
  inline `<script>` (the relay-URL fallback) into `public/js/relay-url-fallback.js` — a pure move, no
  behavior change. `style-src` still needs `'unsafe-inline'`: the app's JS-generated markup uses
  `style="..."` attributes extensively (rewriting all of them to CSS classes is a separate, much
  larger change, out of scope here). `connect-src` allows the `ws:`/`wss:` schemes rather than a
  specific host, since the relay's origin is deployment-configurable (`SQUAD_PULSE_RELAY_URL`), not
  knowable at build time.
- **Assessment-content rights (Introduction & help backlog, Story 5/6 "Credits and licenses"): Five
  Dysfunctions is a knowingly accepted risk (PO decision, 2026-09-17); Tuckman's provenance is
  RESOLVED (2026-09-17) — original work, not a third-party copy.** The Table Group's own published
  FAQ states its Five Dysfunctions assessment (online and book/field-guide) is copyrighted and may
  not be reproduced or transmitted — this app's 15-statement adaptation is exactly that, and
  attribution alone does not establish reuse permission. The PO has reviewed this and is
  **knowingly accepting the risk** rather than removing or re-licensing the content; the credits UI
  already states the adaptation honestly rather than implying permission (`about-credits` in
  `index.html`: "This app is an adaptation, not the official assessment"). Tuckman's 20-statement
  questionnaire was a **separate, initially-unresolved question** — contrary to an earlier guess in
  this doc that the documented record contradicted the PO's recollection of it being developed in
  this project, the PO located and supplied the actual source conversation, which settles it fully
  in the PO's favor: a **shared Claude.ai chat** (`https://claude.ai/share/b4751645-1989-45db-8015-1e16cc2eceee`,
  ~2026-09-03/04) shows the PO asking Claude to "find or create" a Tuckman questionnaire; Claude
  found two existing published instruments (a 40-item one and a 32-item one) and explicitly
  **declined to use either**, instead offering to build a new 15–20 item version "closer to the
  Lencioni format" — the PO asked for "3-5 items per stage," and Claude wrote fresh statement text
  and built the 20-item/4-per-stage structure itself, delivered as the `.docx` the PO then supplied
  to this project. Full transcript excerpts and reasoning: `docs/credits-and-terms-review.md`'s
  "Tuckman 20-statement questionnaire — provenance" section. Conclusion: original content, not a
  copy of either instrument Claude found and declined to use — only the assessment *format* (3-point
  scale, summed bands) deliberately mirrors the Lencioni structure, by explicit design choice, not
  content copying. The "has not yet been verified" hedge is removed from the credits UI
  (`about.creditTuckman` in `public/js/locales/en.js`/`he.js` and `public/index.html`), replaced
  with the attribution above.

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

### SEC-4 (2026-09-16, STATUS.md's "Security hardening backlog"): team link secret moved to the URL fragment

The 2026-09-12 fix above still shared the secret as `?team=<secret>` — a query param, sent to
whatever's actually hosting `index.html` on every single request that carries it, landing in that
host's own access logs (and, on the very next click to somewhere else, a Referer header) before this
page's own JS ever ran to strip it. A URL **fragment** (`#team=<secret>`) is never sent to any server
at all — the browser keeps it client-side, full stop — so `teamLinkFor()`/`parseTeamSecretInput()`/
`autoConnectFromLink()` (board-sync.js) and `joinUrlFor()`/`coFacilitateUrlFor()` (helpers.js, a
join/co-facilitate link's own piggybacked team secret — see the 2026-09-16 join-link-carries-
team-sync fix above) all moved to it. Old links already shared/bookmarked before this change keep
working: `parseTeamSecretInput()` checks the fragment first, then falls back to the legacy `?team=`
query form.

**A real, pre-existing bug got fixed along the way, not just the query→fragment move**:
`autoConnectFromLink()`'s cleanup (stripping the secret from the visible URL/history) used to be
skipped ENTIRELY whenever the URL's secret already matched what this device had already stored — an
early `return` before the history rewrite ever ran. Re-opening the same bookmarked/shared link a
second time, or simply reloading, left the secret sitting in the visible URL indefinitely (and, for
the old query-string form, sent to the server again on that very reload). Cleanup now always runs
whenever the URL carries a team param at all; only the (idempotent) `setTeamSecret()` call itself is
skipped when there's nothing new to store.

Also fixed: `state.js`'s `openedFromInvitation` (what suppresses the first-visit welcome dialog for
someone arriving via a real invitation, not a plain fresh visit) only ever checked the QUERY string
for `session`/`cofacilitate`/`team` — a bare team link with nothing else in its query string (now
entirely possible, since the secret itself no longer lives there) would have gone undetected,
incorrectly showing the welcome dialog to someone who just opened a real team invitation. Now also
checks the fragment for `team=`.

**Per this backlog item's own acceptance criteria, explicitly did NOT overclaim what this buys**:
the About dialog's terms text now says plainly that a fragment being off the wire is not protection
against a malicious script already running on this page, and doesn't stop the link itself from being
forwarded to someone else — and that board data (including any connected team's secret) lives in
this browser's own `localStorage`, readable by any same-origin script. Test-first per this repo's TDD
skill: `tests/unit/test_board_sync.js` (fragment vs. legacy-query vs.-both precedence) and
`tests/unit/test_helpers.js` (the new `teamHashFor()`, and that `joinUrlFor()`/`coFacilitateUrlFor()`
put the fragment LAST, after every query param) cover the pure logic; the existing Playwright board-
sync/join-link suite was updated in place (assertions on the literal `?team=`/`#team=` shape) rather
than rewritten, plus one new case in `test_welcome_first_visit.py` for the `openedFromInvitation` fix
(verified it would have failed pre-fix by temporarily reverting the check and confirming the welcome
dialog wrongly appeared). Full suite green: 144/144 unit tests, all 48 Playwright files (47s, under
the 78s baseline), relay's protocol + storage suites passing.

### Codex review fixes on PR #14 (2026-09-16): the join/co-facilitate secret itself was still in the query string, a legacy-storage crash, and a CSP-unsafe test wait

A Codex review of the combined security-hardening PR (#14, bundling SEC-2/SEC-3/SEC-4 above) found
three real issues, all fixed here:

**P1 — `joinUrlFor()`/`coFacilitateUrlFor()` (helpers.js) still put the SESSION's own secret in the
query string** (`?session=<secret>`/`?cofacilitate=<secret>`) even after SEC-4 moved the piggybacked
TEAM secret to the fragment — the exact exposure SEC-4 closed for one secret but missed for the
other. Fixed by moving session/co-facilitate into the fragment too, combined with `team` into one
fragment via a new `buildFragment()` helper (a URL only has one `#`; `teamHashFor()`'s own
`#team=...` can't just be concatenated with a second `#session=...`). `state.js`'s boot-time
`getLinkParam()` (new — fragment-first, falls back to the legacy query form) replaces the old
query-only `getQueryParam("session")`/`getQueryParam("cofacilitate")` reads, same precedence
`parseTeamSecretInput()` already used for a pasted team link. `lang` is the only thing left in the
query string now, since it isn't a secret and is meant to be visible/bookmarkable. Legacy
`?session=`/`?cofacilitate=`/`?team=` links (shared/bookmarked before this fix) still work.
Test-first: `tests/unit/test_helpers.js` (`buildFragment()`, the new fragment shape, asserting
`?session=`/`?cofacilitate=` never appear), `tests/unit/test_state.js` (new — `getLinkParam()`
precedence), and a new **request-level** Playwright test,
`tests/test_join_link_secret_not_in_http_request.py`, that serves a built test page over a real
local HTTP server (not `file://` — this is what actually proves nothing lands in a server's access
log) and captures every real HTTP request Playwright fires while navigating to a freshly-generated
join/co-facilitate link, asserting neither secret ever appears in a request's query string.

**A genuinely new class of test fragility, found fixing the above**: two URLs that differ only in
their fragment (e.g. a stale `#cofacilitate=BAD&team=X` vs. the real `#cofacilitate=GOOD&team=X`)
trigger a same-document "fragment navigation" per the HTML spec when navigated between on an
ALREADY-OPEN page — true in every real browser, not a Playwright quirk — so the page never actually
reloads and never reruns its boot-time fragment parsing. This silently broke two existing tests that
reused one page/context across two different session-scoped links
(`test_cofacilitator_join.py`, `test_board_sync_finish_retro_convergence.py`); fixed by forcing a
real reload via an intermediate `about:blank` navigation between the two `goto()` calls. A brand-new
page/tab opening a link for the first time is never affected (there's no prior document to
fragment-navigate from), which is the overwhelmingly common real case — this is a same-tab,
sequential-different-link edge case already latent for the team link since SEC-4 shipped it to the
fragment first, not a new risk introduced here.

**P2 — a device with a session saved under the OLDER `knownCodes` localStorage shape (a bare code
string, from before SEC-2's redesign above) crashed `relay-client.js`'s reconnect logic**: `getRoom()`
received `{roomId: undefined, secret: undefined}` and opened a WebSocket asking the relay to route
`?code=undefined`, every single reload, forever. **Migration decision, per
`docs/DefinitionOfDone.md`'s "new data shape" rule — RETIRE, don't migrate**: a legacy entry's bare
string WAS the human-typed code itself; there is no secret to derive it into under the new
`{roomId, secret}` shape, and a typed-code session was already short-lived by design (forgotten
within minutes of the retro ending). Any such saved entry, by the time this ships, is for a retro
that ended long ago. `loadKnownCodes()` now filters out anything that isn't a well-formed
`{roomId, secret}` pair on every read — never attempting to reconnect it, never crashing, and never
affecting any OTHER, well-formed entry sitting next to it in the same array. Test-first:
`tests/test_relay_legacy_known_codes.py` (new) — a real relay + the same crypto.js/relay-client.js
isolation harness `test_relay_error_handling.py` already uses, seeding a legacy bare-string entry
alongside a well-formed one and confirming the legacy entry is silently dropped (no `?code=undefined`
connection, no crash) while the well-formed one still reconnects.

**P3 — `tests/test_welcome_first_visit.py`'s two `wait_for_function()` calls used a bare expression
string** (`"localStorage.getItem(...) === '1'"`, no `() => ...`), which Codex's own repro (matching
this repo's pinned Playwright/Chromium versions) hit as a CSP `unsafe-eval` violation — every OTHER
`wait_for_function()` call in this suite already uses an explicit arrow-function predicate, so these
two were the outliers. Fixed to match the rest of the suite; did not reproduce locally (this
environment's Chromium build didn't trigger it), but the fix is a strict, zero-risk improvement that
matches the suite's own established convention regardless.

Full suite green: 154/154 unit tests, all 51 Playwright files (54s, under the 78s baseline — 2 more
files than the PR's own last entry, both new tests from this fix), relay's protocol + storage suites
passing.

**Follow-up P2 (2026-09-16, same PR, next round of review) — a same-document navigation gap, found by
the SAME test workaround that avoided it**: the P1 fix above moved session/co-facilitate/team
secrets into the URL fragment, but `state.js` only ever read the fragment ONCE, at initial script
load. Opening a DIFFERENT invitation link in the SAME already-open tab is a same-document "fragment
navigation" per the HTML spec — true in every real browser, not a Playwright quirk (confirmed with a
tiny probe: navigating from `url#a` to `url#b` fires no `load` event and leaves `state.*` untouched;
navigating to a bare `url` with no fragment at all DOES force a real reload — the two cases behave
differently). The regression tests written for the P1 fix's own test-fragility fallout
(`test_cofacilitator_join.py`, `test_board_sync_finish_retro_convergence.py`) used an intermediate
`about:blank` navigation to force a clean reload between two session-scoped links — a legitimate
technique for THOSE tests' own actual subject, but it also happened to dodge the real gap rather than
covering it, which the next review round correctly called out. Fixed with a `hashchange` listener in
`state.js`: on any fragment-only URL change, re-derive `session`/`cofacilitate`/`team` via
`getLinkParam()` and, only if what they NAME actually differs from what's currently active, reload
the page — letting the file's own existing boot-time parsing (a few lines above) do the real work,
rather than hand-rolling partial re-initialization of listeners/subscriptions. Narrow on purpose: an
unrelated hash change never forces a reload. Test-first: `tests/test_invitation_hashchange.py` (new)
— a real relay, one facilitator starting two distinct sessions, then a participant device and a
co-facilitator device each navigating DIRECTLY between two different invitations (no `about:blank`
detour) and confirming the app switches to the new one — covering a plain link-to-link case and a
bad-link-then-corrected-link case, exactly the two the review named. (Also fixed a real port
collision found while adding this: `tests/test_relay_legacy_known_codes.py` and
`tests/test_relay_board_path_sync.py` had both landed on `RELAY_PORT = 8793`; moved the former to
8799.) Full suite green: 154/154 unit tests, all 52 Playwright files, relay's protocol + storage
suites — reliable at this repo's documented default concurrency (`tests/run_all.sh`, unset
`TEST_JOBS`, defaults to 2); two of the relay-heavy files in this batch showed CPU-contention
flakiness at `TEST_JOBS=4` specifically (consistent timeouts, not logic failures — both pass
reliably standalone and at the documented default), matching `run_all.sh`'s own documented caution
about parallelism exceeding a runner's headroom, not a functional regression.

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

## Runtime performance backlog (2026-09-16)

These items concern the running app, separate from test-suite execution time.
Evidence was gathered against shared preview commit `763bb45`, using an isolated
Chromium browser, the real local store, and a local WebSocket relay. The reported
Chrome warning occurred while idle; the user's exact tab count was not confirmed.

| Priority | Story | User value and acceptance criteria | Status |
|---|---|---|---|
| P1 — next runtime fix | PERF-1 — Stop idle cross-tab sync feedback | As a facilitator with two app tabs open in the same browser, keep an idle board responsive without repeated uploads. Reproduce with two same-origin pages in ONE browser context and a real relay; distinguish storage/remote notifications from new local edits so they cannot circulate as fresh changes. After boot and after an edit has converged, render/upload/remote-apply counters stop increasing during a bounded idle observation window. A real edit in either tab still reaches the other tab and a separate browser context; reload and reconnect preserve convergence and data. Add a regression that fails on the current implementation and run the full unit, browser (`tests/run_all.sh`), and relay suites. | **DONE (2026-09-17)** — see "Decisions locked in" above. |
| P2 — after PERF-1 | PERF-2 — Measure render amplification during sync | As a facilitator receiving board updates, keep the UI responsive as the board grows. Profile a single edit and a remote snapshot at documented squad/dimension counts; record render counts, main-thread work, and any long tasks, including work on hidden views. Use measurements to decide whether batching writes/renders or skipping unchanged sections is warranted; preserve immediate visible updates, view-switch freshness, and live-sync correctness. | **DONE (2026-09-17)** — see "Decisions locked in" above. Real amplification found and fixed (batching, not per-view skipping); measurements and reasoning recorded there. |

### PERF-1 evidence and implementation guidance

- **Single idle tab:** about 3 ms of renderer main-thread work over 5 seconds;
  zero `renderAll()` calls, board uploads, or remote-board applications.
- **Two idle tabs sharing storage:** OS samples showed the two isolated renderer
  processes at approximately 128% and 138% CPU (process percentages can exceed
  100% across cores). One became unresponsive to browser evaluation and had to be
  terminated. This is a local reproduction, not a measurement of the user's tab.
- **Cause:** `public/local-store.js`'s `storage` handler calls `notifyEverything()`;
  `public/js/db.js`'s squad/dimension/config listeners each render and request a
  board push. A remote apply rewrites local storage, waking the other tab, which
  republishes the board with a fresh timestamp. The hydration guard is tab-local
  and does not stop the other tab from restarting the cycle.
- **Diagnostic confirmation:** suppressing board pushes while processing storage
  notifications, only in a temporary copy, reduced both tabs to about 1 ms of
  main-thread work each over 5 seconds with zero renders/uploads/remote applies.
  This proves the feedback path; that prototype is not a production fix and still
  needs the convergence/error-path coverage in PERF-1.
- The existing live-subscription test opens separate browser contexts; it does
  not cover two tabs sharing local storage. Use the real store for this regression.
  A fixed, documented observation interval is appropriate for proving idle
  inactivity; readiness and convergence waits must use causal conditions.
- Repeated full `renderAll()` calls and per-document persistence amplify the loop.
  Investigate their separate cost under PERF-2 after stopping the loop first.
- Temporary workaround: keep one app tab open per browser profile. A warning with
  only one app tab remains unconfirmed and needs a separate trace if it recurs.
- No runtime fix or stored-data shape change is included in this backlog update;
  no migration is required.
- **Fixed (2026-09-17)** — see "Decisions locked in" above for the shipped fix
  (`local-store.js` change-detection + `board-sync.js` content-signature dedup) and
  `tests/test_idle_tab_sync_loop.py` for the regression this row asked for.

## Security hardening backlog (2026-09-16)

Reviewed the product owner's supplied Copilot pentest against shared preview
commit `763bb45` and passively rechecked the reported Preview's response headers.
Backlog priorities below are delivery priorities, not claims of demonstrated
exploitation. No live room guessing, destructive relay probes, or access to other
users' data was performed.

| Priority | Story | User value and acceptance criteria | Status |
|---|---|---|---|
| P1 | SEC-1 — Bound relay abuse | As a facilitator, keep sessions available despite abusive connections or writes. Add configurable connection, concurrent-client, room-creation and message/write budgets, plus a transport payload ceiling before JSON parsing. Define per-client, per-room and global bounds; account for trusted proxy/IP handling and shared-office NAT. Test throttling, oversized frames, cleanup and recovery on a local relay, while normal participant bursts/reconnects work. Verify hosting-layer protections separately; CORS and Origin checks are not authentication. | **DONE (2026-09-17)** — see "Decisions locked in" above. Deployment-layer limits (hosting provider DDoS mitigation) remain out of scope, as written. |
| P2 | SEC-2 — Harden retro join credentials | As a participant, retain usable code/link entry with explicit confidentiality and write-access guarantees. Replace `Math.random()` session-code generation with unbiased Web Crypto randomness. Document the roughly 29.7-bit code space and that the room code also derives the encryption key. Evaluate guessing resistance and room-enumeration exposure with SEC-1; review any separation of routing ID, encryption secret and write capability with the product owner before changing the locked typed-code flow. Cover code/link/QR compatibility and define existing-session migration if the protocol changes. | **DONE (2026-09-16)**, via a full redesign rather than the narrower fix this row describes — see "Decisions locked in" above. The typed code is gone entirely (QR/link only); the session key now derives from a separate `crypto.getRandomValues()` secret, not the code, so the `Math.random()`/29.7-bit-code-space concerns this row raised no longer apply to the shipped design. |
| P2 | SEC-3 — Define and enforce browser hardening policy | As a user, avoid unauthorized framing and reduce the impact of future injection mistakes. Decide the permitted embedding origins before enforcing `frame-ancestors` (embedding remains an open product decision), with compatible X-Frame-Options where appropriate. Add a tested CSP covering actual scripts, styles, fonts and relay connections; explicitly set nosniff, Referrer-Policy and required Permissions-Policy directives. Verify deployed headers, EN/HE flows, QR/downloads and relay use; test a disallowed cross-origin parent with browser frame/navigation evidence, plus an allowed parent if embedding is supported. | **DONE (2026-09-16)**, except `frame-ancestors`/`X-Frame-Options` — left OPEN on purpose pending a PO decision on permitted embedding origins. See "Decisions locked in" above. |
| P2 | SEC-3a — Approved-embedding requirement (YAGNI until a real embed path exists) | As a maintainer, if this app is ever embedded in another site, only approved parent origins may frame it. Requirement: the app must deny all origins by default and allow only explicitly approved domains (for example, the Dr. Agile site and any approved subdomains) via a browser-enforced `Content-Security-Policy: frame-ancestors <approved-origins>` plus a compatible `X-Frame-Options` header. This requirement is not active until the product decides to ship an embedding deployment; until then, it is intentionally YAGNI and no public embed route is in scope. | **YAGNI for now** — no embed deployment is active today; implement only when an actual embedding contract is approved. |
| P2 | SEC-4 — Reduce team-link secret exposure | As a facilitator, share a sensitive team link without sending its secret in the initial HTTP query. Plan fragment-based team links and QR codes, retaining legacy query-link compatibility; scrub a consumed secret even when it already matches localStorage. Verify initial requests contain no secret for new links, URL cleanup for new and returning users, reload/paste/join flows, and no secret-bearing diagnostics. Explain that possession grants board access and that localStorage remains readable by same-origin scripts; do not claim fragment links prevent XSS or accidental sharing. | **DONE (2026-09-16)** — see the "SEC-4" section below "Board sync" for the fragment-move writeup, and the "Codex review fixes on PR #14" section for two follow-up leaks (session/co-facilitate links, a legacy localStorage shape) fixed before merge. |
| P3 | SEC-5 — Document static CORS requirements | As a maintainer, distinguish public asset sharing from access to sensitive endpoints. Identify which hosting layer adds wildcard ACAO, document whether consumers need it, and remove/restrict it only where appropriate. Verify headers and legitimate integrations after any change; require a separate explicit CORS/auth policy for future sensitive endpoints. | **DONE (2026-09-17)** — see "Decisions locked in" above. Documentation only, by design: no restriction is appropriate today. |

### Review evidence and qualifications

- Copilot assessed the immutable Preview at
  `https://team-pulse-survey-ibkehdp81-ilan-kirschenbaums-projects.vercel.app/`.
  A fresh passive GET returned 200, HSTS and `Access-Control-Allow-Origin: *`,
  but no CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or
  Permissions-Policy headers. `vercel.json` also defines no such policy.
  The local source review is pinned independently to `763bb45`; the report does
  not establish that every deployed asset came from that exact commit.
- `relay/server.js` bounds room/document counts and envelope size, so the relay
  is not wholly unbounded. It has no application-level rate limiter or write
  authorization beyond knowing the room routing code; envelope validation happens
  after JSON parsing. Snapshot delivery reveals stored ciphertext to a client
  knowing that code. Rate limiting mitigates abuse, but does not by itself provide
  read/write authorization or eliminate the room-existence signal.
- `SESSION_CODE_ALPHABET` has 31 symbols: 31^6 = 887,503,681 possible retro codes.
  `generateSessionCode()` uses `Math.random()`; `crypto.js` derives the AES key
  from that same code. This is an existing documented tradeoff for typed-code
  entry, not proof that any live session was guessed or decrypted. Team boards
  instead use a separate 128-bit random secret and derived routing ID; knowledge
  of their routing ID does not provide the decryption key, but the relay still
  does not authenticate destructive writes by possession of that secret.
- Copilot's cross-origin `iframe.contentDocument` probe is inconclusive: the
  same-origin policy itself prevents reading a cross-origin frame. Missing
  framing policy is confirmed; successful clickjacking was not demonstrated.
- Team secrets in localStorage are intentional bearer credentials, not a finding
  of secret theft. New query links are normally scrubbed by `autoConnectFromLink()`
  after load, too late to remove them from the initial HTTP request. Its early
  return when the secret already matches localStorage skips URL cleanup entirely.
- Wildcard CORS on public static content is a configuration decision, not an
  authentication bypass. Copilot's reported squad-name injection probe did not
  execute and its common secret-file probes returned 404; these limited negative
  checks do not establish that every input or deployed path is safe.
- These are backlog entries only. No runtime, deployment or protocol changes are
  included; no stored-data migration is needed for this documentation update.

## Deliberately not built yet (and why)

| Not built | Why it's cut for now | What would trigger building it |
|---|---|---|
| Save-board / Load-board-to-file | `local-store.js` already persists the board via `localStorage`, which covers the same browser/device | Once someone needs a board to move between browsers/devices without a relay |
| Relay deployed on Vercel itself (one deployment, not two) | Deliberately rejected, not just deferred — see the locked decision above and `relay/README.md`'s "Why not a Vercel Function" | Only if Vercel's WebSocket support later guarantees same-instance routing without an external store, which would remove the reason this was rejected |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |
| A third UI language (beyond English/Hebrew) | YAGNI, per the product owner's own call (2026-09-14) — `SUPPORTED_LOCALES`/`t()`'s fallback (i18n.js) are already written generically enough to add one without a redesign, and the bilingual-dimensions editor (see the session log) is a per-dimension `i18n` object keyed by locale code, not hardcoded to exactly two languages, so neither needs rework specifically to add a third | A real request for a specific third language — at that point, design its own toggle/picker UX (today's per-dimension editor hardcodes one Hebrew panel) rather than assuming the two-language shape generalizes without a look |

## Introduction and help backlog (2026-09-15)

Priority is separate from the stable story ID. Each story ships English/Hebrew,
RTL, keyboard support, and focused regression coverage. Story 1 merged through PR #2; stories 2–6
and outside-click dismissal merged through PR #3 (`codex/about-guides`) and PR #5
(`codex/welcome-credits-terms`) — all verified present in current trunk (2026-09-17).

| Priority | Story | User value and acceptance criteria | Status |
|---|---|---|---|
| 1 | 1 — On-demand introduction | As a visitor, open About & help from every view, including participant mode, understand the app's purpose, and close back to the same context without changing data or drafts. | **DONE** — merged via PR #2 (2026-09-15) |
| 2 | 6 — First-visit introduction | As a first-time visitor, see an introduction on an ordinary visit. Remember dismissal locally; bypass it for participant/co-facilitator/team links; retain manual access; storage failure never blocks entry. | **DONE** — merged via PR #5 (`codex/welcome-credits-terms`) |
| 3 | 2 — Participant guide | As a participant, understand code/link entry and answering; open the existing join flow or return to an active retro without losing answers. | **DONE** — merged via PR #3 (`codex/about-guides`) |
| 4 | 3 — Facilitator guide | As a facilitator, follow setup, template and squad selection, start, invite, discuss, and finish/apply; distinguish team and session links. | **DONE** — merged via PR #3 (`codex/about-guides`) |
| 5 | 4 — Reading results | As a viewer, understand colors, trends, Squad/Tribe views, and hotspots through expandable guidance matching actual behavior. | **DONE** — merged via PR #3 (`codex/about-guides`) |
| 6 | 5 — Credits and licenses | As a user, inspect verified model sources, Dr. Agile contributions, application license, and third-party notices; preserve contextual board credits. Verify the source of Tuckman assessment scoring. | **DONE** — merged via PR #5. Five Dysfunctions reuse risk knowingly accepted (PO decision); Tuckman's 20-statement questionnaire's provenance is now fully resolved (original work, not a third-party copy) — see `docs/credits-and-terms-review.md` and "Decisions locked in" below. |
| 7 | 7 — Terms and conditions of use | As a user, read terms before choosing to use the app and reopen them from About & help. Publish owner-approved English/Hebrew terms covering permitted use, responsibilities, data/sharing behavior, and limitations; show effective date/version and accessible links. Explicitly decide whether acceptance tracking is needed before implementation; do not imply consent through mere dismissal. | **UI DONE, content approval OUTSTANDING** (corrected, Codex review on PR #17 — a prior version of this row said DONE, which overstated it). Informational/no-tracking model confirmed by owner; the mechanism (panel, reopen access, EN/HE, no implied consent) is fully built and live. But the acceptance criteria calls for *owner-approved* terms with a real effective date, and the shipped text is explicitly a draft awaiting that: `index.html`'s own `about.termsVersion` string reads "Draft v0.1 • 2026-09-15 • **Pending owner approval; no effective date yet**." Content sign-off is a separate, still-open step for the owner — same shape as Story 5/6's rights question above, not a code task. |

Stories are small independently testable UI increments; stories 2–5 and 7 can
be ordered independently once the common panel is available. Story 6 was moved
to priority 2 by the product owner. Terms are a separate content/behavior story,
not implicit acceptance added to story 1.

## Facilitated retro backlog (2026-09-17)

New feature requests for the facilitated live-retro flow (`docs/facilitated-retro-spec.md` covers
Stories 1–9, already DONE; these are new, not part of that closed backlog). None started yet.

| Priority | Story | User value and acceptance criteria | Status |
|---|---|---|---|
| P1 | RETRO-1 — Carry latest retro results into board export/import | As a facilitator, back up or migrate a board without losing its most recently finished retro. Extend the JSON board export (`board-export-import.js`, later split by REF-4 into `board-export.js`/`board-import-*.js`) to also capture, per squad, the latest finished retro session's per-dimension result (consolidated or overridden), sprint experiment note, and finish timestamp, and restore it on import alongside the existing squads/ratings/dimensions/templates/settings. Define what happens when an imported snapshot's dimensions no longer match the target board (e.g. a renamed/removed dimension) instead of silently dropping or misapplying data. | **Merged (2026-09-17, PR #21)** — see session log. New squad field `lastRetro` (finishedAt/experimentNote/dimensions incl. `overridden`), written by `finishRetroAndApply()` (retro-facilitator.js) via `persistDimensionRatings()`'s new optional `extraFields` param, carried through `db.js`'s squad listener, and exported/imported by `board-export.js`/`board-import-validate.js`/`board-import-plan.js`/`board-import-apply.js` (validated, matched/skipped the same way ratings already are). |
| P2 | RETRO-2 — Facilitation option: progress one question at a time | As a facilitator running a live session, optionally pace the group through statements one at a time instead of everyone seeing the full survey at once. Add a session-level toggle (default off, preserving today's all-at-once survey) that, when on, shows each participant only the current question and advances everyone together as the facilitator moves forward; revisiting an earlier question doesn't discard that participant's existing answer to it. | **Merged (2026-09-18, PR #30)** — see session log (corrected here: a prior row said "PR open, not yet merged", stale after the PR merged without this row being updated). A session-level `pacingEnabled`/`currentQuestionIndex` pair, chosen once via a checkbox at "Start retro session" (default off). `helpers.js`'s new `pacingSequence(dims)` (pure, order-matched to the existing `interleavedStatements()`) gives every device the same ordered list of individually-answerable items independently, so nothing about the sequence itself needs to be stored — only the shared index into it. The facilitator's session card gets Previous/Next controls (`setCurrentQuestionIndex()`, same `liveOr()`/`.update()` shape `setRevealMode()` already uses); a participant's join screen shows exactly the one item at that index, retaining (never discarding) whatever they'd already answered on an earlier visit to it, and auto-submits the whole draft, unchanged atomic-submission shape, once the facilitator advances past the last question — a participant who hasn't finished answering by then sees a friendly wait state instead of a silent partial submit. **PO review follow-up (2026-09-18)**: two gaps fixed, see session log — (1) the facilitator's own card only showed a bare "Question X of N" counter with no way to know what that question actually asks; `pacingQuestionText()` now shows the exact same text a participant sees. (2) the sprint-experiment note's "Saved" confirmation was a 1.8s timed flash that could be missed, and could even be wiped out mid-flash by an unrelated re-render (any live sessions/responses update re-renders the whole card); it's now a durable, state-derived indicator (`savedExperimentNoteFor`) that survives re-renders and only clears once the note is actually edited again. A Codex review of that same follow-up then found "Saved" could still show for a write that never landed (the click handler didn't await the save's promise, and the promise itself swallowed errors); fixed by returning/rejecting the promise properly and adding a render-time-derived failure hint (`noteSaveFailedFor`), same pattern as `savedExperimentNoteFor` — see session log. |
| P3 | RETRO-3 — Facilitation option: choose which questions to include | As a facilitator, exclude statements/dimensions from the active template that don't apply to this particular retro. Let the facilitator deselect specific questions/dimensions when starting (or before opening) a session, without altering the saved template itself; excluded ones are omitted from the join survey and from that session's consolidation/results. | **Merged (2026-09-18, PR #34)** — see session log (corrected here: this row still said "PR open, not yet merged" after the PR merged, the same stale-status pattern RETRO-2's own row above needed corrected twice already). Scoped to whole-DIMENSION exclusion, not individual statements within a statement dimension (a statement dimension's `scoreBands` are calibrated against summing ALL of its statements — dropping only some would silently shift what "good"/"warn"/"crit" mean; excluding the whole dimension has no such problem, and a direct-rating dimension IS already a single "question"). The "no session" card gets a collapsible checklist (`.dim-include-checkbox` per board dimension, checked/included by default); `startSession()` filters the dimension snapshot by the unchecked keys BEFORE it's ever written into the session doc, so the join survey, `pacingSequence()`, the live tally, and `finishRetroAndApply()` all correctly skip an excluded dimension with zero changes of their own — it was simply never in `sess.dimensions` to begin with. Start is disabled (with an inline hint) if every dimension is unchecked. A Codex review found the checklist's selection was pure DOM state with nothing backing it: `state.dimensions` changing AT ALL (even an unrelated dimension, from this device or a co-facilitator's) fires `db.js`'s own dimensions listener, which calls `renderAll()` and rebuilds this whole card from scratch, silently resetting every checkbox to checked -- reproduced exactly as described (exclude a dimension, trigger a board snapshot, the exclusion vanished). Fixed by adding `pendingDimExclusionsFor`, a squad-keyed draft object outside the DOM (same shape/reasoning as this file's own pre-existing `startingSessionFor`), updated on each checkbox's `change` and read back by `renderSessionCardHtml()` to restore exactly what the facilitator chose instead of defaulting to "everything included"; cleared once a session actually starts. |

## Code quality & refactoring backlog (2026-09-17)

Reviewed against a Copilot refactoring assessment (with two PO comments), re-verified directly
against the actual implementation and tests at the current tip of `claude/optimistic-keller-holuql`
(fresh `git fetch --all --prune` + `git status --short --branch` run first, HEAD confirmed one
commit ahead of `origin/main` with nothing stale) — not taken at face value. Cross-references
`docs/refactoring-report.md` (written 2026-09-12) rather than duplicating it: that report's own
"Status, 2026-09-12" note says every item there is DONE except naming/abbreviation consistency
(deliberately deferred, incremental-only) — confirmed still true (`colorWord`/`trendWord`,
`isStatementDimension`, the `esc()` audit are all present in `helpers.js` today). Nothing below
reopens anything that report already marked done. This review does **not** touch the
embedding/framing decision (SEC-3a, above) — it stays YAGNI and PO-gated, not an active engineering
task.

Grouped per the review's own ground rules: correctness/reliability first, then structural
refactors, then repo/tooling improvements, then what's intentionally deferred.

### Correctness / reliability

| Priority | Story | Problem, value, and acceptance criteria | Status | Dependencies / blast radius |
|---|---|---|---|---|
| P1 | REF-1 — JSON import writes are fire-and-forget; success is reported before the backend confirms anything | **Problem** (confirmed in `board-export-import.js` + `helpers.js`): every live write in `applySquadImportPlan()`/`applyDimensionTemplateConfigImportPlan()` routes through `syncLiveIfConnected()` (`helpers.js:360-365`), which calls `writeFn()`, attaches a `.catch()` for diagnostics, and returns nothing — no caller can await it. The import modal closes and the "JSON import applied…" diagnostic + `renderAll()` fire synchronously right after issuing these writes, not after the relay/board acknowledges them; a later write failure only ever surfaces as an unprompted diagnostic-log line indistinguishable from any other message, with no rollback and no visible partial-failure state. One ordering concern is already handled correctly and should be preserved: new-dimension/new-template/new-squad creation uses real `Promise.all(...).then()` chains that resolve *before* the dependent rating writes that reference them run (`applyDimensionTemplateConfigImportPlan`'s `onDone` callback; `applySquadImportPlan`'s new-squad branch) — it's specifically the matched-entity update writes and the squad-ratings write path that are fire-and-forget. `tests/test_json_import.py` only drives the fake-store harness; no real-relay coverage exists for JSON import. **Value**: a facilitator applying a JSON import gets an honest, ordered completion signal instead of an optimistic one. **Acceptance criteria**: persistence operations invoked from the import executor return awaitable promises (today only new-entity creation does); import completion (modal close, "applied" diagnostic) is reported only after all intended writes for that operation settle; a write failure is visible and distinguishable from success; the already-correct creation-before-rating-import ordering is preserved and stays covered; add real-relay import coverage (fake-store only today); do not promise atomicity unless the implementation actually moves to a transactional/single-document write — call that out explicitly if deferred, don't imply it. | **Merged (2026-09-17, PR #20)** — see session log. Implementation note: squads/dimensions/templates/config are NEVER relay-routed (only `sessions`/`boards` paths are, per `local-store.js`'s `isRelayPath()`), so "real backend, not fake-store" for this specific flow means real `local-store.js` (`write_plain_index()`), not a real relay — the original "real-relay coverage" wording undersold what actually needed proving. New coverage: `tests/test_json_import_write_completion.py`. Now split across `board-import-apply.js` (the two apply functions)/`board-import-preview.js` (the Apply button) by REF-4. | Touches (now) `board-import-apply.js`'s two apply functions and `helpers.js`'s `syncLiveIfConnected`, which is also used 12+ places elsewhere (`squads.js`/`dimensions.js`/`templates.js`/`retro-facilitator.js` — see `docs/refactoring-report.md`'s Open/Closed finding); making it return a promise is additive (existing fire-and-forget callers can simply not await it) but it's a widely-shared helper, so run the full regression suite plus new relay-backed coverage before merging. Does not overlap with RETRO-1 above (RETRO-1 is new export/import *data*; this is the existing import mechanism's write-completion correctness). |

### Structural refactoring opportunities

| Priority | Story | Problem, value, and acceptance criteria | Status | Dependencies / blast radius |
|---|---|---|---|---|
| P2 | REF-2 — Backend contract parity: `local-store.js` vs `relay-client.js` have no single documented contract, and real drift already exists | **Problem**: both files independently implement doc/collection refs, get/set/update/delete/add, snapshot construction, deep-freezing, deep-merging, listener registration, and readiness/unavailable semantics. Confirmed near-identical, independently-maintained copies of `deepFreezeClone`/`deepMerge` in both files. Confirmed real, already-flagged drift (`docs/refactoring-report.md`'s LSP section) still present: `relay-client.js`'s snapshot/doc callbacks carry an `unavailable: !!room.unavailable` boolean that `local-store.js`'s equivalents never set; relay refs always wait on `room.ready` before resolving, local refs resolve synchronously. No single place names the actual contract `db.js` and every feature module depend on. **Value**: a future backend (or a change to either existing one) has a documented contract to code against instead of diffing two ~300-500 line files. **Acceptance criteria**: one documented backend contract; shared contract tests run against both implementations where practical; differences (readiness, `unavailable`, freezing depth) are documented as intentional, not left to silently diverge further; no broad shared-runtime extraction unless it demonstrably reduces risk — Liskov substitution here is already a genuine strength per the existing report, so don't merge the two implementations just for DRY's sake. | **Merged (2026-09-17, PR #22)** — see session log. New `docs/backend-contract.md` (cross-referenced from both files' own header comments) plus `tests/test_backend_contract_parity.py`, which found two real, previously-undocumented nuances while writing it (now documented): `docRef.get()`'s `data()` returns a live, unfrozen reference in BOTH implementations (only `onSnapshot()`/collection `get()` freeze); `relay-client.js`'s routing requires a path's SECOND segment to be a room code, unlike `local-store.js`'s flat indifference to path shape. | Documentation + new contract tests only, as scoped; if a contract test surfaces a real behavioral bug, that becomes its own follow-up item, not silently folded into this one. |
| P2 | REF-3 — `board-sync.js`'s synchronization flags are an undocumented implicit state machine | **Problem**: `hydrating`, `suppressingLocalRewrite`, `pendingRemoteApply`, `hydrateAttemptedForSecret`, `lastPushedBoardContent`, `localBoardReady`, and `teamBoardUnsubscribe` are seven module-level mutable variables whose interaction (boot hydrate vs. live subscription's first snapshot, a local template-switch's suppressed rewrite window, push-dedup baselines needing updates from both push and remote-apply, serialized remote-apply queuing) is real and already correctly reasoned about in the file's own extensive comments, but never written down as an explicit set of states/transitions. State is scoped to the whole module/device, not per-team/room — confirmed harmless *today* only because a device holds one active team secret at a time (`getTeamSecret()`), which is an implicit constraint, not an enforced one. Existing test coverage is more substantial than the raw finding implies: `test_board_sync_hydrate_on_boot.py`, `test_board_sync_live_subscribe.py`, `test_board_sync_template_switch_race.py`, and `test_board_sync_revert_after_remote_change.py` already cover boot-hydrate-vs-live-first-snapshot, local-rewrite-during-remote-apply, and remote-update-then-local-revert. The real gaps: no test for switching teams while a hydrate for the *previous* team is still in flight, and no board-sync-level test for disconnect/reconnect with a queued board push (today's disconnect/reconnect + queued-write coverage — `test_relay_error_handling.py`, `test_relay_write_acknowledgment.py` — is at the relay-client layer only, not exercised through board-sync's own push/hydrate path). **Value**: a contributor can check a change against documented states instead of re-deriving seven flags' interactions from comments; the two real gaps get closed. **Acceptance criteria**: explicit synchronization states/transitions documented; the two genuinely missing tests added (team-switch-during-hydrate; disconnect/reconnect with a queued board-sync push); existing coverage for the other listed scenarios confirmed and cross-referenced, not duplicated; no regression in existing full-suite behavior; incremental refactor only (e.g. naming the flags as one documented state object) — not a rewrite. | **PR open (2026-09-17)**, not yet merged — see session log. Documentation added as a comment block at board-sync.js's top; two new tests close the identified gaps (`test_board_sync_team_switch_during_hydrate.py`, `test_board_sync_disconnect_reconnect_queued_push.py`). Writing the first test found a real race (see session log) — fixed with two small, targeted guards, not a rewrite. | `board-sync.js` (530 lines) plus its 8 existing test files; any change to the flags' actual semantics (not just documentation) needs the full board-sync test group re-run given how many hard-won real bugs are already encoded in this file's comments. |
| P2 | REF-4 — Split `board-export-import.js`'s six responsibilities (903 lines, the largest production module) | **Problem**: confirmed the file mixes export serialization (`buildBoardExport`/`toJSON`), import validation (`parseBoardImportFile`/`isValid*`), pure import planning (`buildSquadImportPlan`/`buildDimensionImportPlan`/`buildTemplateImportPlan`/`buildConfigImportPlan`/`mergeSquadDimensions`), preview rendering (`renderJsonImportPreview`/`entityChipsHtml`), modal event binding, and persistence execution (`applySquadImportPlan`/`applyDimensionTemplateConfigImportPlan`) in one file with no internal boundary. *[PO comment: assess the size of other production and test files and whether they should be refactored on SOLID principles]* — done as part of this review. Production file sizes (lines): `board-export-import.js` 903, `state.js` 727, `retro-facilitator.js` 567, `board-sync.js` 530, `relay-client.js` 520, `retro-join.js` 369, `helpers.js` 386, `dimensions.js` 280, `render.js` 256, `templates.js` 214, `squads.js` 193, `db.js` 182. `state.js`'s size is almost entirely starter-template/translation *data* (three full starter templates plus their Hebrew translations), not logic — not a SOLID/cohesion problem despite the line count, and not proposed for splitting. `board-sync.js`, `relay-client.js`, and `retro-facilitator.js` are each large but each already has one fairly coherent responsibility (team-sync orchestration, relay wire protocol, facilitator UI) — worth watching if they keep growing, not urgent today. `board-export-import.js` is the one file that's both largest and genuinely multi-responsibility. On the test side, `tests/test_json_import.py` (526 lines, the largest test file) is one file per this repo's own stated convention ("every file is named for the feature or flow it covers," `tests/README.md`) covering one flow with many scenarios — consistent with the convention, not a split candidate. **Value**: pure planning logic stays directly unit-testable without a DOM; UI rendering carries no persistence policy; a future format-version bump touches fewer, smaller files. **Acceptance criteria**: pure planning functions remain directly unit-testable; UI rendering contains no persistence policy; persistence execution is awaitable (do this as part of, or immediately alongside, REF-1, not as a separate later pass); no behavior change to merge/replace semantics; JSON format versioning (`formatVersion`/`SUPPORTED_BOARD_FORMAT_VERSION`) stays explicit; no unnecessary module-system/build migration (stays a plain classic `<script>` file per the app's documented `file://` constraint). | **PR open (2026-09-17)**, not yet merged — see session log. Split into six files: `board-export.js` (export serialization), `board-import-validate.js` (parse + shape validation), `board-import-plan.js` (pure merge/replace planning, plus `dimensionImportFields`/`templateImportFields`, pure field-selection only ever used by apply), `board-import-preview.js` (the import modal's preview rendering — including its own Apply/mode/scope/backup button re-binding, inseparable from rendering itself without changing behavior), `board-import-apply.js` (persistence execution), `board-import-ui.js` (the modal's open/close lifecycle). By the time this actually landed the file had grown to 1093 lines (not 903, RETRO-1 grew it further after this was proposed). | `board-export.js`/`board-import-*.js`, exercised by `tests/unit/test_json_export.js`/`test_json_import.js`/`test_last_retro_export_import.js` and `tests/test_json_export.py`/`test_json_import.py`/`test_json_last_retro_round_trip.py`/`test_board_sync_last_retro_preserved.py`/`test_tooltip_and_busy_overlay.py`/`test_json_import_write_completion.py` — full suite must stay green. |
| P2 | REF-5 — Extract pure snapshot normalizers out of `db.js`'s listeners | **Problem**: confirmed `db.js` (182 lines) has 5 `onSnapshot` listeners (sessions, squads, dimensions, templates, config), each combining snapshot-shape normalization (e.g. the squads listener's raw-dimensions-to-plain-object loop; the dimensions listener's statements/scoreBands/strategies/i18n carry-through) with state mutation, render-triggering, `pushBoardSnapshotIfConnected()`, and `diag()` calls, all inline in one callback. Matches `docs/refactoring-report.md`'s existing `initDb()` finding (written against a 104-line function; the file has since grown to 182 lines across more listeners — same shape, larger). **Value**: adding a new synced field (i18n, statements, and scoreBands all arrived exactly this way) means writing one normalizer instead of hunting every listener that touches that snapshot shape. **Acceptance criteria**: each backend snapshot shape normalized in one named pure function; a new field added once, not copied into multiple callbacks; rendering/sync side effects stay explicit in the (now thinner) listener bodies; frozen snapshot data safely cloned before mutable state receives it (already done correctly today — preserve, don't regress); current view-refresh behavior (including the PERF-2 hydrating/suppressingLocalRewrite render-skip) stays intact. | **Merged (2026-09-18, PR #28)** — see session log. Extracted `normalizeSessionDoc`/`normalizeSquadDoc`/`normalizeDimensionDoc`/`normalizeTemplateDimensionEntry`/`normalizeTemplateDoc`/`normalizeConfigSnapshot`, each a pure function taking exactly what a listener callback receives; the five listener bodies now call one of these via `snap.docs.map(...)` and keep only mutation/render/push/diag side effects. New `tests/unit/test_db_normalizers.js` (10 tests) exercises each directly. | `db.js` only, but touched by every feature (squads, dimensions, templates, config, board-sync all flow through it) — needs the full regression suite, not just a unit test on the extracted normalizers. |
| P2 | REF-6 — `relay-client.js`'s `getRoom()` reuses a cached room by routing id without checking the caller's secret matches | **Problem**: confirmed `getRoom(code, secret, remember)` returns `rooms[code]` immediately on a cache hit, without ever comparing the passed-in `secret` against the secret the cached room's key was originally derived from (that comparison only happens on a cache miss). A second call for the same routing code with a *different* secret silently gets back the first caller's derived key — zero error, zero diagnostic. The file's own comments already document a closely related, previously-fixed bug in this exact function (the `remember`-must-be-path-gated fix), confirming this is an area that has already bitten this codebase once. **Value**: a wrong-secret reuse fails loudly and immediately instead of silently decrypting with (or encrypting under) the wrong key. **Acceptance criteria**: requesting an existing room with a mismatched secret does not silently reuse the wrong key; the resulting error is diagnostic (`diag()`) and testable; same-room/same-secret reuse (the common, correct path) is unchanged; a fresh-browser-context test confirms wrong-key behavior (extend `test_relay_board_path_sync.py`, which already tests wrong-secret-decryption-fails for a fresh doc, but not this `getRoom()`-level cache-reuse case specifically); no secret is sent to the relay or persisted beyond today's `rememberCode()` behavior. | **Merged (2026-09-18, PR #29)** — see session log. `getRoom()` now compares an EXPLICIT, truthy `secret` argument against the cached room's own secret on a cache hit; a mismatch returns a fresh, dedicated, already-`unavailable` room (via the same `giveUp()` path every other getRoom() failure already uses) rather than the real cached room, so `docRef()`/`collRef()` need no special case. A call that passes NO secret at all (several legitimate call sites do, by design — see below) still trusts whatever's cached, unchanged from before. | `relay-client.js`'s `getRoom()` only; every session/board room lookup flows through it, so this needs the full relay-backed test group re-run (`test_relay_*`, `test_board_sync_*`, `test_cofacilitator_join.py`, `test_encryption_no_plaintext_on_wire.py`), not just one new targeted test. |

### Repository / tooling improvements

| Priority | Story | Problem, value, and acceptance criteria | Status | Dependencies / blast radius |
|---|---|---|---|---|
| P2/P3 | REF-7 — CI installs Playwright unpinned, contradicting the repo's own pinning policy | **Problem**: confirmed `.github/workflows/tests.yml`'s `playwright` job runs `pip install playwright` with no version pin and no reference to `tests/requirements.txt` (which pins `playwright==1.62.0`), while `docs/DefinitionOfDone.md`/`tests/README.md` both document the pin as the reason cross-machine timing disputes have a fast answer. CI and local can silently run different Chromium builds with no way to tell from a CI log. **Value**: a CI-only timing/flake report can be trusted or ruled out the same fast way the DoD already prescribes for a cross-machine dispute. **Acceptance criteria**: CI installs from `tests/requirements.txt`; Chromium is installed for that exact pinned version; local and CI versions provably agree; no unpinned Playwright install remains anywhere in the workflow. | **Already fixed (2026-09-17, as part of PR #24)** — see that session log entry ("Fixed a real CI-only bug found by a Codex review of PR #24"). This backlog row was written during the same 2026-09-17 Copilot assessment review without noticing the exact same problem had already been fixed earlier that day for an unrelated immediate reason (a Codex review finding on PR #24, not this backlog review) — `.github/workflows/tests.yml`'s `playwright` job installs from `tests/requirements.txt` (the pinned `playwright==1.62.0`) today, not a bare unpinned `pip install playwright`. Verified still true while picking up REF-8/9/10 (2026-09-18): no unpinned Playwright install anywhere in the workflow. No new code change needed for this row. | One-line change to `.github/workflows/tests.yml`'s `playwright` job; no code/test changes; verify with one workflow run. |
| P2/P3 | REF-8 — Relay CI dependency install uses `npm install` despite a committed lockfile | **Problem**: confirmed both the `unit-and-relay` and `playwright` jobs run `npm install` in `relay/`, even though `relay/package-lock.json` is committed — `npm install` can resolve a graph that drifts from the lockfile; `npm ci` installs exactly what's pinned and fails fast on a lockfile/`package.json` mismatch. **Value**: CI's relay dependency graph is byte-for-byte what's committed; a mismatch fails loudly instead of silently drifting. **Acceptance criteria**: CI installs the exact lockfile graph (`npm ci`, both jobs); local setup instructions distinguish `npm ci` (CI/reproducible) from `npm install` (local dev, when actually adding a dependency); relay tests (`npm test`) still pass under `npm ci`. | **Merged (2026-09-18, PR #31)** — see session log. Both `unit-and-relay` and `playwright` jobs now run `npm ci` in `relay/`; verified locally (`rm -rf relay/node_modules && npm ci` succeeds against the committed lockfile, relay's own test suite passes under it). `relay/README.md` now explains the CI-vs-local distinction right where its own `npm install` instructions live. | `.github/workflows/tests.yml` (both jobs) plus a doc line in `relay/README.md`; no relay code changes; verify with one CI run. |
| P2/P3 | REF-9 — Test-shard count/partitioning duplicated between `run_all.sh` and `tests.yml`, no single source of truth | **Problem**: confirmed `SHARD_COUNT` is hardcoded to `3` independently in both `tests/run_all.sh` and `.github/workflows/tests.yml`, with the same partitioning logic reimplemented in bash and in the workflow's `awk` line — kept in sync today only by a comment in each file pointing at the other. Real, acknowledged drift risk, not hypothetical (`tests/README.md`'s own history describes a closely related local/CI divergence — the 2-vs-4-worker concurrency finding — causing real confusion before it was fixed). **Value**: changing the shard count becomes a one-line, unambiguous change instead of a "did I remember the other file" question. **Acceptance criteria**: local and CI use the same shard count and partitioning rule; changing shard configuration has one obvious source of truth; local-full-suite and CI-green remain the same claim (already true today, per `tests/README.md` — must stay true after this change); no unnecessary reduction in test isolation. | **Merged (2026-09-18, PR #32)** — see session log. `tests/run_all.sh` now has a `select_shard_files()` function -- the ONE place that decides which files belong to shard N -- called both by the default (no-args) "run every shard in sequence" path and by a new `SHARD_INDEX=N` single-shard mode. `.github/workflows/tests.yml`'s per-shard matrix job now just sets `SHARD_INDEX: ${{ matrix.shard }}` and calls `tests/run_all.sh` directly, instead of reimplementing the partition as its own `ls \| awk 'NR % n == i'` line. Found a real, previously-undetected consequence of the old duplication while fixing it: the workflow's 1-indexed `awk` `NR` against this script's 0-indexed loop counter meant CI's "shard 0" and a local run's "shard 0" were actually DIFFERENT physical file groups (each still correctly partitioned the full suite on its own, so nothing broke, but the labels didn't correspond) -- now there's exactly one implementation, so they're the same group by construction. A Codex review then found the acceptance criterion ("one obvious source of truth") wasn't actually met: the workflow's matrix still hand-maintained its own `shard: [0, 1, 2]` list as a THIRD independent copy of the count, alongside the workflow's `SHARD_COUNT` and this script's own `${SHARD_COUNT:-3}` default -- confirmed via an isolated check that bumping `SHARD_COUNT` to 4 while leaving that list unchanged silently skipped 15 of 63 files, every job still green. First fix moved `SHARD_COUNT` to the workflow's top-level `env:` and added a `compute-shard-matrix` job that generates the matrix list from it -- verified working against a real CI run, but a second Codex review pass then found `tests/run_all.sh`'s own `${SHARD_COUNT:-3}` default was STILL a second, independent hardcoded copy, so the acceptance criterion remained unmet. Fixed properly by introducing `tests/.shard_count` -- a plain checked-in file (same pattern as this script's own `tests/.timing_baseline`) -- as the actual single source of truth: both `run_all.sh`'s default and the workflow's `compute-shard-matrix` job now read that one file, and the workflow no longer sets a `SHARD_COUNT` env var at all. | `tests/run_all.sh`, `tests/.shard_count` (new), and `.github/workflows/tests.yml`; orchestration-only, low risk, but verify with an actual CI run across all 3 shards, not just locally. |
| P2/P3 | REF-10 — No root-level command entry point across Node/Python/relay/shell tooling | *[PO comment: my preference is also a Makefile]* **Problem**: confirmed running the unit suite, the relay's own tests, the Playwright suite, or a setup check each require a different tool/directory today (`node --test tests/unit/test_*.js`; `cd relay && npm test`; `tests/run_all.sh`; `pip install -r tests/requirements.txt && playwright install chromium`), with no root command surface tying them together. **Value**: a new contributor or CI runs one obvious command per task instead of reconstructing it from `tests/README.md`/`relay/README.md` each time. **Acceptance criteria**: add a root `Makefile` (per the PO's stated preference) with targets for unit tests, relay tests, browser tests, the full suite, and a setup/check command; targets use the pinned Python environment/dependencies; targets run correctly from the repository root; CI can reuse the same targets where practical (also partially addresses REF-9's single-source-of-truth goal for the non-sharded jobs); no new heavyweight build system introduced. | **PR open (2026-09-18)**, not yet merged — see session log. New root `Makefile` with `help`/`setup`/`check`/`unit`/`relay`/`browser`/`test` targets, each a thin wrapper around the exact commands `tests/README.md`/`relay/README.md` already document. Deliberately not wired into `.github/workflows/tests.yml` yet, per this row's own acceptance criteria (ship the Makefile first, wire CI to it once proven locally, as a separate follow-up). A Codex review found `make setup`'s bare `python3 -m pip install` fails with `externally-managed-environment` on a PEP 668 system; fixed by having `make setup` create a project-local `.venv` and installing into that, with `check`/`browser`/`test` consistently using its python (`browser` via prepending it to `PATH`, so `tests/run_all.sh` and every test file need no changes). | New root `Makefile`, `.venv/` added to `.gitignore`; optionally wires `.github/workflows/tests.yml` to call it (recommended but separable — ship the Makefile first, wire CI to it once proven locally). |
| P3 | REF-11 — `STATUS.md` has grown to ~3500 lines despite describing itself as a one-page entry point | **Problem**: confirmed `STATUS.md` is ~3500 lines as of this review, almost entirely session-log history. `CLAUDE.md` and `STATUS.md`'s own header both describe it as "the one-page entry point for picking this project up cold," no longer literally true for a fresh reader who has to scroll past thousands of lines of dated history to find current decisions/backlog tables. **Value**: a fresh contributor (or agent) can read the "current state" part in one sitting; historical detail is preserved, just not in the way of it. **Acceptance criteria**: `STATUS.md` remains the authoritative current backlog/decision index; historical session-log detail moves to a dedicated, dated archive document; existing cross-references to specific dated session-log entries remain understandable after the move; no historical decision is deleted, only relocated; the change doesn't duplicate `docs/DefinitionOfDone.md` or feature-spec docs. | **Done (2026-09-18)** — see `docs/session-log.md`'s own top entry for the full writeup. The session log (990-4429 of the pre-split file, ~3440 lines) moved verbatim into `docs/session-log.md`; `STATUS.md` now ends with a short pointer at the same "## Session log" heading instead of the content itself. A repo-wide grep for "session log" found ~15 existing cross-references (`CLAUDE.md`, `docs/DefinitionOfDone.md`, `.claude/skills/tdd/SKILL.md`, `README.md`, `docs/facilitated-retro-spec.md`, `docs/refactoring-report.md`, `ETHICS.md`, and code comments in `public/js/`/`public/styles.css`/`tests/`); left as-is since they still resolve correctly through that same pointer, matching this repo's own established precedent (`tests/README.md`'s note that old session-log references elsewhere are "left as-is since they're dated history, not live references"). `CLAUDE.md` and `README.md` updated to describe the split. Docs-only change, no code/tests touched — did not re-run the full Playwright suite for this reason (same precedent as the 2026-09-17 backlog-only pass), ran the fast unit suite as a sanity check (180/180). | `STATUS.md` itself, plus any doc/comment linking to a specific dated session-log entry — a grep for cross-references before moving anything is the right first implementation step, not part of this backlog-only task. |
| P3 | REF-12 — Generated Playwright test pages live inside `public/` (gitignored, but real noise during local dev) | **Problem**: confirmed `tests/fixtures/build_page.py` writes `_test_*.html`/`.js` files directly into `public/` (its own header comment explains why: relative asset links to `styles.css`/`vendor/qrcode.js`/`app.js` must resolve the same way they do in production, and tests run over `file://`). `.gitignore` excludes them from version control, but they're real files alongside production assets during and after any local test run. **Value**: production `public/` assets stay visibly distinguishable from generated test fixtures during local development, without touching what the suite actually proves. **Acceptance criteria**: production public assets remain clearly distinguishable from generated fixtures; test pages are not deployed (already true) or tracked (already true); any move preserves relative asset resolution and CSP behavior; evaluate a temporary public-like test subdirectory (e.g. `public/_test/`) OR a local HTTP server as the alternative to `file://`; preserve the current `file://` test path unless a replacement is proven equivalent; include a measured blast radius (how many of the suite's `page.goto()` calls and `build_page()`/`write_plain_index()`/`build_custom_page()` helpers would need to change) before any implementation is scheduled. | **Investigated (2026-09-18)** — decision recorded, see `docs/session-log.md`'s entry for the full writeup; per this row's own scoping, no code landed in this pass. Recommendation: adopt the `public/_test/` subdirectory option, reject the local-HTTP-server option. The two riskiest acceptance criteria (relative asset resolution, CSP behavior) were proven, not assumed, with a real throwaway Playwright smoke test against a nested page under the app's actual CSP — zero console/page errors, all resources 200, `getComputedStyle` confirmed the stylesheet actually applied, not just loaded — then deleted immediately. Local HTTP server was rejected: the one existing precedent (`test_join_link_secret_not_in_http_request.py`) shows it doesn't even solve the stated problem (that test still writes its file straight into `public/`, just also serves it over HTTP), and switching every test's transport would be strictly more blast radius for no corresponding benefit — `file://` is preserved as the row itself prefers. | Measured directly, not estimated: `tests/fixtures/build_page.py` (its 3 write functions plus a new relative-path `../`-prefix rewrite step), 4 files with their own duplicated `PUBLIC_DIR`-write logic (`test_backend_contract_parity.py`, `test_relay_error_handling.py`, `test_relay_legacy_known_codes.py`, `test_relay_write_acknowledgment.py`), a one-line URL fix in `test_join_link_secret_not_in_http_request.py` (`out.name` → `out.relative_to(PUBLIC_DIR)`, since its HTTP server is rooted one level up once the file moves), and `test_relay_config_injection.py` (writes `_test_relay_config_injection.html` straight into `public/` via its own inline `REPO_ROOT / "public" / ...` path, with relative `src="relay-config.js"`/`src="vendor/qrcode.js"` script URLs of its own — both the output path and those URLs would need updating; it does delete the file after a successful run, but not on a failed assertion inside the harness, so it isn't a safe exclusion) — **7 code files total** (Codex review of PR #37 caught this last one, missed by the original grep since it builds its path inline rather than via a named `PUBLIC_DIR` variable), plus `.gitignore` and the doc comments describing the current flat layout in `tests/fixtures/build_page.py`/`tests/README.md`. The other 58 test files and all 62 `page.goto()` call sites need zero changes: they only ever consume the helper's own returned, already-resolved `Path`. |

### Additional review measures considered, deliberately not backlogged as tracked metrics

Per the review's own instruction not to add noisy metrics without a clear action threshold:
async fire-and-forget call sites, mutation-fan-out (state mutation + render + persistence per call
site), module fan-in/fan-out, function complexity/nesting, and `renderAll()`-calls-per-action are
all real, inspectable properties of this codebase (several are exactly what REF-1/REF-3/REF-5 above
already found by inspection), but none is proposed here as an ongoing tracked metric — there's no
agreed threshold yet at which any of them would block a change. The one concrete, repeatable-tool
recommendation: an ESLint pass (`complexity`, `max-lines`, `max-depth`, `max-params` rules) would
give REF-4/REF-5's targets a repeatable check going forward — **not added now**, since this task is
backlog-only and the repository has no existing ESLint config to extend (confirmed: no
`.eslintrc*`/`eslint.config*` anywhere in the repo). Worth revisiting once REF-4's split lands and
there are smaller, single-responsibility files to set real size/complexity limits against.

### Deferred / low-value / YAGNI (not active engineering tasks)

- **Naming/abbreviation consistency** (`sq`/`squad`, `sess`/`session`, `dim`/`d`) — already flagged
  and deliberately deferred in `docs/refactoring-report.md` ("better done incrementally, file by
  file, whenever that file is next touched for a real reason"). Not reopened here; no new entry
  needed.
- **`state.editing`'s dual shape** and **splitting `dimensions-templates.js`** — same source,
  already listed there as lower-urgency "next time you're already touching that file" items. Not
  duplicated here.
- **Embedding/framing** (`frame-ancestors`/`X-Frame-Options`) — remains **YAGNI, PO-gated** per
  SEC-3a above. This review does not convert it into an active item and recommends no change to
  that decision.
- **ESLint config** — see "Additional review measures" above: a real recommendation, but explicitly
  not introduced in this backlog-only pass.


## Session log

The dated, chronological log of past work — every session's "what changed, why, what it fixed,
what was verified" entry — moved to **[`docs/session-log.md`](docs/session-log.md)** on 2026-09-18
(REF-11, "Repository / tooling improvements" below). By that date this file had grown to ~4400
lines almost entirely from that history, no longer literally the "one-page entry point" its own
header above claims for a fresh reader. Nothing was rewritten, summarized, or dropped in the
move — every dated entry is there, verbatim, in order. Every existing "see `STATUS.md`'s session
log" reference elsewhere in this repo still resolves correctly by following this same pointer.

**New entries go in `docs/session-log.md`, not here** — append a dated entry there (same style as
its existing entries) after finishing any non-trivial change, per `docs/DefinitionOfDone.md`'s
delivery-workflow section.
