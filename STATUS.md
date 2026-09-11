# Squad Pulse — Status

One-page entry point for picking this project up cold. Update the session log at the bottom
whenever you finish a chunk of work — this is the one place "what's outstanding" lives; the other
docs in `docs/` are reference material this file points to, not duplicates of it.

## What's real right now

- `public/` is a working static site — `index.html` + `app.js` + `styles.css` +
  `vendor/qrcode.js` — ported verbatim from the original Claude Artifact prototype
  (`squad-pulse.html`) with zero behavioral change. No build step; open `public/index.html`
  directly or serve `public/` with any static file server.
- Full feature set works standalone in one browser tab: squad ratings across a customizable
  dimension template, Tribe-view cross-squad rollup, and the facilitated live-retro flow (join by
  code/QR, blind statement survey or direct green/yellow/red pick depending on the dimension,
  live or held reveal, facilitator override, finish-and-apply into the squad's real ratings).
- 12 built-in template stories' worth of regression coverage: `tests/test_generic.py` and
  `tests/test_v2.py` through `tests/test_v13.py`, all passing with zero JS errors as of the last
  run (2026-09-10), driven by Playwright against a fake in-memory store
  (`tests/fixtures/fake_store.html` + `tests/fixtures/build_page.py`) standing in for the real
  backend described below. See `tests/README.md` for how to run them.
- `vercel.json` is in place for zero-config static hosting (`outputDirectory: "public"`), but
  **nothing has been deployed to Vercel yet** — this repo has never been connected to a Vercel
  project.

## The one thing to know before touching app.js

`public/app.js` persists everything through a single call:

```js
window.claude.use("db")   // app.js:2287
```

That's a Claude-Artifact-only API — it doesn't exist outside a Claude Artifact sandbox.
`public/local-store.js` (loaded right before `app.js`) now provides a same-shaped replacement for
plain deployments: `window.claude.use("db")` resolves to a Firestore-shaped shim backed by this
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
(There's one other `window.claude.use(...)` call, for `"downloads"` at app.js:2028, and a
`window.claude.hot` hot-reload guard at the bottom of the file that already degrades safely with no
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
