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

  console.log("=== a fresh reader waiting on a write's ack, not a fixed sleep ===");
  // This is the actual bug this coverage exists for: relay-client.js's
  // doc().set() used to resolve as soon as the write was merely QUEUED,
  // not once the relay had actually applied it -- a fresh connection
  // opened right after could race the write and see a stale/empty
  // snapshot under real load (see test_relay_board_path_sync.py's own
  // history and STATUS.md). An ack the client waits on replaces the
  // guessed sleep with a real completion signal.
  var wss2 = startServer({ port: PORT + 1 });
  var e = await connect2("ACKROOM", PORT + 1);

  console.log("--- put: ack is sent only to the writer, and only after the room actually reflects the write ---");
  send(e, { op:"put", path:"ACKROOM", envelope:{ iv:"i1", ct:"c1" }, opId:"op-1" });
  var ack1 = await waitFor(e, function(m){ return m.op === "ack" && m.opId === "op-1"; });
  assert.strictEqual(ack1.forOp, "put");
  assert.strictEqual(ack1.path, "ACKROOM");
  assert.strictEqual(ack1.envelope, undefined, "an ack must never carry the envelope/plaintext");
  var roomAfterAck = rooms.get("ACKROOM");
  assert.strictEqual(roomAfterAck.docs.get("ACKROOM").ct, "c1", "the ack must not arrive before the room's own state reflects the write");
  console.log("OK");

  console.log("--- delete: gets its own ack, distinct forOp ---");
  send(e, { op:"delete", path:"ACKROOM", opId:"op-2" });
  var ack2 = await waitFor(e, function(m){ return m.op === "ack" && m.opId === "op-2"; });
  assert.strictEqual(ack2.forOp, "delete");
  assert.strictEqual(ack2.path, "ACKROOM");
  console.log("OK");

  console.log("--- an ack is never broadcast to OTHER clients in the room, only the writer ---");
  var f = await connect2("ACKROOM", PORT + 1);
  await waitFor(f, function(m){ return m.op === "snapshot"; });
  send(e, { op:"put", path:"ACKROOM/x", envelope:{ iv:"i2", ct:"c2" }, opId:"op-3" });
  await waitFor(e, function(m){ return m.op === "ack" && m.opId === "op-3"; });
  await waitFor(f, function(m){ return m.op === "put" && m.path === "ACKROOM/x"; }); // f still gets the normal broadcast
  assert.strictEqual(f.messages.some(function(m){ return m.op === "ack"; }), false, "a non-writer must never see an ack meant for someone else's write");
  console.log("OK");

  console.log("--- concurrent writes with different opIds resolve independently (correlation, not just ordering) ---");
  send(e, { op:"put", path:"ACKROOM/y1", envelope:{ iv:"i3", ct:"first" }, opId:"op-Y1" });
  send(e, { op:"put", path:"ACKROOM/y2", envelope:{ iv:"i4", ct:"second" }, opId:"op-Y2" });
  var ackY1 = await waitFor(e, function(m){ return m.op === "ack" && m.opId === "op-Y1"; });
  var ackY2 = await waitFor(e, function(m){ return m.op === "ack" && m.opId === "op-Y2"; });
  assert.strictEqual(ackY1.path, "ACKROOM/y1");
  assert.strictEqual(ackY2.path, "ACKROOM/y2");
  console.log("OK");

  console.log("--- a rejected write's error response carries the SAME opId, so the client can reject only that write ---");
  var hugeEnvelope = { iv:"i5", ct:"x".repeat(300000) }; // over MAX_ENVELOPE_BYTES
  send(e, { op:"put", path:"ACKROOM/toobig", envelope: hugeEnvelope, opId:"op-BAD" });
  var errBad = await waitFor(e, function(m){ return m.op === "error" && m.opId === "op-BAD"; });
  assert.ok(/large/i.test(errBad.message));
  assert.strictEqual(e.messages.some(function(m){ return m.op === "ack" && m.opId === "op-BAD"; }), false, "a rejected write must never also get an ack");
  console.log("OK");

  console.log("--- a write with no opId at all still works exactly as before (opId is optional) ---");
  send(e, { op:"put", path:"ACKROOM/no-id", envelope:{ iv:"i6", ct:"noid" } });
  await waitFor(f, function(m){ return m.op === "put" && m.path === "ACKROOM/no-id"; });
  assert.strictEqual(e.messages.some(function(m){ return m.op === "ack" && m.opId === undefined && m.path === "ACKROOM/no-id"; }), false, "no opId means no ack is expected or sent");
  console.log("OK");

  e.ws.close(); f.ws.close();
  wss2.close();
  console.log("=== ALL ACKNOWLEDGMENT TESTS PASSED ===");
  process.exit(0);
}

function connect2(code, port){
  return new Promise(function(resolve, reject){
    var ws = new WebSocket("ws://localhost:" + port + "?code=" + encodeURIComponent(code));
    var messages = [];
    ws.on("message", function(raw){ messages.push(JSON.parse(raw.toString())); });
    ws.on("open", function(){ resolve({ ws: ws, messages: messages }); });
    ws.on("error", reject);
  });
}

main().catch(function(err){ console.error("RELAY TEST FAILED:", err); process.exit(1); });
