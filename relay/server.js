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

function getOrCreateRoom(code){
  var room = rooms.get(code);
  if(room){
    if(room.emptyTimer){ clearTimeout(room.emptyTimer); room.emptyTimer = null; }
    return Promise.resolve(room);
  }
  if(rooms.size >= MAX_ROOMS) return Promise.resolve(null);
  var pending = roomCreationPromises.get(code);
  if(pending) return pending;

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

function startServer(opts){
  opts = opts || {};
  if(opts.storage) storage = opts.storage;

  var wss = new WebSocketServer({ port: opts.port || PORT });

  wss.on("connection", function(ws, req){
    var url;
    try{ url = new URL(req.url, "http://localhost"); }catch(e){ ws.close(1008, "bad request"); return; }
    var code = url.searchParams.get("code");
    if(!isValidCode(code)){ ws.close(1008, "missing or invalid code"); return; }

    getOrCreateRoom(code).then(function(room){
      if(!room){ ws.close(1013, "relay is full"); return; }
      if(ws.readyState !== ws.OPEN) return; // client gave up while the room was loading
      room.clients.add(ws);
      send(ws, { op: "snapshot", docs: snapshotOf(room) });

      ws.on("message", function(raw){
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
        room.clients.delete(ws);
        if(room.clients.size === 0) scheduleRoomCleanup(code, room);
      });
    }).catch(function(err){
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
