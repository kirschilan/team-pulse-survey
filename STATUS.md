# Squad Pulse — Status

One-page entry point for picking this project up cold. Update the session log at the bottom
whenever you finish a chunk of work — this is the one place "what's outstanding" lives; the other
docs in `docs/` are reference material this file points to, not duplicates of it.

## What's real right now

- `public/` is a working static site — `index.html` + `styles.css` + `vendor/qrcode.js` +
  `local-store.js` + `app.js` + nine feature modules under `public/js/` (see "The app's file
  layout" below). Originally ported verbatim from the Claude Artifact prototype
  (`squad-pulse.html`) as one 2396-line `app.js`, then split by feature on 2026-09-11 with zero
  intended behavior change. No build step; open `public/index.html` directly or serve `public/`
  with any static file server.
- Full feature set works standalone in one browser tab: squad ratings across a customizable
  dimension template, Tribe-view cross-squad rollup, and the facilitated live-retro flow (join by
  code/QR, blind statement survey or direct green/yellow/red pick depending on the dimension,
  live or held reveal, facilitator override, finish-and-apply into the squad's real ratings).
- 15 files' worth of regression coverage under `tests/` (named for the feature/flow each one
  covers — see `tests/README.md`), all passing with zero JS errors as of the last run
  (2026-09-11), driven by Playwright against a fake in-memory store (`tests/fixtures/fake_store.html`
  + `tests/fixtures/build_page.py`) standing in for the real backend described below, plus one file
  (`tests/test_local_store.py`) that deliberately loads the real `public/index.html` to cover
  `local-store.js` itself. Runs automatically on every push/PR via
  `.github/workflows/tests.yml`. See `tests/README.md` for how to run them locally.
- `vercel.json` is in place for zero-config static hosting (`outputDirectory: "public"`), but
  **nothing has been deployed to Vercel yet** — this repo has never been connected to a Vercel
  project.

## The app's file layout

`public/app.js` used to be one 2396-line file (a single IIFE, ported verbatim from the Claude
Artifact prototype). It's now a thin entry point — view-switch wiring, the one cross-cutting
Escape-key handler, and `start()`/boot — and the actual feature code lives in `public/js/`, split
along the seams the original file already had (`// ---------- section ----------` comments):

| File | Covers |
|---|---|
| `state.js` | Shared `state` object, starter templates, placeholder squads/dimensions, initial UI-prefs load. Loads first. |
| `helpers.js` | Pure helpers used everywhere: `esc`, `diag`, banding/consolidation math, `sortedSquads`/`sortedDimensions`, `findSquad`, unit-label helpers. |
| `render.js` | `renderAll` and everything it drives — header/stats/ranking/hotspots/grid/legend, grid tooltip. |
| `modals.js` | The generic confirm modal, the cell-rating modal, and the busy overlay — shared widgets several features reuse. |
| `squads.js` | Squad CRUD, Admin's squad list, Squad view, and the two `persistDimensionRating(s)` writers. |
| `retro.js` | Retro sessions end to end: start/close, the session card, override + sprint note, finish-and-apply, the live response tally, and the join screen (participant side). |
| `dimensions-templates.js` | The dimension manager and template save/load/delete. |
| `csv.js` | CSV export and import (parsing, column matching, preview, apply). |
| `db.js` | `initDb()` — the Firestore-shaped snapshot listeners that wire `db` writes into `state` and back into a render. |

**These are plain classic `<script>` files sharing the global scope, not ES modules** — Chromium
blocks cross-file `import` over `file://` with a CORS error, which would break both the Playwright
suite (every test navigates via `file://`) and the README's "open `index.html` directly" workflow.
`index.html` loads them in the order above, then `app.js` last; load order only matters for the
handful of top-level `document.getElementById(...)` lookups each file does for elements that are
already in the DOM by the time these scripts run (they sit at the end of `<body>`) — every actual
cross-file *call* happens inside a function body triggered later (an event handler, or `start()`),
by which point every file has finished loading, so the specific order between the nine files
doesn't otherwise matter.

## The one thing to know before touching the app

`public/js/db.js`'s `initDb()` persists everything through a single call:

```js
window.claude.use("db")
```

That's a Claude-Artifact-only API — it doesn't exist outside a Claude Artifact sandbox.
`public/local-store.js` (loaded before every `js/*.js` file) now provides a same-shaped replacement
for plain deployments: `window.claude.use("db")` resolves to a Firestore-shaped shim backed by this
browser's own `localStorage`, and `window.claude.use("downloads")` triggers a real browser file
download instead of the old "paste this into a new tab" fallback. It only installs itself when no
real `window.claude` is already present, so it's a no-op both inside a Claude Artifact and inside
the Playwright test harness (`tests/fixtures/fake_store.html` sets its own `window.claude` and
loads after this file — see `build_page.py`). This satisfies the "board lives in the facilitator's
own browser" decision below for the squads/dimensions/templates/config board itself. **It does not
give retro sessions cross-device sync** — that's still the ephemeral encrypted relay in
`docs/standalone-plan.md`; two tabs of the *same* browser do stay in sync (via the native `storage`
event), which is enough to self-test the retro flow, but two different devices still won't see each
other.
(There's one other `window.claude.use(...)` call, for `"downloads"` in `public/js/csv.js`, and a
`window.claude.hot` hot-reload guard at the bottom of `app.js` that already degrades safely with no
`window.claude` present — neither of those blocks anything.)

## Decisions locked in (don't re-litigate these)

- **No persistent, multi-tenant database, ever.** A facilitator's own browser is the board's
  source of truth — squads, templates, ratings. Durability beyond one browser session is an
  explicit **Save board → file** / **Load board ← file** action, not always-on persistence. (Not
  implemented yet — see below.)
- **Only a live retro session touches a server**, and only for that session's lifetime — an
  ephemeral, in-memory, per-session-code relay (dimensions snapshot + responses + status/
  revealMode/overrides/experimentNote), forgotten once the room empties. No database.
- **Self-hosted relay + end-to-end encryption**, chosen deliberately over Firebase/Supabase.
  Excalidraw-style: the join link carries `#s=<code>&k=<key>` in the URL fragment, which never
  reaches a server on a normal page load — the relay only ever sees ciphertext.
  Full rationale and the researched Excalidraw/Vercel architecture this is based on:
  `docs/standalone-plan.md`.
- **Retro-session feature behavior** (consolidation rule, anonymity model, per-template scoring)
  is specified and versioned in `docs/facilitated-retro-spec.md` — that file has its own session
  log for that feature's history; don't duplicate it here.

## Deliberately not built yet (and why)

| Not built | Why it's cut for now | What would trigger building it |
|---|---|---|
| The relay server (`relay/` doesn't exist) | No prod usage yet to justify standing up infra | Ready to test cross-device retro sessions for real |
| Client-side encryption (fragment key, encrypt/decrypt) | Depends on the relay existing first | Same as above |
| Save-board / Load-board-to-file | `local-store.js` already persists the board via `localStorage`, which covers the same browser/device | Once someone needs a board to move between browsers/devices without a relay |
| Vercel deployment | Nothing has been deployed yet — the app is now Vercel-ready (`vercel.json` + `local-store.js`), just not connected to a Vercel project | Whenever a public URL is wanted, even pre-relay |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |

## Suggested next step

Two independent tracks, either can go first:

1. **Ship the static site to a public Vercel URL as-is.** No code changes needed — `vercel.json`
   is ready and `local-store.js` makes the board work standalone. Gets a shareable link even
   before the relay exists (single-device use only, no cross-device retro sync).
2. **Build the relay** per `docs/standalone-plan.md`: a Vercel WebSocket function holding
   in-memory per-session state, then wire `app.js`'s one `db` call point over to it with the
   fragment-key encryption layer. This is the real unblock for cross-device retro sessions.

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
