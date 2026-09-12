/* Standalone (outside-Claude-Artifact) replacement for `window.claude`.
   app.js is written against a Firestore-shaped `db` capability
   (collection/doc/get/set/update/delete/add/onSnapshot) plus a `downloads`
   capability -- both only exist inside a Claude Artifact sandbox. Deployed
   on Vercel (or opened as a plain static site) neither exists, so app.js's
   own guards (`window.claude && window.claude.use`) fall through to
   local-only preview mode with nothing persisted.

   This file only installs a shim when no real `window.claude` is present
   (Claude Artifact previews, and the Playwright test harness's own
   fake_store.html, both set `window.claude` themselves and take priority --
   see build_page.py, which splices fake_store.html in *after* this script).

   Per STATUS.md's locked-in decision, there is still no server-side
   database for the BOARD here: squads/dimensions/templates/config are
   backed by this browser's own localStorage, so a facilitator's board
   persists across reloads on their machine exactly as Excalidraw's
   local-first model intends, and does NOT sync across devices (other tabs
   of the *same* browser do, via the native `storage` event).

   A retro SESSION is different: any path rooted at "sessions" is routed to
   SquadPulseRelay (relay-client.js + crypto.js, loaded before this file)
   instead of localStorage, so a session's live state actually syncs across
   real devices through the encrypted relay in docs/standalone-plan.md. This
   is the one `db` router in the app: everything else below is unchanged
   localStorage logic. */
(function(){
  "use strict";
  if (window.claude && typeof window.claude.use === "function") return;

  var STORAGE_KEY = "squadpulse:db:v1";
  var STORE = {};
  var LISTENERS = [];
  var DOC_LISTENERS = [];

  // Mirrors app.js's own PLACEHOLDER_SQUADS / PLACEHOLDER_DIMENSIONS /
  // DEFAULT_CONFIG so a first-time visitor sees the same working demo board
  // the Claude Artifact prototype was seeded with, instead of an empty one.
  // Deliberately duplicated rather than imported: this only runs once, to
  // populate localStorage the first time, and app.js's copies remain the
  // source of truth for local-only preview mode (db capability unavailable).
  function seedIfEmpty(){
    if (Object.keys(STORE).length) return;
    for (var i=1;i<=3;i++){
      STORE["squads/squad-"+i] = { name:"Squad "+i, order:i, dimensions:{}, updatedAt: new Date().toISOString() };
    }
    var dims = [
      ["release","Easy to release",1,"Releasing is routine, low-risk, and low-drama.","Releases are rare, risky, or dreaded events."],
      ["process","Suitable process",2,"Our way of working fits us, and we can tune it ourselves.","Process feels imposed, bureaucratic, or mismatched to how we work."],
      ["techquality","Tech quality",3,"We're proud of our codebase and engineering practices.","Quality is a constant source of pain and slow-down."],
      ["value","Value",4,"What we ship clearly matters to users and the business.","We're not confident our work is moving the needle."],
      ["speed","Speed",5,"We get things done quickly, without cutting corners.","Progress feels slow and heavy."],
      ["mission","Mission",6,"We know why we exist and where we're headed.","The mission is vague, or keeps shifting under us."],
      ["fun","Fun",7,"We genuinely enjoy working together.","Coming to work feels like a grind."],
      ["learning","Learning",8,"We're growing, trying new things, and sharing what we learn.","We're stagnant — same patterns, no time to learn."],
      ["support","Support",9,"We get the help we need, when we need it, from the org around us.","We're on our own — blocked, or ignored."],
      ["pawns","Pawns or players",10,"We help decide what to build and how.","We just execute a backlog someone else wrote."],
      ["teamwork","Teamwork",11,"We function as one team, not a collection of individuals.","We're fragmented, siloed, or in open conflict."],
      ["codebase","Codebase health",12,"The codebase is something we can safely and confidently change.","Every change feels risky, brittle, or full of surprises."]
    ];
    dims.forEach(function(d){
      STORE["dimensions/"+d[0]] = { label:d[1], order:d[2], green:d[3], red:d[4] };
    });
    STORE["meta/config"] = {
      unit:"Squad", unitPlural:"Squads", activeTemplateName:"Spotify Squad Health Check",
      attribution:"Dimensions adapted from the Spotify Squad Health Check model (Henrik Kniberg & Spotify, via Ben Linders’ agile self-assessment survey). Scoring, weighting and the investment ranking here are Dr. Agile’s own.",
      updatedAt: new Date().toISOString()
    };
    persist();
  }

  function load(){
    try{
      var raw = window.localStorage.getItem(STORAGE_KEY);
      STORE = raw ? JSON.parse(raw) : {};
    }catch(e){ STORE = {}; }
  }
  function persist(){
    try{ window.localStorage.setItem(STORAGE_KEY, JSON.stringify(STORE)); }catch(e){ /* storage unavailable/full -- state stays in-memory for this tab */ }
  }

  function deepFreezeClone(obj){
    var copy = Array.isArray(obj) ? [] : {};
    for (var k in obj){
      copy[k] = (obj[k] && typeof obj[k]==="object") ? deepFreezeClone(obj[k]) : obj[k];
    }
    return Object.freeze(copy);
  }
  function deepMerge(target, patch){
    for (var k in patch){
      if (patch[k] && typeof patch[k]==="object" && !Array.isArray(patch[k]) &&
          target[k] && typeof target[k]==="object" && !Array.isArray(target[k])){
        deepMerge(target[k], patch[k]);
      } else { target[k] = patch[k]; }
    }
    return target;
  }
  function notify(collectionPath){
    LISTENERS.filter(function(l){ return l.collectionPath===collectionPath; }).forEach(function(l){
      l.cb(buildSnapshot(collectionPath));
    });
  }
  function notifyDoc(path){
    DOC_LISTENERS.filter(function(l){ return l.docPath===path; }).forEach(function(l){
      var d = STORE[path];
      l.cb({ id: path.split("/").pop(), exists: !!d, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
    });
  }
  function notifyEverything(){
    var seen = {};
    LISTENERS.forEach(function(l){ if(!seen["c:"+l.collectionPath]){ seen["c:"+l.collectionPath]=1; notify(l.collectionPath); } });
    DOC_LISTENERS.forEach(function(l){ if(!seen["d:"+l.docPath]){ seen["d:"+l.docPath]=1; notifyDoc(l.docPath); } });
  }
  function buildSnapshot(collectionPath){
    var docs = [];
    Object.keys(STORE).forEach(function(path){
      if (path.indexOf(collectionPath+"/")===0){
        var id = path.slice(collectionPath.length+1);
        if (id.indexOf("/") !== -1) return;
        docs.push({ id: id, exists:true, data: function(){ return deepFreezeClone(STORE[path]); } });
      }
    });
    docs.sort(function(a,b){ return (a.data().order||0)-(b.data().order||0); });
    return { docs: docs, size:docs.length, empty:docs.length===0, metadata:{fromCache:false,hasPendingWrites:false} };
  }
  function localDocRef(path){
    return {
      id: path.split("/").pop(), path: path,
      get: function(){ var d = STORE[path]; return Promise.resolve({ id:this.id, exists: !!d, data: function(){ return d; } }); },
      set: function(data){ STORE[path]=data; persist(); notify(path.split("/").slice(0,-1).join("/")); notifyDoc(path); return Promise.resolve(); },
      update: function(patch){
        if (!STORE[path]) return Promise.reject({code:"invalid_argument", message:"doc missing"});
        deepMerge(STORE[path], patch);
        persist();
        notify(path.split("/").slice(0,-1).join("/")); notifyDoc(path);
        return Promise.resolve();
      },
      delete: function(){ delete STORE[path]; persist(); notify(path.split("/").slice(0,-1).join("/")); notifyDoc(path); return Promise.resolve(); },
      collection: function(sub){ return localCollRef(path+"/"+sub); },
      onSnapshot: function(next, err){
        var l = { docPath: path, cb: next };
        DOC_LISTENERS.push(l);
        setTimeout(function(){
          var d = STORE[path];
          next({ id: path.split("/").pop(), exists: !!d, data: function(){ return d ? deepFreezeClone(d) : undefined; } });
        }, 0);
        return function(){ DOC_LISTENERS = DOC_LISTENERS.filter(function(x){ return x!==l; }); };
      }
    };
  }
  function localCollRef(path){
    return {
      path: path,
      doc: function(id){ return localDocRef(path+"/"+(id|| ("auto"+Math.random().toString(36).slice(2)) )); },
      add: function(data){ var id = "auto"+Math.random().toString(36).slice(2); STORE[path+"/"+id]=data; persist(); notify(path); return Promise.resolve(localDocRef(path+"/"+id)); },
      orderBy: function(){ return this; }, where: function(){ return this; }, limit: function(){ return this; },
      get: function(){ return Promise.resolve(buildSnapshot(path)); },
      onSnapshot: function(next, err){
        var l = { collectionPath: path, cb: next };
        LISTENERS.push(l);
        setTimeout(function(){ next(buildSnapshot(path)); }, 0);
        return function(){ LISTENERS = LISTENERS.filter(function(x){ return x!==l; }); };
      }
    };
  }

  // Routes any "sessions"-rooted path to the encrypted relay client instead
  // of localStorage (see the file header comment); everything else keeps
  // going to the local board store, unchanged. Falls back to the local
  // store if relay-client.js somehow isn't loaded, rather than throwing.
  function routedDocRef(path){
    if(window.SquadPulseRelay && window.SquadPulseRelay.isSessionPath(path)) return window.SquadPulseRelay.doc(path);
    return localDocRef(path);
  }
  function routedCollRef(path){
    if(window.SquadPulseRelay && window.SquadPulseRelay.isSessionPath(path)) return window.SquadPulseRelay.collection(path);
    return localCollRef(path);
  }

  load();
  seedIfEmpty();

  // Another tab of the same browser wrote a change -- pick it up and
  // re-fire whatever this tab currently has listeners on. There's no way
  // to know from a bare `storage` event which paths actually changed, and
  // this app's data is small, so just re-check everything.
  window.addEventListener("storage", function(e){
    if (e.key !== STORAGE_KEY) return;
    load();
    notifyEverything();
  });

  function triggerBrowserDownload(filename, data){
    var blob = new Blob([data], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  window.claude = {
    use: function(name){
      if (name === "db") return Promise.resolve({ doc: routedDocRef, collection: routedCollRef });
      if (name === "downloads") return Promise.resolve({ save: function(opts){ triggerBrowserDownload(opts.filename, opts.data); return Promise.resolve(); } });
      return Promise.resolve(null);
    }
  };
})();
