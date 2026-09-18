"use strict";

// SEC-1 (STATUS.md's "Security hardening backlog"): the relay had no
// application-level abuse bounds beyond total room/doc counts and a
// per-envelope size check made AFTER JSON.parse -- no per-connection
// message-rate limit, no per-room concurrent-client cap, no per-IP
// concurrent-connection cap, no room-CREATION rate limit (distinct from
// MAX_ROOMS's total-count cap), and no transport-level payload ceiling
// before JSON parsing at all. This file proves each of those bounds is
// real, that a client that HITS one can still recover (a fresh connection
// gets a fresh budget -- these are throttles, not bans), and that normal
// multi-write/multi-client usage under the bound is completely unaffected.
//
// Uses `opts.limits` (small, fast-triggering values) rather than the
// production defaults, the same way other relay tests use `opts.port`/
// `opts.storage` -- see server.js's own startServer() for the shape.

const assert = require("assert");
const WebSocket = require("ws");
const { startServer } = require("../server.js");

var nextPort = 8850;

function connect(code, port, opts){
  return new Promise(function(resolve, reject){
    var ws = new WebSocket("ws://localhost:" + port + "?code=" + encodeURIComponent(code), opts);
    var messages = [];
    var closeInfo = null;
    ws.on("message", function(raw){ messages.push(JSON.parse(raw.toString())); });
    ws.on("close", function(code, reason){ closeInfo = { code: code, reason: String(reason||"") }; });
    ws.on("open", function(){ resolve({ ws: ws, messages: messages, get closeInfo(){ return closeInfo; } }); });
    ws.on("error", function(err){
      // A connection the server rejects can error before "open" ever fires
      // (e.g. an oversized first frame under some `ws` versions) -- still
      // resolve so the caller can inspect what happened, rather than
      // rejecting and losing that information.
      resolve({ ws: ws, messages: messages, get closeInfo(){ return closeInfo; }, openError: err });
    });
  });
}

function waitForClose(client, timeoutMs){
  timeoutMs = timeoutMs || 2000;
  return new Promise(function(resolve, reject){
    if(client.closeInfo) return resolve(client.closeInfo);
    var start = Date.now();
    (function check(){
      if(client.closeInfo) return resolve(client.closeInfo);
      if(Date.now() - start > timeoutMs) return reject(new Error("timed out waiting for close"));
      setTimeout(check, 20);
    })();
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

function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
function send(client, msg){ client.ws.send(JSON.stringify(msg)); }

async function main(){
  console.log("=== transport payload ceiling rejects an oversized frame before JSON parsing ===");
  {
    let port = nextPort++;
    let wss = startServer({ port: port, limits: { maxMessageBytes: 500 } });
    let a = await connect("BIGMSG", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });
    // A single frame well over the 500-byte ceiling -- ws's own maxPayload
    // terminates the connection at the transport level; the server's
    // "message" handler (and its JSON.parse) never even runs.
    let hugeEnvelope = { iv: "x", ct: "y".repeat(2000) };
    a.ws.send(JSON.stringify({ op: "put", path: "BIGMSG", envelope: hugeEnvelope }));
    let close = await waitForClose(a);
    console.log("oversized frame closed the connection:", close);
    assert.ok(close.code !== 1000, "an oversized frame must not close normally, as if nothing happened");
    wss.close();
  }
  console.log("OK");

  console.log("=== per-room concurrent-client cap: a full room rejects a new joiner, a DIFFERENT room is unaffected ===");
  {
    let port = nextPort++;
    let wss = startServer({ port: port, limits: { maxClientsPerRoom: 2 } });
    let a = await connect("FULLROOM", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });
    let b = await connect("FULLROOM", port);
    await waitFor(b, function(m){ return m.op === "snapshot"; });
    let c = await connect("FULLROOM", port);
    let cClose = await waitForClose(c);
    console.log("third client into a 2-client-capped room:", cClose);
    assert.strictEqual(cClose.code, 1013);

    let d = await connect("OTHERROOM", port);
    let dSnap = await waitFor(d, function(m){ return m.op === "snapshot"; });
    console.log("a different room still accepts a new client normally:", !!dSnap);
    assert.ok(dSnap);

    a.ws.close(); b.ws.close(); d.ws.close();
    wss.close();
  }
  console.log("OK");

  console.log("=== per-connection message-rate cap, with recovery on a fresh connection ===");
  {
    let port = nextPort++;
    let wss = startServer({ port: port, limits: { maxMessagesPerWindow: 3, messageRateWindowMs: 400 } });
    let a = await connect("RATEROOM", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });

    send(a, { op: "put", path: "RATEROOM/d1", envelope: { iv: "i", ct: "1" }, opId: "op1" });
    send(a, { op: "put", path: "RATEROOM/d2", envelope: { iv: "i", ct: "2" }, opId: "op2" });
    send(a, { op: "put", path: "RATEROOM/d3", envelope: { iv: "i", ct: "3" }, opId: "op3" });
    await waitFor(a, function(m){ return m.op === "ack" && m.opId === "op3"; });
    console.log("3 writes within the window all acked normally");

    // The 4th write in the SAME window must be refused, not silently queued.
    send(a, { op: "put", path: "RATEROOM/d4", envelope: { iv: "i", ct: "4" }, opId: "op4" });
    let rateErr = await waitFor(a, function(m){ return m.op === "error"; });
    console.log("4th write in the same window:", rateErr);
    let aClose = await waitForClose(a);
    console.log("connection closed after the violation:", aClose);
    assert.strictEqual(aClose.code, 1013);

    // Recovery: a genuinely NEW connection gets its own fresh budget, not
    // inheriting the closed connection's exhausted one.
    let b = await connect("RATEROOM", port);
    await waitFor(b, function(m){ return m.op === "snapshot"; });
    send(b, { op: "put", path: "RATEROOM/d5", envelope: { iv: "i", ct: "5" }, opId: "op5" });
    let ack5 = await waitFor(b, function(m){ return m.op === "ack" && m.opId === "op5"; });
    console.log("a fresh connection can write immediately:", ack5.forOp);
    assert.strictEqual(ack5.forOp, "put");

    b.ws.close();
    wss.close();
  }
  console.log("OK");

  console.log("=== room-creation rate cap: throttles NEW rooms, never blocks joining an EXISTING one ===");
  {
    let port = nextPort++;
    let wss = startServer({ port: port, limits: { maxNewRoomsPerWindow: 2, roomCreationRateWindowMs: 500 } });
    let a = await connect("NEWROOM1", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });
    let b = await connect("NEWROOM2", port);
    await waitFor(b, function(m){ return m.op === "snapshot"; });

    // A THIRD brand-new code, still inside the same window, must be refused.
    let c = await connect("NEWROOM3", port);
    let cClose = await waitForClose(c);
    console.log("3rd brand-new room within the rate window:", cClose);
    assert.strictEqual(cClose.code, 1013);

    // But re-joining an ALREADY-created room is not a "creation" at all --
    // must succeed even while the creation window is still exhausted.
    let a2 = await connect("NEWROOM1", port);
    let a2Snap = await waitFor(a2, function(m){ return m.op === "snapshot"; });
    console.log("re-joining an existing room during the same window still works:", !!a2Snap);
    assert.ok(a2Snap);

    a.ws.close(); b.ws.close(); a2.ws.close();
    wss.close();
  }
  console.log("OK");

  console.log("=== per-IP concurrent-connection cap, with recovery once a slot frees up ===");
  {
    let port = nextPort++;
    // Real test connections here all come from the same loopback address,
    // which is exactly the code path this cap exercises -- no simulation
    // needed. maxConnectionsPerIp counts CONCURRENT connections, not a
    // rate, so a generous connection-rate limit is set here to isolate it
    // from the separate global-rate test below.
    let wss = startServer({ port: port, limits: { maxConnectionsPerIp: 2, maxNewConnectionsPerWindow: 1000 } });
    let a = await connect("IPROOM1", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });
    let b = await connect("IPROOM2", port);
    await waitFor(b, function(m){ return m.op === "snapshot"; });

    let c = await connect("IPROOM3", port);
    let cClose = await waitForClose(c);
    console.log("3rd concurrent connection from the same address:", cClose);
    assert.strictEqual(cClose.code, 1013);

    // Recovery: closing one frees a slot for a genuinely new connection.
    a.ws.close();
    await sleep(100);
    let d = await connect("IPROOM4", port);
    let dSnap = await waitFor(d, function(m){ return m.op === "snapshot"; });
    console.log("a new connection succeeds once a slot frees up:", !!dSnap);
    assert.ok(dSnap);

    b.ws.close(); d.ws.close();
    wss.close();
  }
  console.log("OK");

  console.log("=== global new-connection rate cap, with recovery once the window passes ===");
  {
    let port = nextPort++;
    let wss = startServer({ port: port, limits: { maxNewConnectionsPerWindow: 3, connectionRateWindowMs: 400, maxConnectionsPerIp: 1000 } });
    let a = await connect("RATEC1", port);
    await waitFor(a, function(m){ return m.op === "snapshot"; });
    let b = await connect("RATEC2", port);
    await waitFor(b, function(m){ return m.op === "snapshot"; });
    let c = await connect("RATEC3", port);
    await waitFor(c, function(m){ return m.op === "snapshot"; });

    let d = await connect("RATEC4", port);
    let dClose = await waitForClose(d);
    console.log("4th new connection within the rate window:", dClose);
    assert.strictEqual(dClose.code, 1013);

    // Recovery: once the window passes, new connections succeed again.
    await sleep(450);
    let e = await connect("RATEC5", port);
    let eSnap = await waitFor(e, function(m){ return m.op === "snapshot"; });
    console.log("a new connection after the window passes:", !!eSnap);
    assert.ok(eSnap);

    a.ws.close(); b.ws.close(); c.ws.close(); e.ws.close();
    wss.close();
  }
  console.log("OK");

  console.log("=== ALL RATE-LIMIT TESTS PASSED ===");
  process.exit(0);
}

main().catch(function(err){ console.error("RATE-LIMIT TEST FAILED:", err); process.exit(1); });
