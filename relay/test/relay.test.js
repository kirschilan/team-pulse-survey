"use strict";

// Minimal, dependency-free smoke test for the relay's wire protocol --
// no encryption involved here (that's tested client-side); this only
// checks that the server stores/broadcasts/snapshots/cleans up correctly.

const PORT = 8799;
process.env.PORT = String(PORT);

const assert = require("assert");
const WebSocket = require("ws");
const { startServer, rooms, EMPTY_ROOM_TTL_MS } = require("../server.js");

function connect(code){
  return new Promise(function(resolve, reject){
    var ws = new WebSocket("ws://localhost:" + PORT + "?code=" + encodeURIComponent(code));
    var messages = [];
    ws.on("message", function(raw){ messages.push(JSON.parse(raw.toString())); });
    ws.on("open", function(){ resolve({ ws: ws, messages: messages }); });
    ws.on("error", reject);
  });
}

function waitFor(client, predicate, timeoutMs){
  timeoutMs = timeoutMs || 2000;
  return new Promise(function(resolve, reject){
    var start = Date.now();
    (function check(){
      var found = client.messages.find(predicate);
      if(found) return resolve(found);
      if(Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for message"));
      setTimeout(check, 20);
    })();
  });
}

function send(client, msg){ client.ws.send(JSON.stringify(msg)); }

async function main(){
  var wss = startServer();

  console.log("=== two clients in the same room see each other's writes ===");
  var a = await connect("ROOMAAA");
  var snapA = await waitFor(a, function(m){ return m.op === "snapshot"; });
  assert.deepStrictEqual(snapA.docs, {}, "a fresh room's snapshot should be empty");

  var b = await connect("ROOMAAA");
  var snapB = await waitFor(b, function(m){ return m.op === "snapshot"; });
  assert.deepStrictEqual(snapB.docs, {}, "b joins the same still-empty room");

  send(a, { op:"put", path:"ROOMAAA", envelope:{ iv:"x", ct:"encrypted-session-doc" } });
  var putOnB = await waitFor(b, function(m){ return m.op === "put" && m.path === "ROOMAAA"; });
  assert.strictEqual(putOnB.envelope.ct, "encrypted-session-doc", "b should see a's write");

  send(b, { op:"put", path:"ROOMAAA/responses/r1", envelope:{ iv:"y", ct:"encrypted-response" } });
  var putOnA = await waitFor(a, function(m){ return m.op === "put" && m.path === "ROOMAAA/responses/r1"; });
  assert.strictEqual(putOnA.envelope.ct, "encrypted-response", "a should see b's response");
  console.log("OK");

  console.log("=== a late joiner gets the room's current full state, not just future changes ===");
  var c = await connect("ROOMAAA");
  var snapC = await waitFor(c, function(m){ return m.op === "snapshot"; });
  assert.strictEqual(Object.keys(snapC.docs).length, 2, "late joiner should see both existing docs");
  assert.strictEqual(snapC.docs["ROOMAAA"].ct, "encrypted-session-doc");
  assert.strictEqual(snapC.docs["ROOMAAA/responses/r1"].ct, "encrypted-response");
  console.log("OK");

  console.log("=== delete propagates, and rooms stay isolated from each other ===");
  var d = await connect("ROOMBBB");
  await waitFor(d, function(m){ return m.op === "snapshot"; });
  send(a, { op:"delete", path:"ROOMAAA/responses/r1" });
  await waitFor(b, function(m){ return m.op === "delete" && m.path === "ROOMAAA/responses/r1"; });
  assert.strictEqual(d.messages.some(function(m){ return m.path && m.path.indexOf("ROOMAAA") !== -1; }), false,
    "ROOMBBB's client should never see ROOMAAA's traffic");
  console.log("OK");

  console.log("=== a room is forgotten only after everyone leaves AND the grace period passes ===");
  assert.ok(rooms.has("ROOMBBB"), "room should exist while d is connected");
  d.ws.close();
  await new Promise(function(r){ setTimeout(r, 50); });
  assert.ok(rooms.has("ROOMBBB"), "room must survive the empty grace period, not vanish instantly");
  // don't wait out the real 2-minute TTL in a test -- just confirm the timer was armed
  var room = rooms.get("ROOMBBB");
  assert.ok(room.emptyTimer, "an empty-room cleanup timer should be armed");
  console.log("OK (grace period is " + (EMPTY_ROOM_TTL_MS/1000) + "s, not re-timed here)");

  a.ws.close(); b.ws.close(); c.ws.close();
  wss.close();
  console.log("=== ALL RELAY TESTS PASSED ===");
  process.exit(0);
}

main().catch(function(err){ console.error("RELAY TEST FAILED:", err); process.exit(1); });
