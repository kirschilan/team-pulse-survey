# Squad Pulse relay

The one server this app has. It exists only to let a live retro session
sync across real devices — everything else (squads, dimensions, templates,
board config) stays in the facilitator's own browser via `localStorage`
(see `public/local-store.js` and `STATUS.md`'s locked-in decisions).

It is deliberately dumb: it stores and rebroadcasts small encrypted blobs
per session code, in memory, for as long as at least one device is
connected to that code. It never sees plaintext — see
`public/js/crypto.js` for what's actually inside a message, and
`docs/standalone-plan.md` for the honest writeup of what that
encryption does and doesn't protect against.

## Running it

```
cd relay
npm install
npm start          # listens on ws://localhost:8787 (set PORT to change it)
```

Then point the app at it — `public/index.html` already defaults
`window.SQUAD_PULSE_RELAY_URL` to `ws://localhost:8787`, so a local relay
plus `python3 -m http.server` in `public/` (or opening `index.html`
directly) is enough to test a real multi-device retro on one machine
(e.g. two browser windows).

## Deploying it

This is a plain Node process using the `ws` library — nothing Vercel- or
serverless-specific, and deliberately so (see "Why not a Vercel Function"
below). It'll run on any small host that can keep a Node process alive and
reachable over WebSocket. This repo ships a `render.yaml` blueprint at the
repo root for [Render](https://render.com) specifically, since Render's
free web-service tier needs nothing beyond a GitHub account to try:

1. Render dashboard → **New** → **Blueprint** → point it at this repo (or
   your fork). It reads `render.yaml` and creates a `squad-pulse-relay`
   web service rooted at `relay/`, running `npm install` then `npm start`.
2. Render assigns a public URL like `https://squad-pulse-relay-xxxx.onrender.com`
   — the relay's `PORT` env var is already read from `process.env.PORT`
   (`server.js`), which Render sets automatically, so nothing else to
   configure there. The WebSocket URL is the same host with `wss://`:
   `wss://squad-pulse-relay-xxxx.onrender.com`.
3. Point the static site at it — see "Wiring the deployed static site to
   this relay" below. Don't have a Render account or would rather use
   something else? Fly.io, Railway, a small VPS, or a container all work
   identically; `render.yaml` is just the one this repo makes closest to
   one-click.

Free tiers on hosts like this typically spin the process down after a
period of no traffic and take a few seconds to wake back up on the next
connection — fine here, since a room is meant to be ephemeral anyway and
`relay-client.js` already reconnects with backoff.

### Wiring the deployed static site to this relay

The static site (`public/`) needs to know the relay's URL at deploy time.
Rather than hand-editing `index.html` per environment, `vercel.json` runs
`scripts/generate-relay-config.js` as its build step, which writes
`public/relay-config.js` from a `SQUAD_PULSE_RELAY_URL` environment
variable — set it in your Vercel project's **Settings → Environment
Variables**, scoped to whichever environment(s) you want:

- **Preview** (or a specific branch) — point it at a relay you're testing
  with, so you can verify a real cross-device retro session on a preview
  URL *before* merging to `main`, without touching Production.
- **Production** — point it at your real, durably-running relay once
  you're happy.

If the variable isn't set for a given environment/deploy, the build step
is a safe no-op — `public/relay-config.js` stays the checked-in
placeholder, and `index.html`'s own protocol/hostname default applies
exactly as before (a local relay when the page itself is `file://` or
`localhost`, otherwise `null`/"unavailable" rather than a doomed
`localhost` guess). This means forking the repo and deploying straight to
Vercel with zero configuration still works — it just runs with retro
sessions correctly reporting themselves unavailable until you do set the
variable. See `tests/test_relay_config_injection.py` for this wiring
verified end to end (the generator script's output for both cases, and
that an injected value actually wins over `index.html`'s own default).

### Self-hosting on a LAN, with no cloud account at all

None of the above is required to run this for real. The relay is a
zero-dependency-beyond-`ws` Node process by design specifically so a fork
can run entirely offline, e.g. inside a company network whose security
policy won't allow a public cloud dependency:

```
cd relay && npm install && npm start      # relay, on this machine
cd ../public && python3 -m http.server    # static site, on this machine
```

Then set `window.SQUAD_PULSE_RELAY_URL = "ws://<this-machine's-LAN-IP>:8787"`
(a small inline `<script>` before `local-store.js` in `index.html`, same
mechanism as the Vercel path above, just hand-edited instead of
environment-variable-driven) so teammates on the same LAN can reach it by
IP. Nothing here ever needs to leave the network.

### Why not a Vercel Function

Vercel Functions gained native WebSocket support (public beta, 2026) and
`docs/standalone-plan.md` originally floated using it so the whole app —
relay included — ships from one Vercel project. Verified against Vercel's
own docs before committing to it: **a new WebSocket connection is not
guaranteed to reach the same Function instance as an existing one**, and
Vercel's own guidance for anything needing shared state across connections
(rooms, presence, pub/sub — exactly this relay's job) is to add an
external store like Redis. That's a real, ongoing dependency neither
audience for this repo wants: it complicates "fork this and run it on a
LAN with nothing else to set up" (now you need a Redis instance too, not
just Node), and it turns "no persistent database, ever" (see `STATUS.md`'s
locked decisions) into "small database, technically." A plain Node
process deployed anywhere that keeps one process alive avoids the
instance-pinning problem entirely — there's only ever one instance holding
the in-memory `Map` this design already relies on — at the cost of being a
second deployment target instead of one. That trade is the right one here.

## Wire protocol

One WebSocket connection per room, opened at `?code=<session code>`.

```
client -> server   {op:"put", path, envelope}     create/replace one doc
client -> server   {op:"delete", path}            remove one doc
server -> client   {op:"snapshot", docs}           sent once, right after
                                                    connecting: the room's
                                                    entire current state
server -> client   {op:"put", path, envelope}      another client's write
server -> client   {op:"delete", path}             another client's delete
server -> client   {op:"error", message}           malformed input
```

`path` mirrors the Firestore-shaped paths the rest of the app already uses
(`sessions/<code>` for the session doc itself, `sessions/<code>/responses/<id>`
for each teammate's answer) — the server treats it as an opaque string key,
never inspecting it beyond routing. `envelope` is always `{iv, ct}`
(base64), produced by `public/js/crypto.js`.

## Room lifecycle

A room is created on the first connection for a new code, and forgotten
`EMPTY_ROOM_TTL_MS` (2 minutes, in `server.js`) after the *last* connection
for that code closes — long enough to survive a normal page reload or a
brief network blip without losing the retro in progress, short enough that
nothing accumulates once everyone's actually gone. There is no persistence
beyond that: restart the process and every in-progress retro is gone,
by design.

## Testing

```
npm test
```

`test/relay.test.js` is a small dependency-free smoke test of the wire
protocol itself (storage, broadcast, late-joiner snapshot, room isolation,
the empty-room grace period) — no encryption involved, since that's
exercised client-side. The real end-to-end proof lives in
`tests/test_relay_cross_device_sync.py` at the repo root: it starts this
server as a subprocess and drives two independent Playwright browser
contexts through a full retro over a real WebSocket with real encryption.
