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

   Squads/dimensions/templates/config are backed by this browser's own
   localStorage, so a facilitator's board persists across reloads on their
   machine exactly as Excalidraw's local-first model intends -- that part is
   unchanged. What DOES sync across devices, by default (see STATUS.md's
   "Board sync"): a retro SESSION's live state, and now the whole board too,
   both routed to SquadPulseRelay (relay-client.js + crypto.js, loaded
   before this file) instead of localStorage -- any path rooted at
   "sessions" (a session) or "boards" (a synced team board) goes there
   instead, over the same encrypted relay described in
   docs/standalone-plan.md. This is the one `db` router in the app:
   everything else below is unchanged localStorage logic. */
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
    // Hebrew translation (5th element) duplicates state.js's own
    // SPOTIFY_DIMENSIONS_HE -- this file loads BEFORE state.js (see
    // index.html's script order) and already deliberately duplicates every
    // other piece of seed data it mirrors (see this file's own header
    // comment), so referencing state.js's copy isn't an option. Kept here
    // so a BRAND NEW board -- seeded here, never explicitly (re)loaded via
    // the Templates modal -- still shows a translated grid the moment
    // someone switches to Hebrew, same as state.js's localizedDimText()
    // gives any Spotify-template dimension everywhere else (the exact gap
    // Story 5 originally fixed, now re-guarded here after the bilingual-
    // dimensions redesign moved translation onto the dimension itself
    // instead of a value-matched template lookup).
    var dims = [
      ["release","Easy to release",1,"Releasing is routine, low-risk, and low-drama.","Releases are rare, risky, or dreaded events.",
        "קלות שחרור לפרודקשן","השחרור הוא שגרתי, בסיכון נמוך וללא דרמה.","שחרורים הם נדירים, מסוכנים, או מעוררי חשש."],
      ["process","Suitable process",2,"Our way of working fits us, and we can tune it ourselves.","Process feels imposed, bureaucratic, or mismatched to how we work.",
        "תהליך עבודה מתאים","צורת העבודה שלנו מתאימה לנו, ואנחנו יכולים לכוונן אותה בעצמנו.","התהליך מרגיש כפוי, בירוקרטי, או לא תואם לאופן שבו אנחנו עובדים."],
      ["techquality","Tech quality",3,"We're proud of our codebase and engineering practices.","Quality is a constant source of pain and slow-down.",
        "איכות טכנולוגית","אנחנו גאים בקוד ובשיטות העבודה ההנדסיות שלנו.","האיכות היא מקור מתמשך לכאב ולהאטה."],
      ["value","Value",4,"What we ship clearly matters to users and the business.","We're not confident our work is moving the needle.",
        "ערך","ברור שמה שאנחנו משחררים חשוב למשתמשים ולעסק.","אנחנו לא בטוחים שהעבודה שלנו באמת מקדמת משהו."],
      ["speed","Speed",5,"We get things done quickly, without cutting corners.","Progress feels slow and heavy.",
        "מהירות","אנחנו מספקים דברים במהירות, בלי לקצר תהליכים.","ההתקדמות מרגישה איטית וכבדה."],
      ["mission","Mission",6,"We know why we exist and where we're headed.","The mission is vague, or keeps shifting under us.",
        "משימה","אנחנו יודעים לשם מה אנחנו קיימים ולאן אנחנו הולכים.","המשימה מעורפלת, או משתנה כל הזמן."],
      ["fun","Fun",7,"We genuinely enjoy working together.","Coming to work feels like a grind.",
        "כיף","אנחנו נהנים באמת לעבוד ביחד.","להגיע לעבודה מרגיש כמו התשה."],
      ["learning","Learning",8,"We're growing, trying new things, and sharing what we learn.","We're stagnant — same patterns, no time to learn.",
        "למידה","אנחנו מתפתחים, מנסים דברים חדשים, ומשתפים את מה שאנחנו לומדים.","אנחנו קופאים על השמרים — אותם דפוסים, בלי זמן ללמוד."],
      ["support","Support",9,"We get the help we need, when we need it, from the org around us.","We're on our own — blocked, or ignored.",
        "תמיכה","אנחנו מקבלים את העזרה שאנחנו צריכים, בזמן שאנחנו צריכים אותה, מהארגון שסביבנו.","אנחנו לבד — חסומים, או מתעלמים מאיתנו."],
      ["pawns","Pawns or players",10,"We help decide what to build and how.","We just execute a backlog someone else wrote.",
        "שחקנים או כלים במשחק","אנחנו עוזרים להחליט מה לבנות ואיך.","אנחנו רק מבצעים בקלוג שמישהו אחר כתב."],
      ["teamwork","Teamwork",11,"We function as one team, not a collection of individuals.","We're fragmented, siloed, or in open conflict.",
        "עבודת צוות","אנחנו מתפקדים כצוות אחד, לא כאוסף של יחידים.","אנחנו מפוצלים, מבודדים, או בקונפליקט גלוי."],
      ["codebase","Codebase health",12,"The codebase is something we can safely and confidently change.","Every change feels risky, brittle, or full of surprises.",
        "בריאות בסיס הקוד","בסיס הקוד הוא משהו שאנחנו יכולים לשנות בבטחה ובביטחון.","כל שינוי מרגיש מסוכן, שביר, או מלא בהפתעות."]
    ];
    dims.forEach(function(d){
      STORE["dimensions/"+d[0]] = { label:d[1], order:d[2], green:d[3], red:d[4],
        i18n: { he: { label:d[5], green:d[6], red:d[7] } } };
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
  // PERF-1 (STATUS.md's "Runtime performance backlog"): the native
  // `storage` event fires once per localStorage WRITE, not once per path
  // that actually changed -- a bare "reload everything and notify every
  // listener" response (the old notifyEverything(), now replaced by this)
  // re-fires every squads/dimensions/config listener even when only ONE of
  // them genuinely changed. db.js's listeners each unconditionally
  // re-render AND call pushBoardSnapshotIfConnected() (board-sync.js) on
  // every fire -- so a no-op echo of data this tab already has still
  // produces a BRAND NEW board push (a fresh nowIso() timestamp) back to
  // the relay. With a live subscription open (board sync is default-on),
  // that push echoes back as a "newer" remote snapshot, gets applied
  // locally, writes local docs again, fires another `storage` event in the
  // OTHER tab sharing this origin's localStorage -- and the cycle repeats
  // forever between any two tabs sharing storage, pinning both renderer
  // processes at 100%+ CPU while sitting completely idle (confirmed: one
  // became unresponsive to browser automation entirely). Comparing each
  // listener's own path against what this tab already had, BEFORE load()
  // overwrote it, and only notifying paths that actually changed breaks
  // the loop at its root: an echo of already-known data now produces zero
  // renders and zero pushes, while a genuine edit (the data really does
  // differ) still notifies exactly as before.
  function pathChanged(oldStore, path){
    // STORE only ever holds plain JSON-shaped data (persist() itself goes
    // through JSON.stringify) -- comparing serialized form is a correct
    // deep-equality check here, not just a reference check, and matches
    // the same JSON-round-trip comparison pattern board-sync.js's own
    // plainClone() already relies on elsewhere in this app.
    return JSON.stringify(oldStore[path]) !== JSON.stringify(STORE[path]);
  }
  function notifyChangedSince(oldStore){
    var changedCollections = {};
    var changedDocs = {};
    var allPaths = {};
    Object.keys(oldStore).forEach(function(p){ allPaths[p]=1; });
    Object.keys(STORE).forEach(function(p){ allPaths[p]=1; });
    Object.keys(allPaths).forEach(function(path){
      if (!pathChanged(oldStore, path)) return;
      changedDocs[path] = true;
      changedCollections[path.split("/").slice(0,-1).join("/")] = true;
    });
    var seen = {};
    LISTENERS.forEach(function(l){
      if (seen["c:"+l.collectionPath]) return; seen["c:"+l.collectionPath]=1;
      if (changedCollections[l.collectionPath]) notify(l.collectionPath);
    });
    DOC_LISTENERS.forEach(function(l){
      if (seen["d:"+l.docPath]) return; seen["d:"+l.docPath]=1;
      if (changedDocs[l.docPath]) notifyDoc(l.docPath);
    });
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

  // Routes any "sessions"- or "boards"-rooted path to the encrypted relay
  // client instead of localStorage (see the file header comment) --
  // "sessions" for a live retro, "boards" for board-sync.js's synced team
  // board. Falls back to the local store if relay-client.js somehow isn't
  // loaded, rather than throwing.
  function isRelayPath(path){
    return !!(window.SquadPulseRelay && (window.SquadPulseRelay.isSessionPath(path) || window.SquadPulseRelay.isBoardPath(path)));
  }
  // `secret`, when given, is forwarded straight to SquadPulseRelay -- see
  // relay-client.js's getRoom() for what it's for (board-sync.js's
  // link/QR-based key, decoupled from the routing id in the path). Local
  // paths ignore it; it's meaningless there.
  function routedDocRef(path, secret){
    if(isRelayPath(path)) return window.SquadPulseRelay.doc(path, secret);
    return localDocRef(path);
  }
  function routedCollRef(path, secret){
    if(isRelayPath(path)) return window.SquadPulseRelay.collection(path, secret);
    return localCollRef(path);
  }

  load();
  seedIfEmpty();

  // Another tab of the same browser wrote a change -- pick it up and
  // notify only the listeners whose own path genuinely differs from what
  // this tab already had (see notifyChangedSince()'s own comment above for
  // why re-firing EVERY listener on every event, regardless of whether its
  // data actually changed, is a real, previously-shipped bug).
  window.addEventListener("storage", function(e){
    if (e.key !== STORAGE_KEY) return;
    var before = STORE;
    load();
    notifyChangedSince(before);
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
