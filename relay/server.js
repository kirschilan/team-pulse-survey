"use strict";

// Ephemeral WebSocket relay for Squad Pulse retro sessions -- the
// "Excalidraw model" piece described in docs/standalone-plan.md. One room
// per session code, holding only client-encrypted document blobs (this
// server never sees plaintext, and never needs to -- see
// public/js/crypto.js for what's actually inside an "envelope").
//
// Wire protocol (JSON messages over one WebSocket per room, room code given
// as `?code=` on the connection URL):
//
//   client -> server  {op:"put", path, envelope, opId?}   create/replace one doc
//   client -> server  {op:"delete", path, opId?}          remove one doc
//   server -> client  {op:"snapshot", docs}          sent once, right after
//                                                     connecting: the room's
//                                                     entire current state
//   server -> client  {op:"put", path, envelope}     another client's write
//   server -> client  {op:"delete", path}            another client's delete
//   server -> client  {op:"ack", opId, forOp, path}  sent ONLY to the
//                                                     originating connection,
//                                                     once an accepted put/
//                                                     delete has actually
//                                                     updated the room and
//                                                     persistence has been
//                                                     initiated -- never
//                                                     carries the envelope.
//                                                     Only sent when the
//                                                     client's own message
//                                                     included an opId.
//   server -> client  {op:"error", opId?, message}   malformed or rejected
//                                                     input; opId is echoed
//                                                     back when the client's
//                                                     message had one, so a
//                                                     rejected write can be
//                                                     correlated and only
//                                                     that write's promise
//                                                     rejected (see
//                                                     relay-client.js)
//
// `opId` is a client-chosen, opaque correlation token -- the server never
// interprets it, just echoes it back on the ack/error for whichever message
// carried it. It's optional so a message with none behaves exactly as
// before (no ack, error with no opId) -- see relay/test/relay.test.js's
// "no opId at all" case.
//
// A "path" is always shaped like a Firestore path relative to `sessions/`
// (e.g. the room for code ABC123 stores its own session doc at "ABC123",
// and each teammate's answer at "ABC123/responses/<id>") -- see
// public/js/relay-client.js for the client side of this contract, which
// presents the same collection()/doc() shape the rest of app.js already
// expects from `db`.
//
// Rooms live in memory (the `rooms` Map below) and are forgotten once
// empty (after a grace period that tolerates a normal reload/reconnect
// blip -- see EMPTY_ROOM_TTL_MS). There is no auth and no plaintext --
// this process never holding readable data is the whole point, unchanged.
//
// Whether a room's docs also survive a process RESTART is a separate
// question, answered by a pluggable storage adapter (see storage/index.js)
// -- the default keeps today's exact behavior (nothing survives a
// restart); opting into RELAY_STORAGE=file persists each room's encrypted
// blobs to local disk so a redeploy or crash doesn't lose an in-progress
// session. Either way the adapter only ever sees the same opaque
// {path: envelope} shape this file already broadcasts -- still no
// plaintext, at rest or in flight.
//
// SEC-1 (STATUS.md's "Security hardening backlog"): before this, the only
// abuse bounds were total counts (MAX_ROOMS/MAX_DOCS_PER_ROOM) and a
// per-envelope size check made AFTER JSON.parse -- no rate limiting of any
// kind, no cap on how many clients could pile into one room, and no cap on
// how many connections one address could hold open. A single abusive
// source could still exhaust room/connection capacity for everyone else,
// or force the process to repeatedly parse huge JSON payloads. Five
// independent, DEFAULT_LIMITS-configurable bounds now apply, each a
// throttle a client recovers from (a fresh connection gets a fresh budget)
// rather than a ban:
//   - maxMessageBytes: a transport-level ceiling (ws's own `maxPayload`)
//     that rejects an oversized frame BEFORE it's ever handed to this
//     file's own JSON.parse, not just after.
//   - maxClientsPerRoom: caps how many simultaneous connections one room
//     can hold.
//   - maxConnectionsPerIp / maxNewConnectionsPerWindow: a concurrent cap
//     and a rate cap on connections, respectively -- deliberately
//     generous defaults so a shared office/NAT sharing one public address
//     is never mistaken for a single abusive source. IP is read from the
//     raw socket by default (req.socket.remoteAddress); trusting a
//     proxy-supplied header instead (X-Forwarded-For or similar) is a
//     DEPLOYMENT decision this file deliberately does not make on its own
//     -- see startServer()'s `opts.trustProxyHeader`.
//   - maxNewRoomsPerWindow: a rate cap specifically on CREATING a room,
//     distinct from maxClientsPerRoom/MAX_ROOMS's total-count caps --
//     re-joining an already-existing room is never throttled by this,
//     whatever the current window looks like.
//   - maxMessagesPerWindow: a per-CONNECTION write-rate cap, generous
//     enough that a real multi-doc UI burst (e.g. a full-board JSON
//     import, or loading a many-dimension starter template) never trips
//     it in normal use.
// None of this replaces hosting-layer protections (a reverse proxy/CDN's
// own connection limits, DDoS mitigation, TLS termination) -- see
// STATUS.md's own note that CORS/Origin checks are not authentication
// either; this is the application-level floor underneath whatever the
// deployment layer also provides, not a substitute for it.

const { WebSocketServer } = require("ws");
const { URL } = require("url");
const { createStorage } = require("./storage/index.js");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000; // survive a brief reload/reconnect
const MAX_CODE_LENGTH = 64;
const MAX_PATH_LENGTH = 300;
const MAX_ENVELOPE_BYTES = 200 * 1000; // one teammate's answer, generously bounded
const MAX_DOCS_PER_ROOM = 5000; // a session's dimensions + responses, with headroom
const MAX_ROOMS = 10000; // sanity cap so a bug/abuse can't grow this unbounded

// SEC-1: production defaults for the abuse bounds described in the header
// comment above -- see startServer()'s `opts.limits` for how a caller
// (tests, or a deployment wanting different numbers) overrides any of
// these without touching this file.
const DEFAULT_LIMITS = {
  // Deliberately MUCH larger than MAX_ENVELOPE_BYTES (200,000), not just a
  // bit over it -- an envelope that exceeds MAX_ENVELOPE_BYTES already gets
  // a graceful, opId-correlated {op:"error"} response from the application-
  // level check below (relay.test.js's own "a rejected write's error
  // response carries the SAME opId" case exercises exactly this, with a
  // 300,000-byte envelope). This transport-level ceiling is a backstop
  // against genuinely extreme payloads that shouldn't even be buffered/
  // parsed at all (ws's own `maxPayload`, enforced before the "message"
  // event fires, so this file's JSON.parse never runs on one) -- setting
  // it too close to MAX_ENVELOPE_BYTES would make ws terminate the
  // connection outright for an ordinary "too big" envelope, before the
  // friendly error response ever gets a chance to send.
  maxMessageBytes: 2 * 1000 * 1000,
  maxClientsPerRoom: 100, // generous headroom over any real retro/team-board's participant count
  maxConnectionsPerIp: 40, // generous for a shared office/NAT, still bounds a single-source flood
  connectionRateWindowMs: 1000,
  maxNewConnectionsPerWindow: 20, // global, across all addresses
  roomCreationRateWindowMs: 1000,
  maxNewRoomsPerWindow: 10, // global; existing rooms are never subject to this
  messageRateWindowMs: 2000,
  maxMessagesPerWindow: 60 // per connection
};

// A simple fixed-window rate limiter -- cheap (one timestamp + one integer,
// no per-hit array to prune) and precise enough for an abuse bound: a real
// flood blows through any window's budget many times over, and the
// fixed-window's one known imprecision (a burst that straddles a window
// boundary can briefly allow close to 2x the nominal rate) doesn't matter
// at the scale these bounds operate on. exceeded() both records the hit
// AND answers whether this one should be refused, so every call site does
// exactly one thing: refuse when true.
function makeWindowLimiter(windowMs, max){
  var windowStart = Date.now();
  var count = 0;
  return {
    exceeded: function(){
      var now = Date.now();
      if(now - windowStart >= windowMs){ windowStart = now; count = 0; }
      count += 1;
      return count > max;
    }
  };
}

/** @type {Map<string, { docs: Map<string, unknown>, clients: Set<import('ws').WebSocket>, emptyTimer: NodeJS.Timeout|null }>} */
const rooms = new Map();

// One storage adapter for the whole process, same lifetime as `rooms` --
// see storage/index.js. startServer() may override this (tests do, to
// inject a FileAdapter pointed at a temp dir, or a fake to prove server.js
// calls the contract correctly without touching real disk).
var storage = createStorage();

// A brand-new code's very first connection has to await storage.load()
// before a room exists to hand back -- this dedupes concurrent connections
// racing to create the SAME new room (two tabs opening a fresh session at
// once) onto one shared load, instead of one silently clobbering the
// other's freshly-created room.
const roomCreationPromises = new Map();

function getOrCreateRoom(code, roomCreationLimiter){
  var room = rooms.get(code);
  if(room){
    if(room.emptyTimer){ clearTimeout(room.emptyTimer); room.emptyTimer = null; }
    return Promise.resolve(room);
  }
  if(rooms.size >= MAX_ROOMS) return Promise.resolve(null);
  var pending = roomCreationPromises.get(code);
  if(pending) return pending;
  // SEC-1: a room-CREATION rate limit, distinct from MAX_ROOMS's total-count
  // cap above -- counted only here, once per genuinely NEW code (never for
  // a room that already exists, and never twice for several connections
  // racing to open the SAME new code -- both of those return earlier,
  // before this point). Re-joining an existing room is never subject to
  // this, whatever the current window looks like.
  if(roomCreationLimiter && roomCreationLimiter.exceeded()) return Promise.resolve(null);

  var promise = storage.load(code).then(function(savedDocs){
    roomCreationPromises.delete(code);
    var existing = rooms.get(code); // another connection created it while we awaited the load
    if(existing) return existing;
    var docs = new Map();
    if(savedDocs){ Object.keys(savedDocs).forEach(function(p){ docs.set(p, savedDocs[p]); }); }
    var newRoom = { docs: docs, clients: new Set(), emptyTimer: null };
    rooms.set(code, newRoom);
    return newRoom;
  }).catch(function(err){
    roomCreationPromises.delete(code);
    console.error("relay: failed to load persisted room " + code + ":", err);
    var newRoom = { docs: new Map(), clients: new Set(), emptyTimer: null };
    rooms.set(code, newRoom);
    return newRoom;
  });
  roomCreationPromises.set(code, promise);
  return promise;
}

function persistRoom(code, room){
  storage.save(code, snapshotOf(room)).catch(function(err){
    console.error("relay: failed to persist room " + code + ":", err);
  });
}

function scheduleRoomCleanup(code, room){
  if(room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(function(){
    var current = rooms.get(code);
    if(current && current.clients.size === 0){
      rooms.delete(code);
      storage.remove(code).catch(function(err){
        console.error("relay: failed to remove persisted room " + code + ":", err);
      });
    }
  }, EMPTY_ROOM_TTL_MS);
  if(typeof room.emptyTimer.unref === "function") room.emptyTimer.unref();
}

function send(ws, msg){
  if(ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptWs){
  var data = JSON.stringify(msg);
  room.clients.forEach(function(client){
    if(client !== exceptWs && client.readyState === client.OPEN) client.send(data);
  });
}

function isValidCode(code){
  return typeof code === "string" && code.length > 0 && code.length <= MAX_CODE_LENGTH;
}

function snapshotOf(room){
  var docs = {};
  room.docs.forEach(function(envelope, path){ docs[path] = envelope; });
  return docs;
}

// SEC-1: resolves the address a connection is rate-limited/capped by.
// Defaults to the raw socket address -- trusting a proxy-supplied header
// instead is opt-in ONLY (`opts.trustProxyHeader`, e.g. "x-forwarded-for"),
// since a client can set any header it likes on its own request; trusting
// one by default would let a client simply claim a fresh IP on every
// connection and bypass the cap entirely. Only turn it on for a deployment
// that actually sits behind a proxy verified to set that header itself.
function clientAddressFor(req, trustProxyHeader){
  if(trustProxyHeader){
    var header = req.headers[trustProxyHeader.toLowerCase()];
    if(header) return String(header).split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function startServer(opts){
  opts = opts || {};
  if(opts.storage) storage = opts.storage;
  var limits = Object.assign({}, DEFAULT_LIMITS, opts.limits || {});

  // Every counter/cap below is scoped to THIS startServer() call, not the
  // module -- two relay instances (as tests spin up on different ports)
  // must never share a rate budget, and a real deployment only ever calls
  // this once anyway.
  var connectionRateLimiter = makeWindowLimiter(limits.connectionRateWindowMs, limits.maxNewConnectionsPerWindow);
  var roomCreationLimiter = makeWindowLimiter(limits.roomCreationRateWindowMs, limits.maxNewRoomsPerWindow);
  var connectionsByAddress = new Map(); // address -> count of currently OPEN connections

  var wss = new WebSocketServer({ port: opts.port || PORT, maxPayload: limits.maxMessageBytes });

  wss.on("connection", function(ws, req){
    var url;
    try{ url = new URL(req.url, "http://localhost"); }catch(e){ ws.close(1008, "bad request"); return; }
    var code = url.searchParams.get("code");
    if(!isValidCode(code)){ ws.close(1008, "missing or invalid code"); return; }

    if(connectionRateLimiter.exceeded()){ ws.close(1013, "relay is busy, try again shortly"); return; }

    var address = clientAddressFor(req, opts.trustProxyHeader);
    var addressCount = connectionsByAddress.get(address) || 0;
    if(addressCount >= limits.maxConnectionsPerIp){
      ws.close(1013, "too many connections from this address"); return;
    }
    connectionsByAddress.set(address, addressCount + 1);
    var addressCounted = true;
    function releaseAddress(){
      if(!addressCounted) return;
      addressCounted = false;
      var current = connectionsByAddress.get(address) || 1;
      if(current <= 1) connectionsByAddress.delete(address);
      else connectionsByAddress.set(address, current - 1);
    }

    getOrCreateRoom(code, roomCreationLimiter).then(function(room){
      if(!room){ releaseAddress(); ws.close(1013, "relay is full"); return; }
      if(ws.readyState !== ws.OPEN){ releaseAddress(); return; } // client gave up while the room was loading
      if(room.clients.size >= limits.maxClientsPerRoom){ releaseAddress(); ws.close(1013, "room is full"); return; }
      room.clients.add(ws);
      send(ws, { op: "snapshot", docs: snapshotOf(room) });

      var messageRateLimiter = makeWindowLimiter(limits.messageRateWindowMs, limits.maxMessagesPerWindow);

      ws.on("message", function(raw){
        if(messageRateLimiter.exceeded()){
          send(ws, { op:"error", message:"rate limit exceeded" });
          ws.close(1013, "rate limit exceeded");
          return;
        }
        var msg;
        try{ msg = JSON.parse(raw.toString()); }catch(e){ send(ws, { op:"error", message:"invalid JSON" }); return; }
        var opId = msg && msg.opId; // undefined is fine -- see the opId comment above
        if(!msg || typeof msg.path !== "string" || msg.path.length === 0 || msg.path.length > MAX_PATH_LENGTH){
          send(ws, { op:"error", opId: opId, message:"invalid path" }); return;
        }
        if(msg.op === "put"){
          if(msg.envelope === undefined){ send(ws, { op:"error", opId: opId, message:"put needs an envelope" }); return; }
          if(Buffer.byteLength(JSON.stringify(msg.envelope)) > MAX_ENVELOPE_BYTES){
            send(ws, { op:"error", opId: opId, message:"envelope too large" }); return;
          }
          if(!room.docs.has(msg.path) && room.docs.size >= MAX_DOCS_PER_ROOM){
            send(ws, { op:"error", opId: opId, message:"room is full" }); return;
          }
          room.docs.set(msg.path, msg.envelope);
          broadcast(room, { op:"put", path: msg.path, envelope: msg.envelope });
          persistRoom(code, room);
          if(opId !== undefined) send(ws, { op:"ack", opId: opId, forOp:"put", path: msg.path });
        } else if(msg.op === "delete"){
          room.docs.delete(msg.path);
          broadcast(room, { op:"delete", path: msg.path });
          persistRoom(code, room);
          if(opId !== undefined) send(ws, { op:"ack", opId: opId, forOp:"delete", path: msg.path });
        } else {
          send(ws, { op:"error", opId: opId, message:"unknown op" });
        }
      });

      ws.on("close", function(){
        releaseAddress();
        room.clients.delete(ws);
        if(room.clients.size === 0) scheduleRoomCleanup(code, room);
      });
    }).catch(function(err){
      releaseAddress();
      console.error("relay: failed to open room " + code + ":", err);
      ws.close(1011, "internal error");
    });

    ws.on("error", function(){ /* the close/catch handlers above still fire */ });
  });

  wss.on("listening", function(){
    console.log("Squad Pulse relay listening on ws://localhost:" + (opts.port || PORT) + " (storage: " + (process.env.RELAY_STORAGE || "none") + ")");
  });

  return wss;
}

if(require.main === module){
  startServer();
}

module.exports = { startServer, rooms, EMPTY_ROOM_TTL_MS };
