# The `db` backend contract

REF-2 (STATUS.md's "Code quality & refactoring backlog"): `public/local-store.js` and
`public/js/relay-client.js` are two independent implementations of the same Firestore-shaped
surface `db.js` and every feature module (`squads.js`, `dimensions.js`, `templates.js`,
`board-export-import.js`, `retro-facilitator.js`, `retro-join.js`, `board-sync.js`) are written
against — the same surface a real Claude Artifact `db` capability would also provide, when this
app runs inside one. Neither file has ever named that shared contract in one place; this document
is that place. It doesn't change either implementation's behavior — see each file's own session-log
history in `STATUS.md` for that — it names what's already true, and calls out where the two
genuinely differ on purpose.

## Why two implementations share one contract

- `local-store.js` backs every `squads`/`dimensions`/`templates`/`meta`-rooted path with this
  browser's own `localStorage` — the board's data, one device, no network.
- `relay-client.js` backs every `sessions`/`boards`-rooted path with a real WebSocket connection to
  `relay/server.js` — a live retro session, or an opt-in synced team board, shared across devices.
- `local-store.js` routes a path to one or the other via `isRelayPath()` (delegating to
  `SquadPulseRelay.isSessionPath()`/`isBoardPath()`) — from `db.js` and every feature module's own
  point of view, this is invisible: the SAME `collection()`/`doc()` calls work identically whichever
  backend actually receives them. That's Liskov substitution working as intended, not an accident —
  see `docs/refactoring-report.md`'s LSP section for the same observation made before this document
  existed. This document formalizes the surface that substitution depends on, so a future third
  backend (or a change to either existing one) has something to check itself against.

## A real asymmetry the contract test found: path shape

`local-store.js` is completely indifferent to a path's depth or meaning — every path is just an
arbitrary flat string key into its one `STORE` object. `relay-client.js` is **not**: its routing
(`codeFromPath()`) always reads a path's SECOND segment as the room code that selects which
WebSocket room/connection to use (e.g. `sessions/<code>`, `boards/<code>`), and treats anything
after that as an arbitrary sub-path *within* that room (e.g. `sessions/<code>/responses/<id>`). A
bare two-segment path like `squads/squad-1` (fine for `local-store.js`) silently misroutes through
`relay-client.js`: `squad-1` gets read as if it were a room code, and a *single-segment* collection
path like `squads` hits an entirely different, special-cased branch (`collRef`'s `codeHere`
computes to `undefined`, which routes to `subscribeBroadSessions()` — the "list every session this
device has ever started" fallback — not an ordinary per-room collection at all). This is exactly
why `squads`/`dimensions`/`templates`/`meta` paths are never actually routed through
`relay-client.js` in the first place (`local-store.js`'s own `isRelayPath()` only sends
`sessions`/`boards`-rooted paths there) — a caller can rely on the two backends being
interchangeable in practice specifically because nothing in this app ever hands `relay-client.js`
a path shaped for `local-store.js`'s flatter model. `tests/test_backend_contract_parity.py` uses a
three-segment path (`contract-test/room1/items`) for both harnesses precisely to exercise
`relay-client.js`'s real per-room routing rather than accidentally hitting that fallback branch.

## The shared surface

Both `collection()` and `doc()`, at the TOP level only (`db.collection(path, secret?)` /
`db.doc(path, secret?)` — never on a ref already returned by one of these calls; see below), accept
an optional second `secret` argument. `local-store.js`'s router (`routedDocRef`/`routedCollRef`)
forwards it straight through to `SquadPulseRelay.doc`/`.collection` when the path is relay-routed,
and it's simply unused for a `squads`/`dimensions`/`templates`/`meta`-rooted path (nothing there is
encrypted, so there's nothing for it to drive). Inside `relay-client.js`, `secret` is what a room's
own encryption key derives from (`SquadPulseCrypto.deriveKey(secret || code)` — see `getRoom()`):
board-sync.js, retro-facilitator.js, and retro-join.js all supply the real, high-entropy per-room
secret (shared only via a join link/QR, never sent to the relay) on every real session/board path
they touch. **Omitting it derives the key from the routing code instead** — the very value the
relay itself already has to route the message, and that any join link necessarily carries — so a
caller that legitimately holds the real secret but forgets to pass it silently gets no real
encryption guarantee at all, not a slightly-weaker one. A `collection(sub)`/`doc(id)` call made on a
ref that ITSELF came from one of these top-level calls does NOT take a `secret` parameter — it's
forwarded automatically, closed over from the parent call (`collection: function(sub){ return
collRef(path + "/" + sub, secret); }`, and identically for a collection ref's own `doc()` — see
`relay-client.js`'s `docRef()`/`collRef()`), so a caller only ever supplies it once, at whichever
top-level call first names the room's path. `tests/test_backend_contract_parity.py` exercises this
directly: a secret passed only at `db.collection(path, secret)` and never repeated on the `.doc(id)`
call chained off of it still round-trips real data through a real relay room. (Proving the derived
key materially differs when the secret is wrong — not just that omitting it is well-documented — is
`tests/test_encryption_no_plaintext_on_wire.py`'s job, not this contract test's; that file already
covers "a device with the wrong secret can't read the room" at the application level.)

A `collection(path)` call returns:

| Member | Shape | Notes |
|---|---|---|
| `path` | string | The path this ref was created with. |
| `doc(id?)` | `(string?) => docRef` | Omitted `id` generates one: `"auto" + Math.random().toString(36).slice(2)` — identical in both implementations. |
| `add(data)` | `(object) => Promise<docRef>` | Creates a doc at a generated id, same generation scheme as `doc()`. |
| `orderBy()` / `where()` / `limit()` | `() => this` | No-ops in both — neither implementation supports real server-side ordering/filtering; `db.js`'s own `.orderBy("order")` calls rely on the app doing its own sort afterward (see `helpers.js`'s `sortedSquads`/`sortedDimensions`), not on this call doing anything. |
| `get()` | `() => Promise<collectionSnapshot>` | See below. |
| `onSnapshot(next, err?)` | `(fn, fn?) => unsubscribeFn` | `next` receives a `collectionSnapshot` on registration and again on every change; `err` is only ever invoked by `db.js`'s own listener wiring, never actually called by either backend today (both fail into `next` instead — see "What's NOT part of the contract" below). |

A `doc(path)` call returns:

| Member | Shape | Notes |
|---|---|---|
| `id` / `path` | string | `id` is `path`'s final segment. |
| `get()` | `() => Promise<docSnapshot>` | |
| `set(data)` | `(object) => Promise<void>` | Fully replaces the stored doc. |
| `update(patch)` | `(object) => Promise<void>` | Deep-merges `patch` into the stored doc (recursing into any key that's a plain object in BOTH the existing value and the patch; otherwise the patch's value wins outright). Rejects `{code:"invalid_argument", message:"doc missing"}` if the doc doesn't exist yet — identical in both implementations. |
| `delete()` | `() => Promise<void>` | |
| `collection(sub)` | `(string) => collectionRef` | A subcollection rooted at this doc. |
| `onSnapshot(next, err?)` | `(fn, fn?) => unsubscribeFn` | Same delivery contract as a collection's. |

A **`docSnapshot`** is `{ id, exists: boolean, data(): object | undefined }` — `data()` is a
function (not a property) in both. **Its freezing behavior depends on WHERE the snapshot came
from, identically in both implementations** — a real, previously-undocumented nuance this
document's own contract test (`tests/test_backend_contract_parity.py`) found by asserting it
directly, not by reading either file's comments:
- A snapshot from `docRef.get()` returns a **live, mutable reference** to the backend's own
  internal storage — NOT frozen, NOT cloned. Calling `.data()` twice returns the exact same object.
  What a LATER write on that same doc does to an EARLIER-captured `.data()` result depends on which
  write it is, identically in both implementations: `update(patch)` deep-merges the patch INTO the
  existing stored object (`deepMerge(STORE[path], patch)` / `deepMerge(room.docs[path], patch)`) —
  it mutates that object in place, so an earlier-captured reference DOES retroactively reflect it,
  since nothing ever copied it. `set(data)` REPLACES the stored value outright
  (`STORE[path]=data` / `room.docs[path]=data`) — it's a reassignment, not a mutation, so an
  earlier-captured reference keeps pointing at the OLD object and is unaffected by it. A caller
  needing a stable point-in-time value from a `get()` — regardless of which kind of write might
  follow — must still clone it immediately (e.g. `JSON.parse(JSON.stringify(...))`) rather than
  holding onto the reference, since relying on "the next write happens to be a `set()`" is fragile
  and not something either implementation promises going forward.
- A snapshot from `onSnapshot()`'s delivery, or a `collectionSnapshot`'s own `docs[].data()`,
  returns a **fresh, recursively `Object.freeze()`d clone** on every call (`deepFreezeClone()` —
  independently implemented, near-identically, in each file; see "What's duplicated, on purpose"
  below) — safe to hold onto, immune to a later write, but also meaning a caller that needs to
  MUTATE it (e.g. `dimensions.js` editing a dimension row in place after loading it from a
  snapshot) must clone it into a plain, unfrozen object first — `board-sync.js`'s `plainClone()`
  and `db.js`'s own per-listener cloning both exist specifically because of this.

This split isn't arbitrary: a `get()` is a one-shot read a caller typically uses immediately and
discards, where the live-reference cost is invisible; a subscription's delivered snapshot is
exactly the kind of long-lived value multiple parts of the app hold onto and compare over time,
where an accidentally-shared mutable reference would be a real, hard-to-trace bug. Neither
implementation states this split anywhere in its own source before this document — worth keeping
in mind before adding a new caller that reads via `get()` and expects the old Firestore-client
behavior of a stable, independent snapshot.

A **`collectionSnapshot`** is `{ docs: docSnapshot[], size: number, empty: boolean, metadata: { fromCache: false, hasPendingWrites: false } }` — `metadata` is present in both purely for shape
compatibility with a real Firestore snapshot; neither implementation ever sets `fromCache`/
`hasPendingWrites` to anything but `false`, since neither has an offline cache in the sense those
fields describe.

## Where they intentionally differ

- **The `unavailable` field.** A `relay-client.js` doc snapshot ALWAYS carries
  `unavailable: !!room.unavailable` (`relay-client.js`'s `notifyPath`/`notifyEverything`/`docRef`).
  A `local-store.js` doc snapshot NEVER carries this key at all — `localStorage` has no
  "unreachable" state to report; it's simply always there. Every current caller treats this as
  optional (`snap.unavailable` reads `undefined`, falsy, on a local-backed snapshot) — this is a
  real, previously-unwritten asymmetry (flagged in `docs/refactoring-report.md`'s LSP section
  before this document existed), now documented as INTENTIONAL rather than an oversight to
  eventually "fix": a local board genuinely has no unavailable state to represent, so adding the
  key there would mean inventing a value with no meaning.
- **Readiness timing.** A `relay-client.js` ref's `get()`/`set()`/`update()`/`delete()`/`onSnapshot()`
  all wait on that room's own `room.ready` promise before doing anything — which resolves once
  either a real snapshot arrives from the relay, or the room is given up on after
  `MAX_RECONNECT_ATTEMPTS` (see `relay-client.js`'s `getRoom()`/`giveUp()`). A `local-store.js` ref
  resolves on the very next microtask (`Promise.resolve()`), unconditionally — there's no handshake
  to wait for. Every caller already awaits these promises generically (nothing branches on WHICH
  backend answered), so this difference is invisible above `db.js`, but it means a relay-backed
  write can take meaningfully longer in practice (a real network round trip, or the full backoff
  sequence to `giveUp()`) than a local-backed one ever does.
- **Failure mode.** A `relay-client.js` write can reject with `{code:"unavailable", ...}` once its
  room has given up (see `unavailableError()`), or `{code:"rejected", ...}` if the relay itself
  sends back a protocol-level `{op:"error"}` for that specific write. `local-store.js` has no
  equivalent failure mode at all beyond the shared `invalid_argument` case above — a `localStorage`
  write can fail (quota exceeded, storage disabled), but `local-store.js`'s `persist()` swallows
  that silently by design (see its own comment: "state stays in-memory for this tab") rather than
  rejecting the caller's promise, since there's no useful recovery action for a caller to take that
  `persist()` itself doesn't already represent the best available fallback for.

## What's duplicated, on purpose (not folded into a shared module here)

`deepFreezeClone()` and `deepMerge()` are near-identical, independently-maintained functions in
both `local-store.js` and `relay-client.js`. REF-2's own acceptance criteria is explicit that this
document's job is naming the contract and covering it with tests where practical — **not**
extracting a shared runtime module, unless doing so demonstrably reduces risk. It doesn't, here:
these two functions are small (a dozen lines each), have had zero bugs reported against either copy
independently, and a shared module would be the app's first cross-file dependency between what are
otherwise two swappable, independent backend implementations — the exact coupling Liskov
substitution here currently avoids. If either function ever needs a real behavioral fix, fix it in
both places and note that both needed the same fix; that's a cheaper cost than introducing a shared
module both files would then depend on for no behavioral reason.

## What's NOT part of the contract

- Real Firestore-specific behavior neither implementation attempts: transactions, batched writes,
  composite queries, security rules, offline persistence. `orderBy()`/`where()`/`limit()` exist only
  so calling code that chains them doesn't throw — see the table above.
- A THIRD implementation this app also depends on but that isn't documented here: the real Claude
  Artifact `db` capability, when this app runs inside one (`window.claude` supplied by the
  platform itself, not by either file this document covers). Neither `local-store.js` nor
  `relay-client.js` installs anything if a real `window.claude` is already present — see each
  file's own header comment. This document only covers the two backends this repository's own code
  implements.

## Test coverage

`tests/test_backend_contract_parity.py` runs the same sequence of `get`/`set`/`update`/`delete`/
`add`/`onSnapshot` operations against an isolated `local-store.js` harness and an isolated
`relay-client.js` harness (a real `relay/server.js` subprocess, real WebSocket — no mock), asserting
identical shapes for everything this document calls shared, and asserting the documented
differences (`unavailable`) are exactly what's described above, not something else.
