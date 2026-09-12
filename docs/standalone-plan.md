# Squad Pulse: standalone, embeddable version — proposal

**Goal, as stated:** move Squad Pulse out of the Claude Artifact sandbox into a real git-tracked
codebase deployed on Vercel, in the Excalidraw model (facilitator's browser is authoritative, no
multi-tenant database, share a link, save/reload to a file), so it can be embedded on the Dr. Agile
website as a self-serve offering for visitors.

This started as a proposal only. As of 2026-09-11, the relay and encryption pieces below are now
actually built — see `relay/README.md` and STATUS.md's "What's real right now" for the current
state, and the two update notes inline below for where the real implementation deviated from this
original sketch (both times, to keep an existing UX path working). The rest of this document
(embedding decisions, the local-first board itself) is still exactly what it was: architecture and
open questions, not yet acted on.

## What "the Excalidraw model" means here, precisely

Excalidraw splits collaboration into two independent pieces: an ephemeral WebSocket relay that just
rebroadcasts diffs to whoever's currently in a room (holds nothing durable itself), and Firebase,
which persists the current scene so a late joiner or a refreshed tab can recover it. The encryption
key travels only in the URL fragment (`#room=id,key`) — fragments never reach a server on a normal
page load — so neither the relay nor Firebase ever sees plaintext.

You clarified the piece that matters most for Squad Pulse: **there's no permanent, multi-tenant
database at all.** A facilitator's board lives in their own browser; sharing a link lets teammates
join *that* live session; saving to a file is how the facilitator keeps it beyond the browser. That's
actually a step simpler than Excalidraw itself (which does persist rooms server-side) — Squad Pulse
doesn't need "come back next month and reopen this," it needs "run today's retro live, right now."

## Revised architecture

**The board never leaves the facilitator's browser.** Squads, dimensions/templates, and each squad's
current ratings stay in `localStorage`, exactly like today, with two new explicit actions:

- **Save board** — exports the whole board as a downloadable `.json` file.
- **Load board** — imports one back in, replacing local state.

No server ever sees this data. A visitor trying the embedded demo on your website never creates an
account and never has their board sitting on any server anywhere — it's theirs, in their tab, until
they choose to save it.

**Only a live retro session talks to a server, and only for the session's lifetime.** This is the one
place multiple devices genuinely need to see the same thing at the same time. Looking at what a
session doc actually carries today (`dimensions` snapshot, `status`, `revealMode`, `overrides`,
`experimentNote`, plus the `responses` subcollection) — that's the *entire* sync surface. The relay
doesn't need to know anything about squads, the template library, or Tribe view; it only ever holds
one small JSON blob per active session code, in memory, for as long as that room has at least one
connection. When everyone leaves, it's gone — there's nothing to clean up, expire, or worry about
retaining.

**Encryption follows Excalidraw's own trick, applied to that one blob.** The join link carries the
session code plus a random key in the URL fragment: `.../join#s=ABC123&k=<key>`. Every message a
client sends to the relay — a submitted answer, a reveal-mode toggle, an override — is encrypted with
that key *before* it leaves the browser. The relay stores and rebroadcasts ciphertext only; it cannot
read what anyone answered. That's a genuinely strong, honest thing to say to a visitor trying this on
your website: *your team's answers are visible only to your team, not to us.*

> **Update, 2026-09-11 — built, with one deliberate deviation from the paragraph above:** the actual
> key is `SHA-256(session code)`, not an independent random secret in a URL fragment. The app's
> *primary* join path by this point is typing the 6-character code by hand (added later, to fix a
> real iPhone bug where scanning a QR code doesn't reliably carry a fragment/query string through) —
> a path with no fragment to carry a separate key at all. Deriving the key from the code keeps that
> path working, at a real cost to the claim above: since the relay already sees the code (it's the
> room id), a relay operator who deliberately computes the same public hash can derive the same key.
> The honest version of the claim is narrower: this protects against passive network eavesdropping
> and against answers sitting in plaintext in relay logs, memory, or backups — not against a relay
> operator who chooses to snoop. See `public/js/crypto.js` and STATUS.md's locked decisions for the
> full writeup. If the fragment-key version above is ever wanted for real (e.g. a link-only join
> flow with no typed-code fallback), it can still be added as an option alongside this one.

**Reconnection** works the same way it does today, just server-held instead of client-held: a
participant who refreshes, or joins a few minutes late, asks the relay for the room's current
ciphertext blob and picks up from there — the same recovery Excalidraw gets from Firebase, just
scoped to one sitting instead of forever, and without needing a database to get it.

## Where this runs

- **Relay**: originally sketched here as one small Vercel Function using their native WebSocket
  support, with room state kept in an in-memory `Map` keyed by session code.
  > **Update, 2026-09-11:** `relay/server.js` is built exactly this way (plain Node + `ws`, an
  > in-memory `Map` keyed by session code) and works, verified against real WebSocket connections
  > and real encrypted traffic — see `relay/README.md`.
  > **Update, 2026-09-12 — deliberately NOT deployed as a Vercel Function, decision locked in:**
  > Vercel's WebSocket support reached public beta in mid-2026; checked directly against their docs
  > before relying on it, rather than assuming the sketch above still held. It does **not** guarantee
  > a new connection reaches the same Function instance as an existing one, and Vercel's own guidance
  > for anything needing shared state across connections — rooms, presence, pub/sub, exactly this
  > relay's job — is to add an external store (Redis from the Vercel Marketplace). That's a real,
  > ongoing dependency this project doesn't want on either of its two audiences: someone embedding
  > this on a company website, and someone forking it to self-host entirely offline on a LAN (the
  > repo's second, equally real purpose — see `STATUS.md`). Requiring Redis turns "no persistent
  > database, ever" into "small database, technically," and turns "fork this, run one Node process"
  > into "fork this, run one Node process *and* provision Redis." Instead, `relay/server.js` stays a
  > completely ordinary, dependency-free (beyond `ws`) Node process, deployed as a genuinely separate
  > small service — a `render.yaml` blueprint at the repo root makes Render specifically about as
  > close to one-click as this gets (see `relay/README.md`), and the exact same process runs
  > unmodified on Fly.io, Railway, a VPS, a container, or literally `npm start` on a LAN machine with
  > no cloud account at all. One process holding the in-memory `Map` sidesteps the
  > multiple-instances-don't-share-state problem entirely, at the cost of being a second deployment
  > target instead of one — the right trade for this project's actual audiences. The static site
  > learns that relay's URL via a `SQUAD_PULSE_RELAY_URL` Vercel environment variable and a small
  > build step (`scripts/generate-relay-config.js`) rather than a hand-edited `index.html`, so it can
  > be set differently for a Preview deployment (to test before merging) than for Production — see
  > `relay/README.md`'s "Wiring the deployed static site to this relay".
- **Frontend**: the same single-page app, deployed as a static site. Zero-config on Vercel either
  way.

## Embedding on the Dr. Agile website

Two realistic patterns:

1. **Subdomain + iframe** (e.g. `tool.dragile.com` or `squadpulse.dragile.com`, embedded via
   `<iframe>`, or just linked as "Try it now" opening in its own tab). Keeps Squad Pulse's styling,
   state, and release cycle fully independent of the marketing site. Needs the Squad Pulse deployment
   to send a `frame-ancestors` CSP that allows your marketing domain, if you iframe rather than link.
2. **Same-site route** (e.g. `dragile.com/tools/squad-pulse`), if the marketing site is itself a
   Vercel-hosted app (Next.js or similar) — tighter integration, one deployment, no cross-origin
   concerns, but couples Squad Pulse's releases to the marketing site's.

I'd default to option 1 unless the marketing site's stack makes option 2 easy — but this is worth
you confirming rather than me guessing at your website's setup.

## Repo structure and migration plan

```
squad-pulse/
  public/                 index.html, styles.css, app.js  (split out of today's single inline-script file)
  relay/                  the Vercel WebSocket function + in-memory room-state logic
  tests/                  the Playwright regression suite, restructured to run via `npm test`
  docs/
    facilitated-retro-spec.md   (today's squad-pulse-5df-retro-spec.md, carried over as history)
    standalone-plan.md          (this document)
  vercel.json
  package.json
  README.md
```

Concrete steps, in order:

1. **First commit brings in everything that already works and is already tested** — today's
   `squad-pulse.html` plus the 13-file Playwright suite — so the repo's history starts from "proven,"
   not from scratch.
2. **Split the single file** into `index.html` / `app.js` / `styles.css` for reviewability (optional,
   but worth it now that this is a maintained product rather than a scratchpad file — the app logic
   doesn't change, just where it lives).
3. **Extract the test harness properly.** Right now each test file hand-assembles a fake `db` by
   slicing a `<script>` block out of an old preview file — that works, but it's fragile outside this
   sandbox. Turn it into a real `tests/fixtures/fake-relay.js` (or, once the real relay exists, point
   the tests at a locally-running instance of it) so `npm test` is self-contained and CI-friendly.
4. **Build the relay** (`relay/`) as described above: WebSocket upgrade handler, in-memory room map,
   encrypt/decrypt is entirely client-side so the relay code itself never touches keys.
5. **Wire the client** to the real relay instead of the Claude Artifact `db` capability, and add the
   Save/Load-board file export-import that replaces the old always-on persistence.
6. **Push to GitHub.** I don't have your GitHub credentials in this sandbox, so this needs one of:
   an empty repo you create and hand me push access to, or a finished tarball/zip I hand back for you
   to push yourself. Worth deciding which now so step 1 lands in the right place.
7. **Connect the repo to Vercel** (import project; static frontend + the one WebSocket function both
   deploy from the same repo with no extra config).
8. **Wire up the embed** on the marketing site per whichever pattern you pick above.

## Open questions before I start building

- **GitHub access**: do you want to create the (empty) repo and add me as a collaborator, or would
  you rather I hand you a finished project to push yourself?
- **Marketing site stack**: what's dragile.com built on? That decides whether the same-site route or
  the subdomain/iframe pattern is the better fit.
- **Split vs. keep single-file**: any preference, or defer to my judgment (I'd split it now that this
  is a real product)?

Nothing above has been built — this is the plan for review. Once you're ready, the next message can
just say "go," and I'll start with step 1.
