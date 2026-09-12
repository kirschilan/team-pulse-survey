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
//   client -> server  {op:"put", path, envelope}     create/replace one doc
//   client -> server  {op:"delete", path}            remove one doc
//   server -> client  {op:"snapshot", docs}          sent once, right after
//                                                     connecting: the room's
//                                                     entire current state
//   server -> client  {op:"put", path, envelope}     another client's write
//   server -> client  {op:"delete", path}            another client's delete
//   server -> client  {op:"error", message}          malformed input
//
// A "path" is always shaped like a Firestore path relative to `sessions/`
// (e.g. the room for code ABC123 stores its own session doc at "ABC123",
// and each teammate's answer at "ABC123/responses/<id>") -- see
// public/js/relay-client.js for the client side of this contract, which
// presents the same collection()/doc() shape the rest of app.js already
// expects from `db`.
//
// Rooms are in-memory only and forgotten once empty (after a grace period
// that tolerates a normal reload/reconnect blip -- see EMPTY_ROOM_TTL_MS).
// There is no persistence, no auth, and no plaintext: this process holding
// no data at rest is the whole point.

const { WebSocketServer } = require("ws");
const { URL } = require("url");

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000; // survive a brief reload/reconnect
const MAX_CODE_LENGTH = 64;
const MAX_PATH_LENGTH = 300;
const MAX_ENVELOPE_BYTES = 200 * 1000; // one teammate's answer, generously bounded
const MAX_DOCS_PER_ROOM = 5000; // a session's dimensions + responses, with headroom
const MAX_ROOMS = 10000; // sanity cap so a bug/abuse can't grow this unbounded

/** @type {Map<string, { docs: Map<string, unknown>, clients: Set<import('ws').WebSocket>, emptyTimer: NodeJS.Timeout|null }>} */
const rooms = new Map();

function getOrCreateRoom(code){
  var room = rooms.get(code);
  if(room){
    if(room.emptyTimer){ clearTimeout(room.emptyTimer); room.emptyTimer = null; }
    return room;
  }
  if(rooms.size >= MAX_ROOMS) return null;
  room = { docs: new Map(), clients: new Set(), emptyTimer: null };
  rooms.set(code, room);
  return room;
}

function scheduleRoomCleanup(code, room){
  if(room.emptyTimer) clearTimeout(room.emptyTimer);
  room.emptyTimer = setTimeout(function(){
    var current = rooms.get(code);
    if(current && current.clients.size === 0) rooms.delete(code);
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

function startServer(){
  var wss = new WebSocketServer({ port: PORT });

  wss.on("connection", function(ws, req){
    var url;
    try{ url = new URL(req.url, "http://localhost"); }catch(e){ ws.close(1008, "bad request"); return; }
    var code = url.searchParams.get("code");
    if(!isValidCode(code)){ ws.close(1008, "missing or invalid code"); return; }

    var room = getOrCreateRoom(code);
    if(!room){ ws.close(1013, "relay is full"); return; }
    room.clients.add(ws);
    send(ws, { op: "snapshot", docs: snapshotOf(room) });

    ws.on("message", function(raw){
      var msg;
      try{ msg = JSON.parse(raw.toString()); }catch(e){ send(ws, { op:"error", message:"invalid JSON" }); return; }
      if(!msg || typeof msg.path !== "string" || msg.path.length === 0 || msg.path.length > MAX_PATH_LENGTH){
        send(ws, { op:"error", message:"invalid path" }); return;
      }
      if(msg.op === "put"){
        if(msg.envelope === undefined){ send(ws, { op:"error", message:"put needs an envelope" }); return; }
        if(Buffer.byteLength(JSON.stringify(msg.envelope)) > MAX_ENVELOPE_BYTES){
          send(ws, { op:"error", message:"envelope too large" }); return;
        }
        if(!room.docs.has(msg.path) && room.docs.size >= MAX_DOCS_PER_ROOM){
          send(ws, { op:"error", message:"room is full" }); return;
        }
        room.docs.set(msg.path, msg.envelope);
        broadcast(room, { op:"put", path: msg.path, envelope: msg.envelope });
      } else if(msg.op === "delete"){
        room.docs.delete(msg.path);
        broadcast(room, { op:"delete", path: msg.path });
      } else {
        send(ws, { op:"error", message:"unknown op" });
      }
    });

    ws.on("close", function(){
      room.clients.delete(ws);
      if(room.clients.size === 0) scheduleRoomCleanup(code, room);
    });

    ws.on("error", function(){ /* the close handler above still fires */ });
  });

  wss.on("listening", function(){
    console.log("Squad Pulse relay listening on ws://localhost:" + PORT);
  });

  return wss;
}

if(require.main === module){
  startServer();
}

module.exports = { startServer, rooms, EMPTY_ROOM_TTL_MS };
