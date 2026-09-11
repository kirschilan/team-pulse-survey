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

That's a Claude-Artifact-only API — it doesn't exist outside a Claude Artifact sandbox, and there
is currently **no replacement**. Outside of the test harness's fake store, this app has no real
backend at all: nothing persists between page loads, and nothing syncs across devices. This is the
central gap standing between "static site" and "the thing described in `docs/standalone-plan.md`."
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
| Replacing `window.claude.use("db")` in `app.js` | Depends on the relay + encryption existing | Same as above |
| Save-board / Load-board-to-file | Lower priority than getting live sessions working at all | Once someone needs a board to outlive one browser tab |
| Vercel deployment | Nothing to deploy yet beyond the static site as-is | Whenever a public URL is wanted, even pre-relay |
| Embedding decision (subdomain+iframe vs. same-site route) | Blocked on the Dr. Agile marketing site's stack, which wasn't settled as of this writing | Once the marketing site (separate Claude Code project) is further along |

## Suggested next step

Two independent tracks, either can go first:

1. **Ship the static site to a public Vercel URL as-is.** No code changes — `vercel.json` is
   ready. Gets a shareable link even before the relay exists (single-device use only, no
   cross-device retro sync).
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
