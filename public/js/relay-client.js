"use strict";

// Client for the Squad Pulse relay (relay/server.js) -- presents the exact
// same Firestore-shaped surface (collection()/doc() with
// get/set/update/delete/add/onSnapshot) that local-store.js already gives
// the rest of the app, so db.js and everything upstream of it needs zero
// changes. Only paths rooted at "sessions" are ever routed here (see the
// SquadPulseRelay.isSessionPath check local-store.js uses) -- squads,
// dimensions, templates, and config stay on localStorage per the "no
// persistent multi-tenant board database, ever" decision in STATUS.md.
//
// Every doc this module sends or receives over the wire is an encrypted
// {iv, ct} envelope (see crypto.js) -- room.docs below holds the DECRYPTED
// plaintext once unwrapped, exactly mirroring what fake_store.html's STORE
// and local-store.js's STORE hold, just kept in memory per room instead of
// in one flat localStorage blob.
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

  function loadKnownCodes(){
    try{ return JSON.parse(localStorage.getItem(KNOWN_CODES_KEY) || "[]"); }catch(e){ return []; }
  }
  function rememberCode(code){
    try{
      var codes = loadKnownCodes();
      if(codes.indexOf(code) === -1){ codes.push(code); localStorage.setItem(KNOWN_CODES_KEY, JSON.stringify(codes)); }
    }catch(e){ /* localStorage unavailable -- this device just won't rediscover the session after a reload */ }
  }
  function forgetCode(code){
    try{
      var codes = loadKnownCodes().filter(function(c){ return c!==code; });
      localStorage.setItem(KNOWN_CODES_KEY, JSON.stringify(codes));
    }catch(e){ /* ditto */ }
  }

  function isSessionPath(path){ return path.split("/")[0] === "sessions"; }
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

  function giveUp(room, reason){
    room.unavailable = true;
    if(typeof diag === "function") diag("Relay unavailable for room " + room.code + ": " + reason + " -- giving up (start a new session to try again).");
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
      room.sendQueue.forEach(function(msg){ ws.send(JSON.stringify(msg)); });
      room.sendQueue = [];
      if(typeof diag === "function") diag("Relay connected: room " + room.code);
    });

    ws.addEventListener("message", function(evt){
      var msg;
      try{ msg = JSON.parse(evt.data); }catch(e){ return; }
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

  function getRoom(code){
    if(rooms[code]) return rooms[code];
    rememberCode(code);

    var room = {
      code: code, docs: {},
      ws: null, wsOpen: false, sendQueue: [],
      collListeners: [], docListeners: [],
      ready: null, reconnectDelayMs: 250, reconnectAttempts: 0,
      unavailable: false
    };
    rooms[code] = room;
    room.ready = new Promise(function(res){ room.resolveReady = res; });

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

    var keyPromise = SquadPulseCrypto.deriveKey(code);
    connectRoom(room, keyPromise);

    return room;
  }

  function send(room, msg){
    if(room.wsOpen) room.ws.send(JSON.stringify(msg));
    else room.sendQueue.push(msg);
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
    SquadPulseCrypto.deriveKey(room.code).then(function(key){
      return SquadPulseCrypto.encrypt(key, data);
    }).then(function(envelope){
      send(room, { op:"put", path: path, envelope: envelope });
    });
  }
  function deleteDoc(room, path){
    delete room.docs[path];
    notifyPath(room, path);
    send(room, { op:"delete", path: path });
    if(path === "sessions/" + room.code) forgetCode(room.code);
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

  function unavailableError(room){
    return { code:"unavailable", message:"Relay unavailable for room " + room.code + " -- this write was never sent." };
  }

  function docRef(path){
    var room = getRoom(codeFromPath(path));
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
          putDoc(room, path, data);
        });
      },
      update: function(patch){
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          if(!room.docs[path]) return Promise.reject({ code:"invalid_argument", message:"doc missing" });
          deepMerge(room.docs[path], patch);
          putDoc(room, path, room.docs[path]);
        });
      },
      delete: function(){
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          deleteDoc(room, path);
        });
      },
      collection: function(sub){ return collRef(path + "/" + sub); },
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

  function collRef(path){
    var codeHere = codeFromPath(path); // undefined for the bare "sessions" collection
    return {
      path: path,
      doc: function(id){ return docRef(path + "/" + (id || ("auto"+Math.random().toString(36).slice(2)))); },
      add: function(data){
        var id = "auto"+Math.random().toString(36).slice(2);
        var room = getRoom(codeHere);
        return room.ready.then(function(){
          if(room.unavailable) return Promise.reject(unavailableError(room));
          putDoc(room, path+"/"+id, data); return docRef(path+"/"+id);
        });
      },
      orderBy: function(){ return this; }, where: function(){ return this; }, limit: function(){ return this; },
      get: function(){
        if(codeHere){
          var room = getRoom(codeHere);
          return room.ready.then(function(){ return buildSnapshot(room, path); });
        }
        return Promise.resolve(broadSessionsSnapshot());
      },
      onSnapshot: function(next, err){
        if(codeHere){
          var room = getRoom(codeHere);
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
    loadKnownCodes().forEach(function(code){
      var room = rooms[code];
      var d = room && room.docs["sessions/"+code];
      if(d) docs.push({ id: code, exists:true, data: function(){ return deepFreezeClone(d); } });
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
    loadKnownCodes().forEach(function(code){ getRoom(code); });
    cb();
    return function(){ broadListeners = broadListeners.filter(function(x){ return x!==cb; }); };
  }

  return { isSessionPath: isSessionPath, doc: docRef, collection: collRef };
})();
