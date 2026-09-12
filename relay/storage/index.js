"use strict";

// Storage adapter contract -- the relay (server.js) only ever calls these
// three methods on whatever adapter it's given, and never inspects a
// `code` or a saved docs object beyond handing them back verbatim. That's
// the whole adapter pattern here: swapping Render for something else, or
// forking this repo onto a machine with its own storage of choice (S3,
// Redis, Postgres, ...), means writing one small file matching this shape,
// not touching server.js:
//
//   load(code)             -> Promise<Object|null>
//     The room's persisted docs, as a plain {path: envelope} object exactly
//     like server.js's own snapshotOf() produces -- or null if nothing has
//     ever been saved for this code.
//
//   save(code, docsObject) -> Promise<void>
//     Replace everything persisted for this room with docsObject (a full
//     snapshot, not a diff -- simplest possible contract for an adapter to
//     implement correctly).
//
//   remove(code)           -> Promise<void>
//     Forget this room entirely (called once it's been empty long enough
//     that server.js gives up on it -- see EMPTY_ROOM_TTL_MS).
//
// See none-adapter.js (the default -- reproduces the relay's original
// memory-only, nothing-survives-a-restart behavior) and file-adapter.js
// (a real one, JSON-per-room on local disk) for two working examples.

const { NoneAdapter } = require("./none-adapter.js");
const { FileAdapter } = require("./file-adapter.js");

// RELAY_STORAGE selects the adapter: unset or "none" keeps today's
// behavior (the safe default -- nothing changes for anyone who hasn't
// opted in); "file" persists to RELAY_DATA_DIR (or relay/data by default).
// A fork wiring up its own adapter (Redis, Postgres, ...) can either add a
// case here or just pass `{ storage }` straight into startServer() itself
// and skip this factory entirely.
function createStorage(kind){
  kind = kind || process.env.RELAY_STORAGE || "none";
  if(kind === "file") return FileAdapter();
  return NoneAdapter();
}

module.exports = { createStorage: createStorage, NoneAdapter: NoneAdapter, FileAdapter: FileAdapter };
