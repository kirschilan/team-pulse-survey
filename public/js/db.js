"use strict";


// ---------- pure snapshot normalizers (REF-5, STATUS.md's "Code quality &
// refactoring backlog") ----------
// Each function below takes exactly what a Firestore-style listener
// callback receives (a doc or, for meta/config, a single-doc snapshot) and
// returns a brand-new plain object shaped the way `state` expects it -- no
// state mutation, no rendering, no diag() calls, no other side effect.
// Adding a new synced field means editing exactly one of these, not
// hunting every listener callback below that touches that snapshot shape.

function normalizeSessionDoc(doc){
  return Object.assign({ id: doc.id }, doc.data() || {});
}

function normalizeSquadDoc(doc){
  var data = doc.data() || {};
  // snapshot data is frozen -- clone dimensions into a plain mutable
  // object (and each dimension record) before it enters local state
  var rawDims = data.dimensions || {};
  var dims = {};
  Object.keys(rawDims).forEach(function(k){
    var v = rawDims[k] || {};
    dims[k] = { color: v.color, trend: v.trend, note: v.note };
  });
  var squad = { id: doc.id, name: data.name || "Untitled squad", order: data.order || 0, dimensions: dims };
  // RETRO-1: a squad's most recently finished retro (see
  // finishRetroAndApply(), retro-facilitator.js) -- cloned for the same
  // reason data.i18n is below (frozen snapshot data would throw if
  // something later tried to edit it in place).
  if(data.lastRetro) squad.lastRetro = plainClone(data.lastRetro);
  return squad;
}

function normalizeDimensionDoc(doc){
  // build a brand-new plain object -- never hand out the frozen snapshot
  // data itself, since dimension rows get edited in place later
  var data = doc.data() || {};
  var dim = { key: doc.id, label: data.label || "", green: data.green || "", red: data.red || "", order: data.order || 0 };
  // optional content for the scored-survey rating flow -- not built yet,
  // but a dimension loaded from a starter template like Five Dysfunctions
  // carries these through the live snapshot so they aren't silently
  // dropped in the meantime
  if(data.statements && data.statements.length) dim.statements = data.statements;
  if(data.scoreBands) dim.scoreBands = data.scoreBands;
  if(data.strategies && data.strategies.length) dim.strategies = data.strategies;
  // Bilingual dimensions: a dimension's own Hebrew translation (see
  // state.js's localizedDimText()) -- dropped here before this fix, which
  // meant a just-saved translation (dimensions.js) round-tripped through
  // this listener's own echo and vanished immediately. plainClone()
  // (board-sync.js): data.i18n is nested inside the frozen doc.data()
  // snapshot -- assigning it by reference would hand dimensions.js a
  // frozen object it then tries to edit in place on the NEXT keystroke,
  // throwing "object is not extensible".
  if(data.i18n) dim.i18n = plainClone(data.i18n);
  return dim;
}

function normalizeTemplateDimensionEntry(d){
  var dim = { key:d.key||"", label:d.label||"", green:d.green||"", red:d.red||"", order:d.order||0 };
  // Carried through the same as normalizeDimensionDoc() above -- a custom
  // template saved with statement content or a Hebrew translation (see
  // saveCurrentAsTemplate() in templates.js) must still have it once
  // loaded back, not just at the moment it was saved.
  if(d.statements && d.statements.length) dim.statements = d.statements;
  if(d.scoreBands) dim.scoreBands = d.scoreBands;
  if(d.strategies && d.strategies.length) dim.strategies = d.strategies;
  if(d.i18n) dim.i18n = plainClone(d.i18n);
  return dim;
}

function normalizeTemplateDoc(doc){
  var data = doc.data() || {};
  var rawDims = data.dimensions || [];
  var dims = rawDims.map(normalizeTemplateDimensionEntry);
  return { id: doc.id, name: data.name || "Untitled template", unit: data.unit||"", unitPlural: data.unitPlural||"", attribution: data.attribution||"", dimensions: dims };
}

// Returns null for "doesn't exist yet" (meta/config not written) rather
// than throwing or guessing -- the caller decides what "keep local
// defaults" means, this function only reports the snapshot's own shape.
function normalizeConfigSnapshot(snap){
  if(!snap.exists) return null;
  var data = snap.data() || {};
  return {
    unit: data.unit || DEFAULT_CONFIG.unit,
    unitPlural: data.unitPlural || DEFAULT_CONFIG.unitPlural,
    activeTemplateName: data.activeTemplateName || "",
    attribution: data.attribution || ""
  };
}

// See helpers.js's matching block for why this exists and why it's safe:
// a no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeSessionDoc: normalizeSessionDoc,
    normalizeSquadDoc: normalizeSquadDoc,
    normalizeDimensionDoc: normalizeDimensionDoc,
    normalizeTemplateDimensionEntry: normalizeTemplateDimensionEntry,
    normalizeTemplateDoc: normalizeTemplateDoc,
    normalizeConfigSnapshot: normalizeConfigSnapshot
  };
}


// ---------- live sync ----------
function setSyncStatus(live){
  document.getElementById("syncDot").classList.toggle("off", !live);
  document.getElementById("syncText").textContent = live ? t("header.syncLive") : t("header.syncPreviewOnly");
}

async function initDb(){
  try{
    diag("Requesting db capability... (window.claude present: " + !!(window.claude) + ")");
    var db = await (window.claude && window.claude.use ? window.claude.use("db") : Promise.resolve(null));
    if(!db){ diag("db capability resolved to null -- running in local-only preview mode"); setSyncStatus(false); return; }
    diag("db capability granted.");
    state.db = db;
    state.live = true;
    setSyncStatus(true);

    // Step 4 of STATUS.md's "Board sync" plan: if this device has a team
    // connected (board-sync.js), pull in whatever the team's shared board
    // last synced to. Deliberately NOT awaited: with board sync default-on
    // (step 7), EVERY device now has a team secret, so awaiting this would
    // block the squads/dimensions listeners below -- and the whole board
    // -- behind however long the relay takes to answer, or to give up
    // retrying with backoff if it's unreachable at all. That was fine when
    // hydrate only ran for a device that had just deliberately opted in;
    // it is not fine on every single boot, relay reachable or not. Local
    // data flashes in first (registered right below), live data settles
    // in moments later if/when hydrate resolves -- the same pattern this
    // app already uses everywhere else for live vs. local state.
    hydrateFromTeamIfConnected();
    subscribeToTeamBoardIfConnected();

    if(isJoinMode()){
      listenJoinSession();
    } else {
      var sessSnapCount = 0;
      db.collection("sessions").onSnapshot(function(snap){
        sessSnapCount++;
        var docs = snap.docs.map(normalizeSessionDoc);
        diag("Sessions snapshot #" + sessSnapCount + ": " + docs.length + " doc(s)");
        state.sessions = docs;
        if(state.ui.view==="squad") renderSquadView();
      }, function(err){ diag("Sessions snapshot listener error: " + (err && err.code ? err.code : String(err))); });
    }

    var squadSnapCount = 0;
    db.collection("squads").orderBy("order").onSnapshot(function(snap){
      squadSnapCount++;
      var docs = snap.docs.map(normalizeSquadDoc);
      diag("Squad snapshot #" + squadSnapCount + ": " + docs.length + " doc(s) [" + docs.map(function(d){return d.id;}).join(",") + "]" + (snap.metadata && snap.metadata.fromCache ? " (from cache)" : ""));
      state.squads = docs;
      // PERF-2 (STATUS.md's "Runtime performance backlog"): board-sync.js's
      // `hydrating`/`suppressingLocalRewrite` mark a KNOWN multi-doc batch
      // in flight (a remote snapshot apply, or a local starter-template
      // load) -- local-store.js's set() fires this listener once PER DOC
      // written, so rendering unconditionally here turned one N-squad
      // remote apply into N full renderAll() passes (confirmed: 31 passes
      // for a 3-squad/12-dimension board, 132 for 40/25 -- scales with
      // board size, not a fixed cost). `state` above still updates on
      // EVERY fire either way, so nothing goes stale; only the wasted
      // intermediate renders are skipped. board-sync.js renders exactly
      // once itself right after each such batch completes.
      if(!hydrating && !suppressingLocalRewrite) renderAll();
      markLocalBoardPieceReady("squads");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Squad snapshot listener error: " + (err && err.code ? err.code : String(err))); setSyncStatus(false); });

    var dimSnapCount = 0;
    db.collection("dimensions").orderBy("order").onSnapshot(function(snap){
      dimSnapCount++;
      var docs = snap.docs.map(normalizeDimensionDoc);
      diag("Dimension snapshot #" + dimSnapCount + ": " + docs.length + " doc(s)");
      state.dimensions = docs;
      // PERF-2: see the squads listener's own comment above -- same fix,
      // same reason.
      if(!hydrating && !suppressingLocalRewrite) renderAll();
      if(!dimBackdrop.hidden) renderDimList();
      markLocalBoardPieceReady("dimensions");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Dimension snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    var tplSnapCount = 0;
    db.collection("templates").orderBy("createdAt").onSnapshot(function(snap){
      tplSnapCount++;
      var docs = snap.docs.map(normalizeTemplateDoc);
      diag("Template snapshot #" + tplSnapCount + ": " + docs.length + " doc(s)");
      state.templates = docs;
      if(!templatesBackdrop.hidden) renderTemplateList();
    }, function(err){ diag("Template snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    state.db.doc("meta/config").onSnapshot(function(snap){
      var config = normalizeConfigSnapshot(snap);
      if(config === null) { diag("meta/config does not exist yet -- keeping local defaults"); markLocalBoardPieceReady("config"); return; }
      state.config = config;
      diag("Config snapshot: unit=" + state.config.unit + " template=" + state.config.activeTemplateName);
      // PERF-2: see the squads listener's own comment above -- same fix,
      // same reason.
      if(!hydrating && !suppressingLocalRewrite) renderAll();
      markLocalBoardPieceReady("config");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Config snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    // Story 10: a co-facilitator link (?cofacilitate=<secret>) attaches this
    // device to an already-open session once everything above is wired up
    // (squads/dimensions listeners registered, so Squad view has real data
    // to show the moment coFacilitateSessionByCode() selects the squad).
    // SEC-2: this is now the ONLY way to co-facilitate (the typed-code
    // modal that used to also reach coFacilitateSessionByCode() -- and
    // show this same error dialog on failure -- is gone), so a stale or
    // mistyped/mis-shared link needs the same visible error here, not just
    // a line in the diagnostic log nobody but a facilitator debugging a
    // report would ever open.
    if(state.coFacilitateSessionId){
      coFacilitateSessionByCode(state.coFacilitateSessionId).catch(function(err){
        diag("Co-facilitate attach failed: " + (err && err.message ? err.message : String(err)));
        openConfirm(
          t("retro.coFacilitate.errorTitle"),
          (err && err.message) ? err.message : t("retro.coFacilitate.errorFallback"),
          function(){}, t("common.ok")
        );
      });
    }

  }catch(e){ diag("initDb threw: " + (e && e.message ? e.message : String(e))); setSyncStatus(false); }
}
