from playwright.sync_api import sync_playwright
import pathlib, subprocess, os, time, socket

# REF-2 (STATUS.md's "Code quality & refactoring backlog"): local-store.js
# and relay-client.js independently implement the same Firestore-shaped
# `collection()`/`doc()` surface -- see docs/backend-contract.md for the
# documented contract this test verifies. Runs the SAME sequence of
# get/set/update/delete/add/onSnapshot operations against an isolated
# harness for each backend (no fake store, no mock WebSocket -- a real
# relay/server.js subprocess for the relay side), asserting identical
# shapes for everything the contract calls shared, and that the documented
# difference (the `unavailable` field) is exactly what's described there.

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC_DIR = REPO_ROOT / "public"
RELAY_DIR = REPO_ROOT / "relay"
LOCAL_STORE_JS = (PUBLIC_DIR / "local-store.js").read_text(encoding="utf-8")
CRYPTO_JS = (PUBLIC_DIR / "js" / "crypto.js").read_text(encoding="utf-8")
RELAY_CLIENT_JS = (PUBLIC_DIR / "js" / "relay-client.js").read_text(encoding="utf-8")
RELAY_PORT = 8803  # distinct from every other RELAY_PORT in tests/*.py -- see run_all.sh's own comment on why each must be unique
RELAY_URL = "ws://localhost:%d" % RELAY_PORT

# The same sequence, run against whatever `db` object the page sets up --
# `window.__contractDb__ = { doc, collection }`, resolving to either
# local-store.js's window.claude.use("db") result or a thin wrapper around
# SquadPulseRelay.doc/collection. Both expose the identical shape this
# function exercises.
#
# Path shape note (a real thing this test found, not an assumption going
# in): local-store.js treats every path as an arbitrary flat string key --
# it has no opinion on depth or meaning. relay-client.js does NOT: its
# routing (codeFromPath()) always reads the path's SECOND segment as the
# room code (e.g. "sessions/<code>", "boards/<code>") -- a bare
# "contract-test/doc1" silently misroutes there (codeFromPath returns the
# doc's own id as if it were a room code, and a code-LESS collection path
# hits the special "list every session this device knows about" branch
# instead of an ordinary per-room collection). "contract-test/room1/items"
# (3+ segments: namespace/code/subpath) is what actually exercises the
# same per-room collection/doc machinery a real "sessions/ABC123/responses"
# path does -- used here for BOTH harnesses, since local-store.js is
# indifferent to which shape it's handed either way.
CONTRACT_SUITE_JS = """
async () => {
  var db = window.__contractDb__;
  var out = {};

  // A doc that's never been written reads back as not-found, not an error.
  var fresh = await db.doc("contract-test/room1/items/doc1").get();
  out.freshExists = fresh.exists;
  out.freshDataIsUndefined = fresh.data() === undefined;
  out.freshHasUnavailableKey = "unavailable" in fresh;
  out.freshUnavailableValue = fresh.unavailable;

  // update() on a doc that doesn't exist yet rejects distinctly -- shared
  // error shape in both implementations.
  try {
    await db.doc("contract-test/room1/items/doc1").update({x:1});
    out.updateMissingCode = "resolved (unexpected)";
  } catch(e) { out.updateMissingCode = e.code; }

  // set() creates it. A single doc's own get() returns a LIVE, MUTABLE
  // reference in BOTH implementations -- neither deep-freezes it, unlike
  // an onSnapshot delivery or a collection get() (see below) -- so this
  // clones immediately (the way a real caller must) rather than trusting
  // the reference to stay a point-in-time snapshot across later writes.
  await db.doc("contract-test/room1/items/doc1").set({ name:"Alpha", nested:{ a:1 } });
  var afterSet = await db.doc("contract-test/room1/items/doc1").get();
  out.afterSetExists = afterSet.exists;
  out.afterSetData = JSON.parse(JSON.stringify(afterSet.data()));
  out.afterSetGetIsFrozen = Object.isFrozen(afterSet.data());

  var snapDelivery = await new Promise((resolve) => {
    var unsub = db.doc("contract-test/room1/items/doc1").onSnapshot(function(snap){ unsub(); resolve(snap); });
  });
  out.onSnapshotExists = snapDelivery.exists;
  out.onSnapshotData = snapDelivery.data();
  out.onSnapshotFrozen = Object.isFrozen(snapDelivery.data()) && Object.isFrozen(snapDelivery.data().nested);

  // update() deep-merges: an untouched nested key survives, a new
  // top-level key is added, an explicitly-patched nested key changes.
  await db.doc("contract-test/room1/items/doc1").update({ nested: { b:2 } });
  var afterUpdate = await db.doc("contract-test/room1/items/doc1").get();
  out.afterUpdateData = JSON.parse(JSON.stringify(afterUpdate.data()));

  // add() generates an id; collection().get() reflects it.
  var added = await db.collection("contract-test/room1/items").add({ name:"Beta" });
  out.addedIdIsString = typeof added.id === "string" && added.id.length > 0;
  var collSnap = await db.collection("contract-test/room1/items").get();
  out.collectionSize = collSnap.size;
  out.collectionEmpty = collSnap.empty;
  out.collectionHasMetadataShape = collSnap.metadata &&
    collSnap.metadata.fromCache === false && collSnap.metadata.hasPendingWrites === false;
  out.collectionDocIds = collSnap.docs.map(function(d){ return d.id; }).sort();

  // delete() removes it -- both a direct get() and a fresh collection
  // listing agree afterward.
  await db.doc("contract-test/room1/items/doc1").delete();
  var afterDelete = await db.doc("contract-test/room1/items/doc1").get();
  out.afterDeleteExists = afterDelete.exists;
  var collAfterDelete = await db.collection("contract-test/room1/items").get();
  out.collectionSizeAfterDelete = collAfterDelete.size;

  return out;
}
"""


def build_local_store_harness(out_name):
    """A minimal page loading ONLY local-store.js -- same isolation
    principle test_relay_error_handling.py already established for
    relay-client.js (see build_relay_isolation_harness below): this tests
    local-store.js's own contract, not the whole app."""
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<script>" + LOCAL_STORE_JS + "</script>"
        "</head><body><script>\n"
        "window.__contractReady__ = window.claude.use('db').then(function(db){ window.__contractDb__ = db; });\n"
        "</script></body></html>"
    )
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


def build_relay_harness(out_name):
    """Same isolation harness test_relay_error_handling.py uses (crypto.js +
    relay-client.js only), wrapped so window.__contractDb__ matches the
    same {doc, collection} shape the local-store.js harness exposes."""
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<script>window.SQUAD_PULSE_RELAY_URL = %r;</script>" % RELAY_URL +
        "<script>" + CRYPTO_JS + "</script>"
        "<script>" + RELAY_CLIENT_JS + "</script>"
        "</head><body>"
        "<div id='diagLog'></div>"
        "<script>\n"
        "window.diag = function(msg){ document.getElementById('diagLog').textContent += msg + \"\\n\"; };\n"
        "window.__contractDb__ = { doc: SquadPulseRelay.doc, collection: SquadPulseRelay.collection };\n"
        "window.__contractReady__ = Promise.resolve();\n"
        "</script></body></html>"
    )
    out_path = PUBLIC_DIR / out_name
    out_path.write_text(html, encoding="utf-8")
    return out_path


def wait_for_port(port, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=0.2):
                return True
        except OSError:
            time.sleep(0.05)
    return False


relay_env = dict(os.environ)
relay_env["PORT"] = str(RELAY_PORT)
relay_proc = subprocess.Popen(
    ["node", "server.js"],
    cwd=str(RELAY_DIR),
    env=relay_env,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)

try:
    if not wait_for_port(RELAY_PORT):
        relay_proc.terminate()
        try:
            relay_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            relay_proc.kill()
        out = relay_proc.stdout.read() if relay_proc.stdout else ""
        raise RuntimeError("relay server never opened port %d\n%s" % (RELAY_PORT, out))

    with sync_playwright() as p:
        browser = p.chromium.launch()

        print("=== local-store.js: the shared contract ===")
        local_harness = build_local_store_harness("_test_contract_local_store.html")
        local_page = browser.new_page()
        errors_local = []
        local_page.on("pageerror", lambda e: errors_local.append(str(e)))
        local_page.goto("file://" + str(local_harness.resolve()))
        local_page.wait_for_function("() => !!window.__contractDb__")
        local_result = local_page.evaluate(CONTRACT_SUITE_JS)
        print("local-store.js result:", local_result)

        print("=== relay-client.js: the shared contract, against a real relay ===")
        relay_harness = build_relay_harness("_test_contract_relay_client.html")
        relay_page = browser.new_page()
        errors_relay = []
        relay_page.on("pageerror", lambda e: errors_relay.append(str(e)))
        relay_page.goto("file://" + str(relay_harness.resolve()), wait_until="domcontentloaded")
        relay_result = relay_page.evaluate(CONTRACT_SUITE_JS)
        print("relay-client.js result:", relay_result)

        print("=== shared contract: identical shape in both backends ===")
        for r in (local_result, relay_result):
            assert r["freshExists"] is False
            assert r["freshDataIsUndefined"] is True
            assert r["updateMissingCode"] == "invalid_argument"
            assert r["afterSetExists"] is True
            assert r["afterSetData"] == {"name": "Alpha", "nested": {"a": 1}}
            # docRef.get()'s data() is a LIVE, mutable reference in both
            # implementations -- NOT deep-frozen, unlike an onSnapshot
            # delivery or a collection get() below (see docs/backend-contract.md).
            assert r["afterSetGetIsFrozen"] is False
            assert r["onSnapshotExists"] is True
            assert r["onSnapshotData"] == {"name": "Alpha", "nested": {"a": 1}}
            assert r["onSnapshotFrozen"] is True
            # update() deep-merges: nested.a survives untouched, nested.b is added
            assert r["afterUpdateData"] == {"name": "Alpha", "nested": {"a": 1, "b": 2}}
            assert r["addedIdIsString"] is True
            assert r["collectionSize"] == 2
            assert r["collectionEmpty"] is False
            assert r["collectionHasMetadataShape"] is True
            assert r["afterDeleteExists"] is False
            assert r["collectionSizeAfterDelete"] == 1

        print("=== documented difference: the `unavailable` field (docs/backend-contract.md) ===")
        assert local_result["freshHasUnavailableKey"] is False, "local-store.js snapshots never carry `unavailable` at all"
        assert relay_result["freshHasUnavailableKey"] is True, "relay-client.js snapshots always carry `unavailable`, even when false"
        assert relay_result["freshUnavailableValue"] is False, "a connected, reachable relay room is not unavailable"

        print("errors (local-store harness):", errors_local)
        print("errors (relay-client harness):", errors_relay)
        assert errors_local == []
        assert errors_relay == []
        print("PASS")
        browser.close()
finally:
    relay_proc.terminate()
    try:
        relay_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        relay_proc.kill()
