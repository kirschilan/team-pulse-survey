"use strict";

// Proof-of-concept port of tests/test_relay_write_acknowledgment.py to the
// new no-browser "integration" tier -- see relay_harness.js's header
// comment for why this is possible and what it's for. Same 5 scenarios,
// same assertions, same real relay subprocess and real WebSocket; the only
// thing that changed is the JS runtime driving relay-client.js (Node's vm
// module instead of a real Chromium page).

const assert = require("assert");
const {
  startRelay, stopRelay, waitForPortClosed, buildRelayContext, waitFor,
} = require("./relay_harness");

const RELAY_PORT = 8850; // dedicated range for this tier -- distinct from tests/*.py's RELAY_PORT values and relay/test/*.js's 8798-8799
const RELAY_URL = "ws://localhost:" + RELAY_PORT;

async function main() {
  let relayProc = await startRelay(RELAY_PORT);

  try {
    console.log("=== a write's promise resolves only once a real ack has actually been received, not merely queued ===");
    const a = buildRelayContext(RELAY_URL);
    const acksBefore1 = a.acksReceived;
    await a.relay.doc("boards/ACKPROOF/config").set({ hello: "world" });
    console.log("acks before/after the awaited set():", acksBefore1, a.acksReceived);
    assert.strictEqual(a.acksReceived, acksBefore1 + 1,
      "set() must not resolve before its own ack has been received -- resolving on mere queuing is the exact bug this test exists to catch");

    console.log("=== a fresh connection reads back the acked write immediately, with no fixed wait at all ===");
    const secondReader = buildRelayContext(RELAY_URL);
    const read = await secondReader.relay.doc("boards/ACKPROOF/config").get();
    console.log("fresh read:", read.exists, read.data());
    assert.strictEqual(read.exists, true);
    assert.strictEqual(read.data().hello, "world");

    console.log("=== two concurrent writes resolve independently, correlated by their own opId (not just arrival order) ===");
    const acksBefore2 = a.acksReceived;
    await Promise.all([
      a.relay.doc("boards/ACKPROOF/first").set({ n: 1 }),
      a.relay.doc("boards/ACKPROOF/second").set({ n: 2 }),
    ]);
    console.log("acks received for the two concurrent writes:", a.acksReceived - acksBefore2);
    assert.strictEqual(a.acksReceived - acksBefore2, 2);
    // A NEW context here, not `secondReader` reused -- see relay_harness.js's
    // buildRelayContext() comment: a reused, already-open connection is just
    // another live subscriber, and its read would depend on the server's
    // "put" BROADCAST to it having already arrived, a separate, unawaited
    // path from the ack the writer itself waited on. Exactly the mistake
    // that caused a real intermittent failure in the Playwright version of
    // this test (see STATUS.md).
    const thirdReader = buildRelayContext(RELAY_URL);
    const bothA = await thirdReader.relay.doc("boards/ACKPROOF/first").get();
    const bothB = await thirdReader.relay.doc("boards/ACKPROOF/second").get();
    console.log("both concurrent writes landed at their own path:", bothA.data(), bothB.data());
    assert.strictEqual(bothA.data().n, 1);
    assert.strictEqual(bothB.data().n, 2);

    console.log("=== a write the relay rejects (oversized envelope) surfaces a real rejection, not a hang ===");
    let rejected = null;
    try {
      await a.relay.doc("boards/ACKPROOF/toobig").set({ huge: "x".repeat(300000) });
    } catch (e) {
      rejected = e;
    }
    console.log("oversized write result:", rejected);
    assert.ok(rejected, "an oversized write must reject, not resolve");
    assert.ok(rejected.message, "a rejected write should carry the relay's own error message, not a generic one");

    console.log("=== a write made while the relay connection is down (mid-reconnect) still resolves once it reconnects and acks -- no resend loses correlation ===");
    const b = buildRelayContext(RELAY_URL);
    await b.relay.doc("boards/RECONNECT/config").set({ seq: 0 });

    await stopRelay(relayProc);
    assert.ok(await waitForPortClosed(RELAY_PORT), "relay port never actually closed");

    // room.ready already resolved from the write above, so this call runs
    // putDoc() immediately and finds the socket down -- exactly the "queued
    // while not connected" path relay-client.js's sendQueue (reused for a
    // mid-flight reconnect) has to handle correctly.
    await waitFor(function () { return b.diagIncludes("disconnected") || b.diagIncludes("reconnecting"); });
    const pendingWriteStartedAt = Date.now();

    relayProc = await startRelay(RELAY_PORT);

    // The ONLY wait below is this test awaiting the REAL promise
    // relay-client.js returns -- no fixed sleep anywhere in this scenario.
    // If reconnect+resend+ack didn't work, this would hang until Node's own
    // process/test timeout, not silently pass.
    const acksBefore3 = b.acksReceived;
    await b.relay.doc("boards/RECONNECT/config").set({ seq: 1 });
    const elapsed = ((Date.now() - pendingWriteStartedAt) / 1000).toFixed(2);
    console.log("write made while disconnected, resolved " + elapsed + "s after the relay came back, acks:", b.acksReceived - acksBefore3);
    assert.strictEqual(b.acksReceived - acksBefore3, 1);

    const confirmReader = buildRelayContext(RELAY_URL);
    const confirmed = await confirmReader.relay.doc("boards/RECONNECT/config").get();
    console.log("final state after reconnect, read from a fresh connection:", confirmed.data());
    assert.strictEqual(confirmed.data().seq, 1, "the write made during the outage must have actually landed once the relay came back, not been silently dropped");

    console.log("=== ALL WRITE-ACKNOWLEDGMENT TESTS PASSED ===");
  } finally {
    await stopRelay(relayProc);
  }
}

main().catch(function (err) {
  console.error("INTEGRATION TEST FAILED:", err);
  process.exit(1);
});
