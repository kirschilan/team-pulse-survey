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
serverless-specific. It'll run on any small host that can keep a Node
process alive and reachable over WebSocket (Render, Fly.io, Railway, a
small VPS, a container, etc.). Deploy it, then set
`window.SQUAD_PULSE_RELAY_URL = "wss://your-relay-host"` before
`local-store.js` loads (e.g. a small inline `<script>` added at deploy
time, same as the one already in `index.html`).

`docs/standalone-plan.md` sketches deploying this as a Vercel Function
using their native WebSocket support instead, so the whole app ships from
one place — that's still a real option, just not one this session could
verify end-to-end (no Vercel account access here). The protocol below
doesn't care where it runs.

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
