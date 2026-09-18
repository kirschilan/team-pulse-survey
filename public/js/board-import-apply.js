"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog") -- one of six
// files split out of the former board-export-import.js. See
// board-export.js's own header comment for the full sibling list.
//
// ---------- persistence execution ----------
// The only file in this split that actually writes anything -- given a
// plan board-import-plan.js's pure functions built, issues the real
// state.db writes (or the local-only state.squads/state.dimensions/
// state.templates mutations when not connected to a live backend) and
// reports completion. board-import-preview.js's Apply button is the only
// caller.

// REF-1 (STATUS.md's "Code quality & refactoring backlog"): a scoped,
// awaitable stand-in for removeSquad() (squads.js), used only by
// applySquadImportPlan()'s REPLACE-mode removals below. removeSquad()
// itself stays fire-and-forget (syncLiveIfConnected) -- it's shared by
// Admin's own delete button and changing its widely-used contract is out
// of scope here (see the backlog entry's own blast-radius note). This
// mirrors its exact local-state mutation but returns the real delete
// promise so the whole import can be awaited as one operation.
function importDeleteSquad(id){
  state.squads = state.squads.filter(function(s){ return s.id!==id; });
  if(!(state.live && state.db)) return Promise.resolve();
  return state.db.collection("squads").doc(id).delete();
}

// Codex review finding on PR #20 (P2): Promise.all() rejects the instant
// the FIRST promise in the array rejects -- any OTHER still-pending promise
// keeps running in the background, unobserved. Confirmed against the real
// local store: one write rejected immediately while a second, genuinely
// delayed write was still in flight -- the modal closed and "did not fully
// complete" was reported before that second write had even settled, which
// then landed on the board after the user had already been told the import
// was done. Promise.allSettled() waits for every issued write, however
// slow, before this function's own promise resolves OR rejects -- used at
// every batch below (creation batches included, not just the ratings/
// dimensions/templates/config write batches) so "the operation is done" is
// never reported while anything it started is still pending.
function allSettledOrThrow(promises){
  return Promise.allSettled(promises).then(function(results){
    var rejected = results.filter(function(r){ return r.status === "rejected"; });
    if(rejected.length) throw rejected[0].reason;
  });
}

function applySquadImportPlan(plan){
  if(!plan) return Promise.resolve();
  var mode = plan.mode;
  var newOnes = plan.patches.filter(function(p){ return !p.existing; });
  function applyAll(){
    var writes = [];
    plan.patches.forEach(function(p){
      if(!p.existing) return;
      p.existing.dimensions = mergeSquadDimensions(p.existing.dimensions || {}, p.fileDims, mode);
      // RETRO-1: a lastRetro snapshot fully REPLACES whatever was stored
      // before (it's one coherent retro's result, not a set of independent
      // keys to merge) -- assigning it wholesale here, in JS memory, is what
      // lets the set()-below branch just write p.existing.lastRetro as-is.
      if(p.fileLastRetro) p.existing.lastRetro = p.fileLastRetro;
      if(!(state.live && state.db)) return;
      // update() deep-MERGES a patch into the stored doc (see local-store.js's
      // deepMerge()/relay-client.js's matching update()) -- additive only, it
      // never drops a key absent from the patch. That's exactly right for
      // MERGE mode (send only the file's own keys, existing ones survive
      // untouched), but wrong for REPLACE: sending the already-clipped
      // p.existing.dimensions through update() would silently leave the
      // "removed" keys sitting in the persisted doc, merged right back in.
      // set() fully replaces the doc's stored value instead, so REPLACE
      // writes the whole doc (not just a dimensions patch) to actually make
      // the clipped keys disappear from what's persisted, not just from
      // this tab's in-memory copy.
      // RETRO-1: a lastRetro snapshot needs that exact same full-replace
      // treatment REGARDLESS of ratings mode -- update()'s deepMerge would
      // otherwise splice a STALE dimension entry from an older finished
      // retro into this one's dimensions map, since both old and new
      // values at that key are plain objects. p.existing already holds
      // the full, correct post-merge state at this point (dimensions via
      // mergeSquadDimensions() above, lastRetro assigned wholesale just
      // above), so writing it whole via set() is safe either way.
      var write = (mode === "replace" || p.fileLastRetro)
        ? (function(){
            var payload = {
              name: p.existing.name, order: p.existing.order,
              dimensions: p.existing.dimensions, updatedAt: nowIso()
            };
            if(p.existing.lastRetro) payload.lastRetro = p.existing.lastRetro;
            return state.db.collection("squads").doc(p.existing.id).set(payload);
          })()
        : (function(){
            var patch = { dimensions:{}, updatedAt: nowIso() };
            Object.keys(p.fileDims).forEach(function(k){ patch.dimensions[k] = p.fileDims[k]; });
            return state.db.collection("squads").doc(p.existing.id).update(patch);
          })();
      // REF-1: awaited below via Promise.all, not fire-and-forget -- but
      // still routed through the same per-write diagnostic on failure this
      // app is otherwise disciplined about, and re-thrown so a genuine
      // failure here is what makes the whole operation's promise reject.
      writes.push(write.catch(function(err){
        diag("JSON import write for squads/" + p.existing.id + " failed: " + (err && err.code ? err.code : String(err)));
        throw err;
      }));
    });
    if(mode === "replace"){
      plan.squadsToRemove.forEach(function(s){ writes.push(importDeleteSquad(s.id)); });
    }
    return allSettledOrThrow(writes).then(function(){
      renderAll();
      diag("JSON import applied (" + mode + "): " + plan.ratingCount + " rating(s), " + newOnes.length + " new " + unitPluralLower() +
        (mode==="replace" ? ", " + plan.squadsToRemove.length + " removed" : "") +
        (plan.lastRetroSquadCount ? ", " + plan.lastRetroSquadCount + " last-retro result(s)" : "") + ".");
    }, function(err){
      // A partial failure can leave a mixed board (this app doesn't promise
      // import atomicity -- see the backlog entry) -- still render whatever
      // DID land, and report a distinct, honest summary rather than the
      // same "applied" line a real success gets.
      renderAll();
      diag("JSON import (squads/ratings) did not fully complete -- see the write failure(s) above; the board may reflect a partial import.");
      throw err;
    });
  }
  if(newOnes.length===0){ return applyAll(); }
  var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
  if(state.live && state.db){
    return allSettledOrThrow(newOnes.map(function(p, i){
      return state.db.collection("squads").add({ name:p.name, order:maxOrder+1+i, dimensions:p.fileDims, updatedAt: nowIso() })
        .then(function(ref){ p.existing = { id: ref.id, name:p.name, order:maxOrder+1+i, dimensions:p.fileDims }; });
    })).then(function(){ return applyAll(); }, function(err){
      diag("JSON import: creating new " + unitPluralLower() + " failed: " + (err && err.code ? err.code : String(err)));
      throw err;
    });
  }
  newOnes.forEach(function(p, i){
    var sq = { id:"local-"+Date.now()+"-"+i, name:p.name, order:maxOrder+1+i, dimensions:p.fileDims };
    state.squads.push(sq);
    p.existing = sq;
  });
  return applyAll();
}

// Applies the dimensions/templates/board-settings plans board-import-plan.js's
// buildDimensionImportPlan()/buildTemplateImportPlan()/buildConfigImportPlan()
// built. Mirrors applySquadImportPlan()'s own two-phase shape (create any
// brand-new entities first, since their ids only exist once the write
// returns; then apply every matched update, removal, and the config diff
// together).
// onDone (optional): called once every write here has been issued and
// state.dimensions/state.templates reflect the final result, including any
// newly-created dimension's real key -- the squads/ratings import (a
// separate plan/apply pair) uses this to resolve a rating for a
// dimension THIS call just created before writing that rating out (see
// board-import-preview.js's Apply-button handler and
// resolvePendingDimensionKeys(), board-import-plan.js).
// REF-1: scoped, awaitable stands-in for removeDimension()/deleteTemplate()
// (dimensions.js/templates.js), used only by this import path's REPLACE-mode
// removals -- same reasoning as importDeleteSquad() above.
function importDeleteDimension(key){
  state.dimensions = state.dimensions.filter(function(d){ return d.key!==key; });
  if(!(state.live && state.db)) return Promise.resolve();
  return state.db.collection("dimensions").doc(key).delete();
}
function importDeleteTemplate(id){
  state.templates = state.templates.filter(function(tpl){ return tpl.id!==id; });
  if(!(state.live && state.db)) return Promise.resolve();
  return state.db.collection("templates").doc(id).delete();
}

function applyDimensionTemplateConfigImportPlan(dimPlan, tplPlan, configChanges, mode, onDone){
  if(!dimPlan || !tplPlan) return Promise.resolve();
  function applyMatchedAndConfig(){
    var writes = [];
    function trackedWrite(write, describe){
      writes.push(write.catch(function(err){
        diag(describe + " failed: " + (err && err.code ? err.code : String(err)));
        throw err;
      }));
    }
    dimPlan.patches.forEach(function(p){
      if(!p.existing) return;
      var fields = dimensionImportFields(p.file);
      Object.assign(p.existing, fields);
      if(!(state.live && state.db)) return;
      var write = mode === "replace"
        ? state.db.collection("dimensions").doc(p.existing.key).set(Object.assign({ order:p.existing.order, updatedAt: nowIso() }, fields))
        : state.db.collection("dimensions").doc(p.existing.key).update(Object.assign({ updatedAt: nowIso() }, fields));
      trackedWrite(write, "JSON import write for dimensions/" + p.existing.key);
    });
    // Templates always write via update(), even in Replace mode -- unlike
    // squads/dimensions, a saved template's own createdAt (its position in
    // "My templates") is never mirrored into state.templates at all
    // (db.js's template listener doesn't read it back), so a full set()
    // here would silently lose it. Every field this app tracks on a
    // template (name/unit/unitPlural/attribution/dimensions) is always
    // present in a valid export (isValidTemplateEntry() requires it) --
    // only i18n is ever genuinely absent, and leaving a stale one behind on
    // Replace is a deliberately accepted, narrow simplification rather than
    // risking the saved-templates list losing its order.
    tplPlan.patches.forEach(function(p){
      if(!p.existing) return;
      var fields = templateImportFields(p.file);
      Object.assign(p.existing, fields);
      if(!(state.live && state.db)) return;
      trackedWrite(
        state.db.collection("templates").doc(p.existing.id).update(Object.assign({ updatedAt: nowIso() }, fields)),
        "JSON import write for templates/" + p.existing.id
      );
    });
    if(mode === "replace"){
      dimPlan.toRemove.forEach(function(d){ writes.push(importDeleteDimension(d.key)); });
      tplPlan.toRemove.forEach(function(tpl){ writes.push(importDeleteTemplate(tpl.id)); });
    }
    if(configChanges && configChanges.length){
      var newConfig = Object.assign({}, state.config);
      configChanges.forEach(function(c){ newConfig[c.field] = c.to; });
      state.config = newConfig;
      if(state.live && state.db){
        trackedWrite(
          state.db.doc("meta/config").set(Object.assign({}, newConfig, { updatedAt: nowIso() })),
          "JSON import write for meta/config"
        );
      }
    }
    return allSettledOrThrow(writes).then(function(){
      renderAll();
      if(!dimBackdrop.hidden) renderDimList();
      if(!templatesBackdrop.hidden) renderTemplateList();
      diag("JSON import applied to dimensions/templates/board settings (" + mode + "): " +
        dimPlan.patches.filter(function(p){ return p.existing; }).length + " dimension(s) updated, " + dimPlan.added.length + " new" +
        (mode==="replace" ? ", " + dimPlan.toRemove.length + " removed" : "") + "; " +
        tplPlan.patches.filter(function(p){ return p.existing; }).length + " template(s) updated, " + tplPlan.added.length + " new" +
        (mode==="replace" ? ", " + tplPlan.toRemove.length + " removed" : "") + "; " +
        (configChanges ? configChanges.length : 0) + " board setting(s) changed.");
      // Ordering/dependency, made explicit: onDone (the squads/ratings
      // import) only runs once every dimension/template/config write above
      // has genuinely settled -- a rating for a dimension THIS call just
      // created must never be written against a key that doesn't exist yet.
      return onDone ? onDone() : undefined;
    }, function(err){
      renderAll();
      if(!dimBackdrop.hidden) renderDimList();
      if(!templatesBackdrop.hidden) renderTemplateList();
      diag("JSON import (dimensions/templates/board settings) did not fully complete -- see the write failure(s) above; the board may reflect a partial import.");
      throw err;
    });
  }

  var newDims = dimPlan.patches.filter(function(p){ return !p.existing; });
  var newTpls = tplPlan.patches.filter(function(p){ return !p.existing; });
  if(newDims.length===0 && newTpls.length===0){ return applyMatchedAndConfig(); }

  var maxDimOrder = state.dimensions.reduce(function(m,d){ return Math.max(m, d.order||0); }, 0);
  if(state.live && state.db){
    var writes = newDims.map(function(p, i){
      var payload = Object.assign({ order: maxDimOrder+1+i, updatedAt: nowIso() }, dimensionImportFields(p.file));
      return state.db.collection("dimensions").add(payload).then(function(ref){ p.existing = Object.assign({ key: ref.id }, payload); });
    }).concat(newTpls.map(function(p){
      var payload = Object.assign({ createdAt: nowIso() }, templateImportFields(p.file));
      return state.db.collection("templates").add(payload).then(function(ref){ p.existing = Object.assign({ id: ref.id }, payload); });
    }));
    return allSettledOrThrow(writes).then(function(){ return applyMatchedAndConfig(); }, function(err){
      diag("JSON import: creating new dimensions/templates failed: " + (err && err.code ? err.code : String(err)));
      throw err;
    });
  }
  newDims.forEach(function(p, i){
    var payload = Object.assign({ order: maxDimOrder+1+i }, dimensionImportFields(p.file));
    var d = Object.assign({ key:"local-dim-"+Date.now()+"-"+i }, payload);
    state.dimensions.push(d);
    p.existing = d;
  });
  newTpls.forEach(function(p, i){
    var payload = templateImportFields(p.file);
    var tpl = Object.assign({ id:"local-tpl-"+Date.now()+"-"+i }, payload);
    state.templates.push(tpl);
    p.existing = tpl;
  });
  return applyMatchedAndConfig();
}
