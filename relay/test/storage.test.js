"use strict";

// Tests for the storage adapter layer itself (relay/storage/*.js), plus
// server.js's use of it end to end -- a relay that "restarts" (a fresh
// startServer() sharing the same adapter instance, standing in for a real
// process restart against the same disk/RELAY_DATA_DIR) should hand a
// reconnecting client back its room's prior state when a real adapter
// (FileAdapter) is in play, and should NOT when the default (NoneAdapter)
// is in play -- that's the one behavior difference the whole adapter
// exists to add, opt-in only.

const PORT = 8798;

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const SERVER_PATH = require.resolve("../server.js");
const { NoneAdapter, FileAdapter, createStorage } = require("../storage/index.js");
const { filenameFor } = require("../storage/file-adapter.js");

// server.js keeps its `rooms` Map at module scope (by design -- see its own
// comments), so calling startServer() twice in the SAME process reuses the
// same in-memory rooms and would make every "restart" test pass whether or
// not the adapter actually persists anything. Forcing a fresh require
// (clearing the module from Node's cache first) is what makes each
// freshServer() call below a genuine stand-in for a real process restart.
function freshServer(){
  delete require.cache[SERVER_PATH];
  return require("../server.js");
}

function connect(port, code){
  return new Promise(function(resolve, reject){
    var ws = new WebSocket("ws://localhost:" + port + "?code=" + encodeURIComponent(code));
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
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

async function testNoneAdapterRoundtrip(){
  console.log("=== NoneAdapter: load always null, save/remove are no-ops ===");
  var a = NoneAdapter();
  assert.strictEqual(await a.load("anything"), null);
  await a.save("anything", { foo: "bar" }); // must not throw
  assert.strictEqual(await a.load("anything"), null, "NoneAdapter never actually remembers a save");
  await a.remove("anything"); // must not throw
  console.log("OK");
}

async function testFileAdapterRoundtrip(){
  console.log("=== FileAdapter: save/load/remove round-trip on real disk ===");
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-storage-test-"));
  var a = FileAdapter({ dir: dir });
  assert.strictEqual(await a.load("CODE1"), null, "nothing saved yet");
  await a.save("CODE1", { "CODE1": { iv:"x", ct:"y" } });
  var loaded = await a.load("CODE1");
  assert.deepStrictEqual(loaded, { "CODE1": { iv:"x", ct:"y" } });

  // the code itself is never used as a literal filename -- confirms the
  // path-safety property file-adapter.js's header comment promises.
  var files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0], filenameFor("CODE1"));
  assert.ok(files[0].indexOf("CODE1") === -1, "the raw code must not appear in the filename");

  await a.remove("CODE1");
  assert.strictEqual(await a.load("CODE1"), null, "removed room reads back as null");
  await a.remove("CODE1"); // removing an already-gone room must not throw
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK");
}

async function testFileAdapterRejectsPathTraversal(){
  console.log("=== FileAdapter: a code containing path-traversal characters can't escape the data dir ===");
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-storage-test-"));
  var a = FileAdapter({ dir: dir });
  var evilCode = "../../../../tmp/relay-escape-attempt";
  await a.save(evilCode, { x: 1 });
  var files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1, "the write must land inside dir, not escape it");
  assert.ok(!fs.existsSync(path.join(dir, "..", "..", "..", "..", "tmp", "relay-escape-attempt.json")));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK");
}

async function testCreateStorageSelectsByKind(){
  console.log("=== createStorage() picks the adapter by kind, defaulting to none ===");
  var none = createStorage();
  assert.strictEqual(await none.load("x"), null);
  var viaEnv;
  var prev = process.env.RELAY_STORAGE;
  try{
    process.env.RELAY_STORAGE = "file";
    viaEnv = createStorage();
  } finally { process.env.RELAY_STORAGE = prev; }
  assert.strictEqual(typeof viaEnv.load, "function");
  console.log("OK");
}

async function testServerSurvivesRestartWithFileAdapter(){
  console.log("=== server.js: a room's docs survive a restart when using FileAdapter ===");
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-storage-test-"));
  var adapterA = FileAdapter({ dir: dir });
  var wssA = freshServer().startServer({ port: PORT, storage: adapterA });

  var a = await connect(PORT, "PERSISTROOM");
  await waitFor(a, function(m){ return m.op === "snapshot"; });
  send(a, { op:"put", path:"PERSISTROOM", envelope:{ iv:"x", ct:"survives-restart" } });
  await sleep(50); // let the fire-and-forget persistRoom() write land
  a.ws.close();
  await new Promise(function(r){ wssA.close(r); });

  // "restart": a fresh startServer() call, sharing the same on-disk
  // adapter -- standing in for the real process exiting and relaunching
  // against the same RELAY_DATA_DIR.
  var adapterB = FileAdapter({ dir: dir });
  var wssB = freshServer().startServer({ port: PORT, storage: adapterB });
  var b = await connect(PORT, "PERSISTROOM");
  var snap = await waitFor(b, function(m){ return m.op === "snapshot"; });
  assert.strictEqual(snap.docs["PERSISTROOM"].ct, "survives-restart",
    "a FileAdapter-backed relay should hand a reconnecting client its room's prior state");

  b.ws.close();
  await new Promise(function(r){ wssB.close(r); });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("OK");
}

async function testServerForgetsOnRestartWithNoneAdapter(){
  console.log("=== server.js: a room's docs do NOT survive a restart with the default (NoneAdapter) ===");
  var wssA = freshServer().startServer({ port: PORT, storage: NoneAdapter() });
  var a = await connect(PORT, "EPHEMERALROOM");
  await waitFor(a, function(m){ return m.op === "snapshot"; });
  send(a, { op:"put", path:"EPHEMERALROOM", envelope:{ iv:"x", ct:"should-not-survive" } });
  await sleep(50);
  a.ws.close();
  await new Promise(function(r){ wssA.close(r); });

  var wssB = freshServer().startServer({ port: PORT, storage: NoneAdapter() });
  var b = await connect(PORT, "EPHEMERALROOM");
  var snap = await waitFor(b, function(m){ return m.op === "snapshot"; });
  assert.deepStrictEqual(snap.docs, {}, "default behavior is unchanged: nothing survives a restart");

  b.ws.close();
  await new Promise(function(r){ wssB.close(r); });
  console.log("OK");
}

async function main(){
  await testNoneAdapterRoundtrip();
  await testFileAdapterRoundtrip();
  await testFileAdapterRejectsPathTraversal();
  await testCreateStorageSelectsByKind();
  await testServerSurvivesRestartWithFileAdapter();
  await testServerForgetsOnRestartWithNoneAdapter();
  console.log("=== ALL STORAGE TESTS PASSED ===");
  process.exit(0);
}

main().catch(function(err){ console.error("STORAGE TEST FAILED:", err); process.exit(1); });
