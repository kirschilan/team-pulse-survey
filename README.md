# Squad Pulse

A no-database team pulse survey and facilitated retro tool, with customizable
predefined templates (The Five Dysfunctions of a Team, Spotify Squad Health
Check, Tuckman's stages of group development) that can be customized. Built
by [Dr. Agile](https://dragile.com).

Squad view gives a squad a quick health snapshot across whatever dimensions
your template defines; Tribe view rolls those up into cross-squad hotspots —
where the same dimension keeps coming up red or yellow in more than one
squad, which tends to point at an org-level problem rather than a
squad-by-squad one. On top of that, a facilitator can run a live retro
session: teammates join with a 6-character code or a link, answer anonymously
(either a blind statement-based survey, or a direct green/yellow/red pick
depending on the dimension), and the facilitator finishes the session by
writing the consolidated (or manually overridden) result straight into the
squad's own ratings.

## Status

See **`STATUS.md`** for current state, locked-in decisions, what's deliberately
not built yet, and the session log — that's the one place "what's outstanding"
lives, kept up to date as work lands. Short version: this app originated as a
prototype running inside a Claude Artifact's `db` capability and has been
migrated to run standalone. The board (squads, dimensions, templates) stays in
the browser's own `localStorage` via `public/local-store.js` — deliberately
per-device, not synced (see `STATUS.md`). A live retro **session**, on the
other hand, now genuinely syncs across real devices through a small
self-hosted relay (`relay/`) with client-side encryption — see
`relay/README.md`.

## Project layout

```
STATUS.md          Current state, open items, session log -- start here
public/            The app itself -- static site, deploys as-is
  index.html
  app.js           Entry point: view-switch wiring, the Escape-key handler, boot -- thin on purpose
  local-store.js   localStorage-backed replacement for the Claude Artifact `db`/`downloads`
                   capabilities, so the app works standalone (e.g. on Vercel)
  js/              Feature modules app.js boots (plain scripts, not ES modules -- see STATUS.md
                   for why and for the file-by-file map)
    state.js, helpers.js, render.js, modals.js, squads.js,
    retro-facilitator.js, retro-join.js, dimensions.js, templates.js,
    csv.js, db.js, crypto.js, relay-client.js
  styles.css
  vendor/
    qrcode.js      Bundled QR generator (kazuhikoarase/qrcode-generator, MIT)
relay/             The one server this app has -- a small WebSocket relay for live retro
                   sessions only (see relay/README.md); everything else stays client-side
tests/             Playwright + Python regression suite (see tests/README.md)
docs/
  facilitated-retro-spec.md   Feature spec + history for the retro-session work
  standalone-plan.md          Architecture plan for the standalone/embedded version
  refactoring-report.md       Prioritized code-quality backlog (SOLID gaps, complexity, naming)
scripts/
  generate-relay-config.js    Vercel build step -- wires a deployed relay's URL in via an
                               env var (see relay/README.md)
render.yaml        One-click-ish Render blueprint for deploying relay/ (see relay/README.md)
vercel.json
```

## Running locally

The app itself is a static site with no build step — open `public/index.html`
directly, or serve the `public/` directory with any static file server:

```
cd public && python3 -m http.server 8000
```

For a real multi-device retro session (not just the fake in-memory store the
test harness uses), also run the relay:

```
cd relay && npm install && npm start
```

`index.html` defaults to `ws://localhost:8787`, so a local relay plus either
of the above is enough to try a full retro across two browser windows. Tribe
view and the rest of the board never touch the relay — only a live session
does.

## Deploying for real

Two intended uses, both covered:

- **Embedding this somewhere public** (e.g. a subdomain + iframe on a
  website): the static site deploys to Vercel as-is; the relay deploys
  separately as a plain Node process — `render.yaml` at the repo root makes
  that close to one-click on [Render](https://render.com). Full steps,
  including testing a real relay on a Preview deployment before merging to
  `main`: `relay/README.md`.
- **Forking this to self-host on a LAN**, e.g. to route around a company's
  own security constraints: run the relay with `npm start` and the static
  site with any file server, both on the same network, no cloud account or
  external dependency needed at all. Also in `relay/README.md`.

## Testing

See `tests/README.md`. Two tiers: fast, dependency-free Node unit tests for
pure logic (`tests/unit/`), and a Playwright suite for everything that needs
a real browser (`tests/test_*.py`). Every change is expected to pass both
with zero JavaScript errors before it ships. `relay/` has its own
`npm test` (see `relay/README.md`); `tests/test_relay_cross_device_sync.py`
runs the relay for real against two independent browser contexts as part of
the main suite.

## License

Apache 2.0 — see `LICENSE`.
