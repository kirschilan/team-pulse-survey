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
lives, kept up to date as work lands. Short version: this app currently has
**no backend** — it originated as a prototype running inside a Claude
Artifact's `db` capability, and is being migrated to a standalone deployment
per `docs/standalone-plan.md`. Right now it runs standalone with everything in
one browser tab and no cross-device sync.

## Project layout

```
STATUS.md          Current state, open items, session log -- start here
public/            The app itself -- static site, deploys as-is
  index.html
  app.js
  styles.css
  vendor/
    qrcode.js      Bundled QR generator (kazuhikoarase/qrcode-generator, MIT)
tests/             Playwright + Python regression suite (see tests/README.md)
docs/
  facilitated-retro-spec.md   Feature spec + history for the retro-session work
  standalone-plan.md          Architecture plan for the standalone/embedded version
vercel.json
```

## Running locally

It's a static site with no build step — open `public/index.html` directly, or
serve the `public/` directory with any static file server:

```
cd public && python3 -m http.server 8000
```

Note that without a real backend wired up yet (see Status above), most
multi-device features (retro sessions across devices, live Tribe-view sync)
won't do anything useful outside of the test harness's fake in-memory store.

## Testing

See `tests/README.md`. Every change is expected to pass the full regression
suite with zero JavaScript errors before it ships.

## License

Apache 2.0 — see `LICENSE`.
