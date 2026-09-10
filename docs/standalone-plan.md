# Squad Pulse: standalone, embeddable version — proposal

**Goal, as stated:** move Squad Pulse out of the Claude Artifact sandbox into a real git-tracked
codebase deployed on Vercel, in the Excalidraw model (facilitator's browser is authoritative, no
multi-tenant database, share a link, save/reload to a file), so it can be embedded on the Dr. Agile
website as a self-serve offering for visitors.

This is a proposal only — nothing described here has been built yet. It lays out the architecture,
the repo/migration plan, and the open questions to settle before writing any code.

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

**Reconnection** works the same way it does today, just server-held instead of client-held: a
participant who refreshes, or joins a few minutes late, asks the relay for the room's current
ciphertext blob and picks up from there — the same recovery Excalidraw gets from Firebase, just
scoped to one sitting instead of forever, and without needing a database to get it.

## Where this runs

- **Relay**: one small Vercel Function using their native WebSocket support (public beta, requires
  Fluid compute, which is on by default for new projects) — plain Node with the `ws` library, room
  state kept in an in-memory `Map` keyed by session code. Vercel's own guidance is to reach for
  external state (Redis/KV) only when you need to coordinate connections *across multiple function
  instances*; at the traffic a consultancy's website demo will see, one instance comfortably holds
  every concurrently active room, so there's no database to run or pay for here at all. If usage ever
  outgrows that, Vercel KV is the one thing to add later — not a redesign.
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
