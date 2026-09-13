"use strict";


// ---------- live sync ----------
function setSyncStatus(live){
  document.getElementById("syncDot").classList.toggle("off", !live);
  document.getElementById("syncText").textContent = live ? "Live — synced across viewers" : "Preview only — not connected";
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
        var docs = snap.docs.map(function(doc){ return Object.assign({ id: doc.id }, doc.data() || {}); });
        diag("Sessions snapshot #" + sessSnapCount + ": " + docs.length + " doc(s)");
        state.sessions = docs;
        if(state.ui.view==="squad") renderSquadView();
      }, function(err){ diag("Sessions snapshot listener error: " + (err && err.code ? err.code : String(err))); });
    }

    var squadSnapCount = 0;
    db.collection("squads").orderBy("order").onSnapshot(function(snap){
      squadSnapCount++;
      var docs = snap.docs.map(function(doc){
        var data = doc.data() || {};
        // snapshot data is frozen -- clone dimensions into a plain mutable
        // object (and each dimension record) before it enters local state
        var rawDims = data.dimensions || {};
        var dims = {};
        Object.keys(rawDims).forEach(function(k){
          var v = rawDims[k] || {};
          dims[k] = { color: v.color, trend: v.trend, note: v.note };
        });
        return { id: doc.id, name: data.name || "Untitled squad", order: data.order || 0, dimensions: dims };
      });
      diag("Squad snapshot #" + squadSnapCount + ": " + docs.length + " doc(s) [" + docs.map(function(d){return d.id;}).join(",") + "]" + (snap.metadata && snap.metadata.fromCache ? " (from cache)" : ""));
      state.squads = docs;
      renderAll();
      markLocalBoardPieceReady("squads");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Squad snapshot listener error: " + (err && err.code ? err.code : String(err))); setSyncStatus(false); });

    var dimSnapCount = 0;
    db.collection("dimensions").orderBy("order").onSnapshot(function(snap){
      dimSnapCount++;
      // build brand-new plain objects -- never hand out the frozen
      // snapshot data itself, since dimension rows get edited in place later
      var docs = snap.docs.map(function(doc){
        var data = doc.data() || {};
        var dim = { key: doc.id, label: data.label || "", green: data.green || "", red: data.red || "", order: data.order || 0 };
        // optional content for the scored-survey rating flow -- not built yet,
        // but a dimension loaded from a starter template like Five
        // Dysfunctions carries these through the live snapshot so they aren't
        // silently dropped in the meantime
        if(data.statements && data.statements.length) dim.statements = data.statements;
        if(data.scoreBands) dim.scoreBands = data.scoreBands;
        if(data.strategies && data.strategies.length) dim.strategies = data.strategies;
        return dim;
      });
      diag("Dimension snapshot #" + dimSnapCount + ": " + docs.length + " doc(s)");
      state.dimensions = docs;
      renderAll();
      if(!dimBackdrop.hidden) renderDimList();
      markLocalBoardPieceReady("dimensions");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Dimension snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    var tplSnapCount = 0;
    db.collection("templates").orderBy("createdAt").onSnapshot(function(snap){
      tplSnapCount++;
      var docs = snap.docs.map(function(doc){
        var data = doc.data() || {};
        var rawDims = data.dimensions || [];
        var dims = rawDims.map(function(d){ return { key:d.key||"", label:d.label||"", green:d.green||"", red:d.red||"", order:d.order||0 }; });
        return { id: doc.id, name: data.name || "Untitled template", unit: data.unit||"", unitPlural: data.unitPlural||"", attribution: data.attribution||"", dimensions: dims };
      });
      diag("Template snapshot #" + tplSnapCount + ": " + docs.length + " doc(s)");
      state.templates = docs;
      if(!templatesBackdrop.hidden) renderTemplateList();
    }, function(err){ diag("Template snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    state.db.doc("meta/config").onSnapshot(function(snap){
      if(!snap.exists) { diag("meta/config does not exist yet -- keeping local defaults"); markLocalBoardPieceReady("config"); return; }
      var data = snap.data() || {};
      state.config = {
        unit: data.unit || DEFAULT_CONFIG.unit,
        unitPlural: data.unitPlural || DEFAULT_CONFIG.unitPlural,
        activeTemplateName: data.activeTemplateName || "",
        attribution: data.attribution || ""
      };
      diag("Config snapshot: unit=" + state.config.unit + " template=" + state.config.activeTemplateName);
      renderAll();
      markLocalBoardPieceReady("config");
      pushBoardSnapshotIfConnected();
    }, function(err){ diag("Config snapshot listener error: " + (err && err.code ? err.code : String(err))); });

    // Story 10: a co-facilitator link (?cofacilitate=<code>) attaches this
    // device to an already-open session once everything above is wired up
    // (squads/dimensions listeners registered, so Squad view has real data
    // to show the moment coFacilitateSessionByCode() selects the squad).
    if(state.coFacilitateSessionId){
      coFacilitateSessionByCode(state.coFacilitateSessionId).catch(function(err){
        diag("Co-facilitate attach failed: " + (err && err.message ? err.message : String(err)));
      });
    }

  }catch(e){ diag("initDb threw: " + (e && e.message ? e.message : String(e))); setSyncStatus(false); }
}
