"use strict";

// Shared harness for the "integration" tier: proof-of-concept for testing
// public/js/relay-client.js's own contract (encryption, ack correlation,
// reconnect) against a REAL relay/server.js subprocess and a REAL
// WebSocket, without a browser.
//
// Why this can work at all: relay-client.js and crypto.js together touch
// exactly one browser-only global (`window.SQUAD_PULSE_RELAY_URL`, a single
// property read) plus `localStorage`, `WebSocket`, and Web Crypto -- all of
// which either need a one-line stub or are already native Node globals in
// this runtime (verified: `typeof globalThis.crypto.subtle`, `WebSocket`,
// `btoa`/`atob`, `TextEncoder`/`TextDecoder` are all functions/objects here,
// no polyfill needed). Neither file has a `module.exports` guard the way
// tests/unit/*.js's targets do (they were never meant to be `require()`d),
// so this uses Node's built-in `vm` module to run their real source text in
// a sandboxed context that shares one global-like scope between them --
// exactly mirroring what two `<script>` tags on one page give them in a
// browser, which is the actual thing being relied on in production (see
// relay-client.js's own top-of-file comment: `SquadPulseCrypto.deriveKey`
// etc. are bare identifier references that only resolve because both files
// share one global scope).
//
// What this tier is NOT for: anything touching a real DOM, real rendering,
// or the app's own UI wiring -- that stays in tests/test_*.py (Playwright).
// This tier is specifically for relay-client.js's own logic: does a write
// really wait for the relay's ack, does a rejected write really reject,
// does a write survive a reconnect -- none of which needs a browser, only
// needed one because relay-client.js had nowhere else to run.

const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const net = require("net");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELAY_DIR = path.join(REPO_ROOT, "relay");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");

const CRYPTO_SRC = fs.readFileSync(path.join(PUBLIC_DIR, "js", "crypto.js"), "utf8");
const RELAY_CLIENT_SRC = fs.readFileSync(path.join(PUBLIC_DIR, "js", "relay-client.js"), "utf8");

function waitForPort(port, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  const deadline = Date.now() + timeoutMs;
  return new Promise(function poll(resolve, reject) {
    const sock = net.createConnection({ host: "localhost", port: port }, function () {
      sock.end();
      resolve(true);
    });
    sock.on("error", function () {
      sock.destroy();
      if (Date.now() > deadline) return reject(new Error("relay never opened port " + port));
      setTimeout(function () { poll(resolve, reject); }, 50);
    });
  });
}

function waitForPortClosed(port, timeoutMs) {
  timeoutMs = timeoutMs || 5000;
  const deadline = Date.now() + timeoutMs;
  return new Promise(function poll(resolve) {
    const sock = net.createConnection({ host: "localhost", port: port }, function () {
      sock.end();
      if (Date.now() > deadline) return resolve(false);
      setTimeout(function () { poll(resolve); }, 50);
    });
    sock.on("error", function () {
      sock.destroy();
      resolve(true);
    });
  });
}

async function startRelay(port) {
  const proc = spawn("node", ["server.js"], {
    cwd: RELAY_DIR,
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  try {
    await waitForPort(port);
  } catch (e) {
    throw new Error("relay server never opened port " + port + "\n" + out);
  }
  return proc;
}

function stopRelay(proc) {
  return new Promise(function (resolve) {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once("exit", function () { resolve(); });
    proc.kill();
    setTimeout(function () { if (proc.exitCode === null) proc.kill("SIGKILL"); }, 2000);
  });
}

// Builds a genuinely FRESH, isolated relay-client.js instance -- its own
// `rooms` cache, its own connections, nothing shared with any previously
// built context. This is the Node equivalent of `browser.new_page()`: the
// only way to prove a read is really coming from a fresh connection's own
// snapshot, not a stale/reused subscription's live-broadcast cache (see
// STATUS.md's note on the stale-connection bug this exact mistake caused
// in the Playwright version of this test).
function buildRelayContext(relayUrl, opts) {
  opts = opts || {};
  const NativeWebSocket = global.WebSocket;
  const diagLog = [];
  const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    crypto: global.crypto,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    btoa: btoa,
    atob: atob,
    window: { SQUAD_PULSE_RELAY_URL: relayUrl },
    localStorage: makeFakeLocalStorage(),
    diag: function (msg) { diagLog.push(String(msg)); },
  };
  let acksReceived = 0;
  sandbox.WebSocket = function (url) {
    const ws = new NativeWebSocket(url);
    ws.addEventListener("message", function (evt) {
      try {
        const m = JSON.parse(evt.data);
        if (m.op === "ack") acksReceived++;
      } catch (e) { /* not JSON or not relevant -- ignore */ }
    });
    return ws;
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(CRYPTO_SRC, context, { filename: "crypto.js" });
  vm.runInContext(RELAY_CLIENT_SRC, context, { filename: "relay-client.js" });
  return {
    relay: context.SquadPulseRelay,
    crypto: context.SquadPulseCrypto,
    get acksReceived() { return acksReceived; },
    diagIncludes: function (substr) { return diagLog.some(function (l) { return l.indexOf(substr) !== -1; }); },
  };
}

function makeFakeLocalStorage() {
  const store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
  };
}

// Polls a predicate until it's true or timeoutMs elapses -- the Node
// equivalent of Playwright's page.wait_for_function(), used for waiting on
// a real, observable condition (e.g. "the client has logged that it's
// reconnecting") instead of a fixed sleep.
function waitFor(predicate, timeoutMs, intervalMs) {
  timeoutMs = timeoutMs || 5000;
  intervalMs = intervalMs || 20;
  const deadline = Date.now() + timeoutMs;
  return new Promise(function poll(resolve, reject) {
    if (predicate()) return resolve();
    if (Date.now() > deadline) return reject(new Error("timed out waiting for condition"));
    setTimeout(function () { poll(resolve, reject); }, intervalMs);
  });
}

module.exports = {
  startRelay: startRelay,
  stopRelay: stopRelay,
  waitForPortClosed: waitForPortClosed,
  buildRelayContext: buildRelayContext,
  waitFor: waitFor,
};
