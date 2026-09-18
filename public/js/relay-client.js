"use strict";

// Client for the Squad Pulse relay (relay/server.js) -- presents the exact
// same Firestore-shaped surface (collection()/doc() with
// get/set/update/delete/add/onSnapshot) that local-store.js already gives
// the rest of the app, so db.js and everything upstream of it needs zero
// changes. Paths rooted at "sessions" (a live retro) or "boards" (a synced
// team board, see board-sync.js) are routed here; everything else -- squads,
// dimensions, templates, and config -- stays on localStorage as each
// device's own source of truth (see local-store.js's isRelayPath check and
// STATUS.md's "Board sync").
//
// Every doc this module sends or receives over the wire is an encrypted
// {iv, ct} envelope (see crypto.js) -- room.docs below holds the DECRYPTED
// plaintext once unwrapped, exactly mirroring what fake_store.html's STORE
// and local-store.js's STORE hold, just kept in memory per room instead of
// in one flat localStorage blob.
//
// REF-2: this file and local-store.js are two independent implementations
// of that same `db` contract -- see docs/backend-contract.md for the one
// place it's actually named (including this file's own path-shape
// requirement -- codeFromPath() below always reads a path's SECOND segment
// as the room code, unlike local-store.js's flat indifference to path
// shape) and tests/test_backend_contract_parity.py for the shared test
// coverage.
var SquadPulseRelay = (function(){

  // index.html owns the "default to a local relay only when this page
  // itself is local" logic -- by the time this runs, it's already either a
  // real URL or explicitly null/falsy ("no relay available here").
  var RELAY_URL = window.SQUAD_PULSE_RELAY_URL;
  var KNOWN_CODES_KEY = "squadpulse:relay:knownCodes";

  // Callbacks for every currently-active db.collection("sessions").onSnapshot
  // subscriber (see subscribeBroadSessions) -- kept separate from any one
  // room's own listeners since this view spans however many rooms this
  // device currently knows about, including ones that don't exist yet at
  // subscribe time (e.g. the very session about to be started).
  var broadListeners = [];
  function notifyBroadListeners(){ broadListeners.forEach(function(cb){ cb(); }); }

  // SEC-2: retro sessions now use the same secret/roomId split as team
  // boards (see crypto.js's header comment) -- a room's own id buys nothing
  // without the secret the key derives from, so this list stores both, not
  // just the routing id it used to hold back when the code WAS the key.
  // Only ever populated for "sessions/*" rooms (see getRoom()'s `remember`
  // param below) -- a board room's secret already lives in board-sync.js's
  // own TEAM_SECRET_KEY, and mixing the two lists was a real bug once
  // (see getRoom()'s own comment on why board rooms must never land here).
  // Codex review on PR #14 (P2): SEC-2 changed this list's stored shape
  // from bare code strings to {roomId, secret} objects (see this file's own
  // header comment above), but a device that saved entries under the OLDER
  // shape, before SEC-2 shipped, would otherwise hand a `{roomId:
  // undefined, secret: undefined}` pair to getRoom() -- connecting a
  // WebSocket asking the relay to route "?code=undefined" on every single
  // reload, forever, and silently failing to rediscover that session.
  //
  // Migration decision (per docs/DefinitionOfDone.md's "new data shape"
  // rule): RETIRE, don't migrate. A legacy entry's bare string WAS the
  // human-typed code itself -- there is no secret to derive it into under
  // the new shape, and a typed-code session was already short-lived by
  // design (forgotten within minutes of the retro ending). Any such saved
  // entry, by the time this ships, is for a retro that ended long ago.
  // Filtering here means it's simply never acted on again -- no crash, no
  // reconnect attempt, and no effect on any OTHER, well-formed entry
  // sitting right next to it in the same array.
  function loadKnownCodes(){
    try{
      var raw = JSON.parse(localStorage.getItem(KNOWN_CODES_KEY) || "[]");
      if(!Array.isArray(raw)) return [];
      return raw.filter(function(c){
        return c && typeof c.roomId === "string" && c.roomId && typeof c.secret === "string" && c.secret;
      });
    }catch(e){ return []; }
  }
  function rememberCode(roomId, secret){
    try{
      var codes = loadKnownCodes();
      if(!codes.some(function(c){ return c.roomId===roomId; })){
        codes.push({ roomId: roomId, secret: secret });
        localStorage.setItem(KNOWN_CODES_KEY, JSON.stringify(codes));
      }
    }catch(e){ /* localStorage unavailable -- this device just won't rediscover the session after a reload */ }
  }
  function forgetCode(roomId){
    try{
      var codes = loadKnownCodes().filter(function(c){ return c.roomId!==roomId; });
      localStorage.setItem(KNOWN_CODES_KEY, JSON.stringify(codes));
    }catch(e){ /* ditto */ }
  }
  // renderSessionCardHtml() (retro-facilitator.js) needs a session's secret
  // to build its join/co-facilitate links and QR codes -- `state.sessions`
  // itself can't carry it (it's rebuilt wholesale from the relay's own,
  // necessarily secret-less, broad snapshot on every change -- see db.js).
  // Any session this device has any business rendering a full card for was
  // necessarily reached via getRoom(roomId, secret, true) already (starting
  // it or co-facilitating it), so it's always in this same list.
  function secretForRoom(roomId){
    var entry = loadKnownCodes().filter(function(c){ return c.roomId===roomId; })[0];
    return entry ? entry.secret : null;
  }

  function isSessionPath(path){ return path.split("/")[0] === "sessions"; }
  // "boards/<roomId>[/...]" is the same wire mechanism a retro session uses
  // (see crypto.js's generateSecret()/roomIdFor()), aimed at a different
  // room namespace: an opt-in, durable, whole-board sync (see
  // board-sync.js). `roomId` is a one-way hash of a high-entropy secret
  // shared only via link/QR -- NOT the secret itself, and not user-typed.
  // The relay itself never inspects a path's meaning either way -- it just
  // routes by whatever room code opened the connection (see relay/server.js).
  function isBoardPath(path){ return path.split("/")[0] === "boards"; }
  function codeFromPath(path){ return path.split("/")[1]; }

  function deepFreezeClone(obj){
    var copy = Array.isArray(obj) ? [] : {};
    for(var k in obj){
      copy[k] = (obj[k] && typeof obj[k]==="object") ? deepFreezeClone(obj[k]) : obj[k];
    }
    return Object.freeze(copy);
  }
  function deepMerge(target, patch){
    for(var k in patch){
      if(patch[k] && typeof patch[k]==="object" && !Array.isArray(patch[k]) &&
         target[k] && typeof target[k]==="object" && !Array.isArray(target[k])){
        deepMerge(target[k], patch[k]);
      } else { target[k] = patch[k]; }
    }
    return target;
  }

  var rooms = {};

  var MAX_RECONNECT_DELAY_MS = 5000;
  var MAX_RECONNECT_ATTEMPTS = 8; // ~a few minutes of backoff, then give up loudly once, not silently forever

  // Every put/delete this device sends gets its own opId, so relay/server.js
  // can echo it back on the matching {op:"ack"}/{op:"error"} and this module
  // can resolve/reject the ONE write promise it belongs to -- see
  // relay/server.js's wire-protocol comment. A single counter shared by
  // every room is simplest and always unique; the server never interprets
  // it, just echoes it back, so there's no reason to key it per-room.
  var nextOpId = 1;

  // Rejects every write still awaiting a response for `room` -- used both
  // when giving up on the room entirely (below) and per-write when the
  // relay itself sends back a targeted {op:"error", opId}. Not exported;
  // callers just delete the room's own pendingWrites entries directly.
  function unavailableError(room){
    return { code:"unavailable", message:"Relay unavailable for room " + room.code + " -- this write did not complete." };
  }

  function giveUp(room, reason){
    room.unavailable = true;
    if(typeof diag === "function") diag("Relay unavailable for room " + room.code + ": " + reason + " -- giving up (start a new session to try again).");
    Object.keys(room.pendingWrites).forEach(function(opId){
      room.pendingWrites[opId].reject(unavailableError(room));
    });
    room.pendingWrites = {};
    room.sendQueue = []; // nothing left to flush once the room is unavailable for good
    room.resolveReady(); // unblocks anything awaiting room.ready; room.docs stays empty, which reads as "not found" everywhere that matters
    notifyEverything(room);
  }

  function connectRoom(room, keyPromise){
    var sep = RELAY_URL.indexOf("?") === -1 ? "?" : "&";
    var ws = new WebSocket(RELAY_URL + sep + "code=" + encodeURIComponent(room.code));
    room.ws = ws;
    room.wsOpen = false;

    ws.addEventListener("open", function(){
      room.wsOpen = true;
      room.reconnectDelayMs = 250; // reset backoff on a real, successful connection
      room.reconnectAttempts = 0;
      room.sendQueue.forEach(function(msg){
        ws.send(JSON.stringify(msg));
        if(msg.opId && room.pendingWrites[msg.opId]) room.pendingWrites[msg.opId].awaitingAck = true;
      });
      room.sendQueue = [];
      if(typeof diag === "function") diag("Relay connected: room " + room.code);
    });

    ws.addEventListener("message", function(evt){
      var msg;
      try{ msg = JSON.parse(evt.data); }catch(e){ return; }
      // ack/error resolve or reject a specific pending write by opId --
      // neither carries an envelope, so this needs no decryption and must
      // not wait behind keyPromise (a write's caller is often the very
      // thing awaiting keyPromise to resolve in the first place).
      if(msg.op === "ack"){
        var acked = room.pendingWrites[msg.opId];
        if(acked){ delete room.pendingWrites[msg.opId]; acked.resolve({ opId: msg.opId, path: msg.path }); }
        return;
      }
      if(msg.op === "error"){
        var rejected = msg.opId && room.pendingWrites[msg.opId];
        if(rejected){ delete room.pendingWrites[msg.opId]; rejected.reject({ code:"rejected", message: msg.message }); }
        return;
      }
      keyPromise.then(function(key){
        if(msg.op === "snapshot"){
          var paths = Object.keys(msg.docs);
          return Promise.all(paths.map(function(p){
            return SquadPulseCrypto.decrypt(key, msg.docs[p])
              .then(function(data){ room.docs[p] = data; })
              .catch(function(){ /* corrupt or foreign-key envelope -- skip this one doc */ });
          })).then(function(){
            room.resolveReady();
            notifyEverything(room);
          });
        }
        if(msg.op === "put"){
          return SquadPulseCrypto.decrypt(key, msg.envelope)
            .then(function(data){ room.docs[msg.path] = data; notifyPath(room, msg.path); })
            .catch(function(){ /* ditto */ });
        }
        if(msg.op === "delete"){
          delete room.docs[msg.path];
          notifyPath(room, msg.path);
        }
      });
    });

    // The relay is expected to be occasionally unreachable (dev forgot to
    // start it, a network blip mid-retro) -- reconnect with backoff rather
    // than give up immediately. room.ready resolves exactly once, on the
    // first successful snapshot ever received, and simply stays pending
    // (not rejected) across any number of retries before that -- callers
    // awaiting it just wait longer, which degrades better than a permanent
    // rejection would once connectivity actually returns. But "forever" has
    // to end somewhere, or a relay that's genuinely gone (wrong URL, never
    // deployed) spams the diagnostic log once every few seconds without
    // limit -- after MAX_RECONNECT_ATTEMPTS, stop and say so once.
    ws.addEventListener("close", function(){
      room.wsOpen = false;
      if(room.unavailable) return;
      // Any write that was actually sent on this now-dead socket will never
      // get an ack from it -- requeue it (same sendQueue a write made while
      // still disconnected already goes through) so the next successful
      // open resends it. Safe to resend unconditionally: put/delete are
      // both full-replace/remove-by-path, so a write that actually landed
      // just before the drop gets harmlessly reapplied, not duplicated.
      Object.keys(room.pendingWrites).forEach(function(opId){
        var pw = room.pendingWrites[opId];
        if(pw.awaitingAck){ pw.awaitingAck = false; room.sendQueue.push(pw.msg); }
      });
      room.reconnectAttempts++;
      if(room.reconnectAttempts > MAX_RECONNECT_ATTEMPTS){
        giveUp(room, "could not reach " + RELAY_URL + " after " + room.reconnectAttempts + " attempts");
        return;
      }
      if(typeof diag === "function") diag("Relay disconnected: room " + room.code + " -- reconnecting in " + room.reconnectDelayMs + "ms (attempt " + room.reconnectAttempts + "/" + MAX_RECONNECT_ATTEMPTS + ")");
      setTimeout(function(){ if(!room.unavailable) connectRoom(room, keyPromise); }, room.reconnectDelayMs);
      room.reconnectDelayMs = Math.min(room.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    });
    ws.addEventListener("error", function(){ /* the close handler above still fires and retries/gives up */ });
  }

  // `secret` is what the encryption key derives from -- board rooms and,
  // since SEC-2, session rooms too (see crypto.js's header comment):
  // `code` is a one-way hash of the real secret, safe to use for routing
  // since it can't be run backward, while `secret` never touches this room
  // object's own `code` field or anything sent to the relay.
  //
  // `remember`, when true, persists {roomId: code, secret: secret} to this
  // device's own knownCodes list (see rememberCode() above) so
  // subscribeBroadSessions() can reconnect to it after a reload. Callers
  // pass this based on the PATH, not on whether a secret was given (see
  // docRef/collRef below) -- board rooms must never land in this list. A
  // board room's own room id landing here let subscribeBroadSessions's
  // blind reconnect loop create THIS room FIRST on a later page load,
  // before board-sync.js's own correctly-secreted call ever ran -- and
  // since the room object created by whichever call runs first is what
  // every later getRoom(code) call for that code reuses (the cache check
  // just above), a wrong key stuck for the rest of the page's life. Found
  // exactly this way: two team-synced devices, after either one had ever
  // joined a retro session and then reloaded, could no longer decrypt each
  // other's board pushes at all.
  function makeRoom(code, secret){
    var room = {
      code: code, secret: secret, docs: {},
      ws: null, wsOpen: false, sendQueue: [],
      collListeners: [], docListeners: [],
      ready: null, reconnectDelayMs: 250, reconnectAttempts: 0,
      unavailable: false,
      pendingWrites: {} // opId -> {resolve, reject, msg, awaitingAck} -- see sendTracked()
    };
    room.ready = new Promise(function(res){ room.resolveReady = res; });
    return room;
  }

  // REF-6 (STATUS.md's "Code quality & refactoring backlog"): a cache hit
  // above used to return `rooms[code]` unconditionally, without ever
  // checking that THIS caller's secret matches the secret the cached room
  // was actually derived from -- a second caller for the same routing code
  // but a DIFFERENT secret silently got back the first caller's room,
  // decrypting/encrypting under a key that was never theirs, with zero
  // error and zero diagnostic.
  //
  // Only an EXPLICIT, truthy `secret` argument is checked against the
  // cache -- a call that passes none at all is trusting whatever's already
  // open for this code, not making a claim about what the key should be.
  // That's not a hypothetical: `retro-facilitator.js`'s reveal-mode/status/
  // experiment-note updates all go through
  // `state.db.collection("sessions").doc(sessionId).update(...)` with NO
  // secret argument, by design -- they only ever run against a session
  // this exact device already opened correctly (via
  // coFacilitateSessionByCode()/startSession()), and rely on getRoom()
  // reusing that already-connected room. Comparing `secret || code`
  // (the actual key-derivation input) against every such call would treat
  // its own room as a "mismatch" the instant a caller upstream omitted the
  // secret -- confirmed as a real regression this fix introduced and then
  // removed: test_cofacilitator_join.py's reveal-mode step failed against
  // an earlier version of this fix that compared `secret || code`
  // unconditionally.
  function getRoom(code, secret, remember){
    var cached = rooms[code];
    if(cached){
      if(secret && cached.secret !== secret){
        // Deliberately NOT stored in `rooms[code]` -- overwriting the cache
        // here would apply the SAME bug in the other direction, clobbering
        // the legitimate owner's still-good room the next time THEY call
        // getRoom(code, ...). Return a fresh, dedicated, already-unavailable
        // room instead: same shape every other getRoom() failure path
        // already returns (see the "no relay configured"/malformed-URL
        // branches below), so docRef()/collRef() need no special case --
        // `.get()` resolves `{exists:false, unavailable:true}`, exactly
        // like any other unavailable room.
        var mismatchRoom = makeRoom(code, secret);
        giveUp(mismatchRoom, "requested with a secret that doesn't match the room already cached for routing code \"" + code + "\" -- refusing to silently decrypt/encrypt under the wrong key");
        return mismatchRoom;
      }
      return cached;
    }
    if(remember) rememberCode(code, secret);

    var room = makeRoom(code, secret || code);
    rooms[code] = room;

    if(!RELAY_URL){
      // Nothing to connect to at all -- e.g. deployed with no relay
      // configured. Don't attempt a WebSocket (on a real deployment,
      // "ws://localhost:8787" means the VISITOR'S OWN machine -- Chrome
      // flags that cross-context request with a private-network permission
      // prompt for a connection that could never succeed anyway). Fail
      // fast and clearly instead of spamming reconnect attempts.
      giveUp(room, "no relay configured (SQUAD_PULSE_RELAY_URL unset)");
      return room;
    }

    // A malformed SQUAD_PULSE_RELAY_URL (real example: "was://..." instead
    // of "wss://...", a one-letter typo in a Vercel env var) makes `new
    // WebSocket(...)` throw a SyntaxError SYNCHRONOUSLY -- before any of
    // this module's own error handling runs -- which previously left the
    // "Start retro session" button disabled forever with nothing in
    // Diagnostics to explain why. Check the scheme up front so a bad URL
    // fails the same clean, catchable way "no relay configured" does.
    if(!/^wss?:\/\//i.test(RELAY_URL)){
      giveUp(room, "SQUAD_PULSE_RELAY_URL is not a valid ws:// or wss:// URL: " + RELAY_URL);
      return room;
    }

    var keyPromise = SquadPulseCrypto.deriveKey(room.secret);
    room.keyPromise = keyPromise; // putDoc() below reuses this rather than re-deriving
    connectRoom(room, keyPromise);

    return room;
  }

  // Sends `msg` (a put or delete) and returns a promise that resolves only
  // once the relay actually ACKS it -- not once it's merely handed to the
  // WebSocket, and not once it's merely queued for later. This is the
  // completion contract putDoc()/deleteDoc() need: without it, a caller
  // awaiting a write has no real signal that a fresh connection elsewhere
  // would actually see it yet (see relay/server.js's wire-protocol comment
  // and tests/test_relay_write_acknowledgment.py for the bug this replaces
  // -- a fixed sleep guessing how long the write "probably" takes).
  //
  // `room.sendQueue` is reused for both cases a message isn't currently
  // going out over an open socket: queued before the FIRST connection ever
  // opens, and requeued after a later disconnect for a write that was sent
  // but never acked (see connectRoom()'s close handler below) -- put/delete
  // are both full-replace/remove-by-path, so resending the identical
  // message on reconnect is always safe, never a duplicate-application risk.
  function sendTracked(room, msg){
    return new Promise(function(resolve, reject){
      var opId = String(nextOpId++);
      msg.opId = opId;
      room.pendingWrites[opId] = { resolve: resolve, reject: reject, msg: msg, awaitingAck: false };
      if(room.wsOpen){
        room.ws.send(JSON.stringify(msg));
        room.pendingWrites[opId].awaitingAck = true;
      } else {
        room.sendQueue.push(msg);
      }
    });
  }

  function putDoc(room, path, data){
    room.docs[path] = data; // optimistic local update, same "latency compensation" the rest of the app already assumes
    notifyPath(room, path);
    // A session doc moving to status:"closed" (retro.js's closeSession(),
    // an update not a delete -- see below) means this device no longer
    // needs to keep reconnecting to it after a reload the way an actually
    // OPEN session does; forgetting it here, the moment the transition is
    // observed, is what keeps subscribeBroadSessions() from accumulating
    // one live WebSocket per session this device has EVER started.
    if(path === "sessions/" + room.code && data && data.status === "closed") forgetCode(room.code);
    return room.keyPromise.then(function(key){
      return SquadPulseCrypto.encrypt(key, data);
    }).then(function(envelope){
      return sendTracked(room, { op:"put", path: path, envelope: envelope });
    });
  }
  function deleteDoc(room, path){
    delete room.docs[path];
    notifyPath(room, path);
    if(path === "sessions/" + room.code) forgetCode(room.code);
    return sendTracked(room, { op:"delete", path: path });
  }

  function buildSnapshot(room, collectionPath){
    var docs = [];
    Object.keys(room.docs).forEach(function(path){
      if(path.indexOf(collectionPath + "/") === 0){
        var id = path.slice(collectionPath.length + 1);
        if(id.indexOf("/") !== -1) return; // not a direct child
        docs.push({ id: id, exists:true, data: function(){ return deepFreezeClone(room.docs[path]); } });
      }
    });
    docs.sort(function(a,b){ return (a.data().order||0) - (b.data().order||0); });
    return { docs: docs, size: docs.length, empty: docs.length===0, metadata: { fromCache:false, hasPendingWrites:false } };
  }

  function notifyPath(room, path){
    room.docListeners.filter(function(l){ return l.path===path; }).forEach(function(l){
      var d = room.docs[path];
      l.cb({ id: path.split("/").pop(), exists: !!d, unavailable: !!room.unavailable, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
    });
    room.collListeners.forEach(function(l){
      if(path.indexOf(l.path + "/") === 0) l.cb(buildSnapshot(room, l.path));
    });
    if(path === "sessions/" + room.code) notifyBroadListeners();
  }
  function notifyEverything(room){
    room.docListeners.forEach(function(l){
      var d = room.docs[l.path];
      l.cb({ id: l.path.split("/").pop(), exists: !!d, unavailable: !!room.unavailable, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
    });
    room.collListeners.forEach(function(l){ l.cb(buildSnapshot(room, l.path)); });
    notifyBroadListeners();
  }

  function docRef(path, secret){
    var room = getRoom(codeFromPath(path), secret, isSessionPath(path));
    return {
      id: path.split("/").pop(), path: path,
      get: function(){
        return room.ready.then(function(){
          var d = room.docs[path];
          return { id: path.split("/").pop(), exists: !!d, unavailable: !!room.unavailable, data: function(){ return d; } };
        });
      },
      set: function(data){
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          return putDoc(room, path, data);
        });
      },
      update: function(patch){
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          if(!room.docs[path]) return Promise.reject({ code:"invalid_argument", message:"doc missing" });
          deepMerge(room.docs[path], patch);
          return putDoc(room, path, room.docs[path]);
        });
      },
      delete: function(){
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          return deleteDoc(room, path);
        });
      },
      collection: function(sub){ return collRef(path + "/" + sub, secret); },
      onSnapshot: function(next, err){
        var l = { path: path, cb: next };
        room.docListeners.push(l);
        room.ready.then(function(){
          var d = room.docs[path];
          next({ id: path.split("/").pop(), exists: !!d, unavailable: !!room.unavailable, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
        });
        return function(){ room.docListeners = room.docListeners.filter(function(x){ return x!==l; }); };
      }
    };
  }

  function collRef(path, secret){
    var codeHere = codeFromPath(path); // undefined for the bare "sessions" collection
    return {
      path: path,
      doc: function(id){ return docRef(path + "/" + (id || ("auto"+Math.random().toString(36).slice(2))), secret); },
      add: function(data){
        var id = "auto"+Math.random().toString(36).slice(2);
        var room = getRoom(codeHere, secret, isSessionPath(path));
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          return putDoc(room, path+"/"+id, data).then(function(){ return docRef(path+"/"+id, secret); });
        });
      },
      orderBy: function(){ return this; }, where: function(){ return this; }, limit: function(){ return this; },
      get: function(){
        if(codeHere){
          var room = getRoom(codeHere, secret, isSessionPath(path));
          return room.ready.then(function(){ return buildSnapshot(room, path); });
        }
        return Promise.resolve(broadSessionsSnapshot());
      },
      onSnapshot: function(next, err){
        if(codeHere){
          var room = getRoom(codeHere, secret, isSessionPath(path));
          var l = { path: path, cb: next };
          room.collListeners.push(l);
          room.ready.then(function(){ next(buildSnapshot(room, path)); });
          return function(){ room.collListeners = room.collListeners.filter(function(x){ return x!==l; }); };
        }
        return subscribeBroadSessions(next);
      }
    };
  }

  // The one broad, code-less call: db.collection("sessions").onSnapshot(...),
  // used by a facilitator's own device (not in join mode) to notice its own
  // already-open session after a reload -- see openSessionForSquad() in
  // retro.js. There is no relay "list all rooms" operation (a room is only
  // ever reachable by knowing its code), so this reconstructs the list from
  // codes THIS device has itself started or opened before, persisted in
  // localStorage (rememberCode/forgetCode above). It will not discover a
  // session some other device started -- by design, per the "board data
  // doesn't sync across devices, only an open session's own content does"
  // scope for this step.
  function broadSessionsSnapshot(){
    var docs = [];
    loadKnownCodes().forEach(function(entry){
      var room = rooms[entry.roomId];
      var d = room && room.docs["sessions/"+entry.roomId];
      if(d) docs.push({ id: entry.roomId, exists:true, data: function(){ return deepFreezeClone(d); } });
    });
    return { docs: docs, size: docs.length, empty: docs.length===0, metadata: { fromCache:false, hasPendingWrites:false } };
  }
  // Registered in the module-wide `broadListeners`, not any one room's own
  // listener list -- a code this device starts caring about AFTER this
  // subscription is already active (e.g. the retro about to be started)
  // still needs to reach it. notifyPath/notifyEverything call
  // notifyBroadListeners() on every relevant change in every room, which is
  // what actually makes that work; this function's own job is just to
  // (re)connect every currently-known room so their changes have somewhere
  // to report to.
  function subscribeBroadSessions(next){
    var cb = function(){ next(broadSessionsSnapshot()); };
    broadListeners.push(cb);
    loadKnownCodes().forEach(function(entry){ getRoom(entry.roomId, entry.secret, true); });
    cb();
    return function(){ broadListeners = broadListeners.filter(function(x){ return x!==cb; }); };
  }

  // rememberCode is also exported directly (not just used internally by
  // getRoom()'s own `remember` param) -- retro-facilitator.js calls it
  // explicitly the moment it generates/resolves a session's secret, so the
  // {roomId, secret} pairing is recorded even when `state.db` isn't this
  // module at all (e.g. the Playwright suite's fake local store, which
  // implements its own doc()/collection() and never touches getRoom()).
  // Relying only on getRoom()'s implicit side effect would leave
  // secretForRoom() with nothing to find in that case.
  return { isSessionPath: isSessionPath, isBoardPath: isBoardPath, doc: docRef, collection: collRef, secretForRoom: secretForRoom, rememberCode: rememberCode };
})();
