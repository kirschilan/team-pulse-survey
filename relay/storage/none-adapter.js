"use strict";

// The default adapter, and the whole relay's original behavior before
// storage adapters existed at all: nothing is ever persisted. A room's
// docs live only in the `rooms` Map in server.js's own process memory, so
// a restart (or a Render free-tier spin-down) loses every in-progress
// session, exactly as documented in relay/README.md's "Room lifecycle"
// section. Kept as its own file (rather than just "no adapter configured")
// so it's a visible, literal implementation of the adapter interface --
// the smallest possible example for anyone writing their own.
function NoneAdapter(){
  return {
    load: function(){ return Promise.resolve(null); },
    save: function(){ return Promise.resolve(); },
    remove: function(){ return Promise.resolve(); }
  };
}

module.exports = { NoneAdapter: NoneAdapter };
