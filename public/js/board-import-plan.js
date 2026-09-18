"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog") -- one of six
// files split out of the former board-export-import.js. See
// board-export.js's own header comment for the full sibling list.
//
// ---------- JSON board import (beta): pure merge/replace planning ----------
// Every function below is pure (no DOM, no state.db/state.live) -- given a
// parsed file and the board's own current state.squads/state.dimensions/
// state.templates/state.config, it returns a plan describing what would
// change, without touching anything. board-import-preview.js renders these
// plans; board-import-apply.js is the only thing that actually persists one.

// Pure planning step -- matches file squads to board squads by NAME
// (squad.id is a storage artifact, never a portable identity -- see
// board-export.js's buildBoardExport() own comment above), and each
// rating's dimension against the board's CURRENT dimension set. A rating
// for a dimension not found today is reported, not guessed at.
// PR #12 review, two rounds: two boards/devices never share a dimension's
// key (item 3b's own design -- see buildDimensionImportPlan()'s comment),
// so once a file also carries its own `dimensions` section describing a
// rating's key, that key is only ever meaningful to the SOURCE board -- a
// built-in dimension's key is fixed and identical on every board, and
// renaming a dimension keeps its key too, so a key match on the
// destination can easily be a DIFFERENT dimension that just happens to
// share it. The destination board's real match is by LABEL -- either an
// already-existing dimension (resolved immediately here) or one about to
// be created in the same operation (resolved once it exists, via the
// pendingDimensionKey()/resolvePendingDimensionKeys() pair below) --
// and label matching wins UNCONDITIONALLY whenever the file's dimensions
// section describes that key, never falling back to a key match even if
// one exists. Key matching survives only as the fallback for a squads-only
// file (no `dimensions` section at all, or no entry for that specific
// key) -- there the file carries no label to weigh instead, so the key is
// literally the only information available, exactly like the pre-3b, item
// 3a-only behavior this app always had.
var PENDING_DIMENSION_PREFIX = "pending-dimension:";
function pendingDimensionKey(label){ return PENDING_DIMENSION_PREFIX + label; }
// resolvePendingDimensionKeys() is called from board-import-preview.js's
// own Apply-button handler (a bare global cross-file reference, same
// convention as every other function here) -- once a same-import dimension
// creation has actually landed, resolving a rating/lastRetro's own pending
// marker into the real key that now exists.
function resolvePendingDimensionKeys(fileDims){
  var byLabel = {};
  sortedDimensions().forEach(function(d){ byLabel[d.label.trim().toLowerCase()] = d; });
  var resolved = {};
  Object.keys(fileDims).forEach(function(key){
    if(key.indexOf(PENDING_DIMENSION_PREFIX) === 0){
      var label = key.slice(PENDING_DIMENSION_PREFIX.length);
      var dim = byLabel[label.trim().toLowerCase()];
      if(dim) resolved[dim.key] = fileDims[key];
      // still doesn't exist (e.g. its own creation failed) -- dropped,
      // same as any other "dimension not found" case.
    } else {
      resolved[key] = fileDims[key];
    }
  });
  return resolved;
}

// extraDimensionLabels (optional): buildDimensionImportPlan()'s own
// `added` list, passed in ONLY when that plan will actually be applied in
// the same operation (the Templates scope is checked) -- a rating whose
// file-key resolves to one of these labels is counted as a real import
// (pendingDimensionKey() marker) rather than reported as missing, since it
// genuinely will exist by the time this squad plan is applied. Omitted
// (e.g. Templates scope unchecked), such a rating still correctly reports
// "not found" -- nothing will create that dimension this round.
// Resolves a per-dimension-key map (a squad's own ratings, or -- RETRO-1 --
// a lastRetro snapshot's own dimensions map, same shape) against the
// board's real dimensions: by KEY using the file's own top-level
// `dimensions` section for a label to match on the destination board,
// falling back to a direct key match when the file carries no such section
// (or no entry for that specific key). An entry resolving to a dimension
// THIS SAME import is about to create (extraLabelSet) gets the
// pendingDimensionKey() marker for later resolution, same as a rating.
// Anything that resolves to nothing is pushed into `skipped` -- reported,
// never silently dropped -- with the given `reason` string.
function resolveFileDimensionMap(rawMap, squadName, fileDimKeyToLabel, dimByKeyMap, dimByLabelMap, extraLabelSet, skipped, reason){
  var resolved = {};
  var count = 0;
  Object.keys(rawMap || {}).forEach(function(key){
    var label = fileDimKeyToLabel[key];
    var dim;
    if(label){
      dim = dimByLabelMap[label.trim().toLowerCase()];
      if(!dim && extraLabelSet[label.trim().toLowerCase()]){
        resolved[pendingDimensionKey(label)] = rawMap[key];
        count++;
        return;
      }
    } else {
      dim = dimByKeyMap[key];
    }
    if(!dim){ skipped.push({ squad:squadName, dimension:key, reason:reason }); return; }
    resolved[dim.key] = rawMap[key];
    count++;
  });
  return { resolved: resolved, count: count };
}

function buildSquadImportPlan(data, mode, extraDimensionLabels){
  var dimByKeyMap = {};
  var dimByLabelMap = {};
  sortedDimensions().forEach(function(d){
    dimByKeyMap[d.key] = d;
    dimByLabelMap[d.label.trim().toLowerCase()] = d;
  });
  var fileDimKeyToLabel = {};
  (data.dimensions || []).forEach(function(fd){
    if(fd && typeof fd.key === "string" && typeof fd.label === "string") fileDimKeyToLabel[fd.key] = fd.label;
  });
  var extraLabelSet = {};
  (extraDimensionLabels || []).forEach(function(label){ extraLabelSet[label.trim().toLowerCase()] = true; });
  var existingByName = {};
  state.squads.forEach(function(s){ existingByName[s.name.trim().toLowerCase()] = s; });

  var patches = [], newSquadNames = [], skipped = [], ratingCount = 0, lastRetroSquadCount = 0;
  var fileNameKeys = {};
  (data.squads || []).forEach(function(fs){
    var name = (fs.name || "").trim();
    if(!name) return;
    fileNameKeys[name.toLowerCase()] = true;
    var existing = existingByName[name.toLowerCase()] || null;
    var dimsResolved = resolveFileDimensionMap(fs.dimensions, name, fileDimKeyToLabel, dimByKeyMap, dimByLabelMap, extraLabelSet, skipped, "dimension not found");
    var fileDims = dimsResolved.resolved;
    ratingCount += dimsResolved.count;
    // RETRO-1: same matching rules as a rating's own dimensions above, kept
    // as a SEPARATE resolved map (not merged into fileDims) -- a lastRetro
    // snapshot is its own coherent unit, not additional ratings.
    var fileLastRetro;
    if(fs.lastRetro !== undefined){
      var lrDimsResolved = resolveFileDimensionMap(fs.lastRetro.dimensions, name, fileDimKeyToLabel, dimByKeyMap, dimByLabelMap, extraLabelSet, skipped, "dimension not found (last retro result)");
      fileLastRetro = {
        finishedAt: fs.lastRetro.finishedAt,
        experimentNote: fs.lastRetro.experimentNote || "",
        dimensions: lrDimsResolved.resolved
      };
      lastRetroSquadCount++;
    }
    patches.push({ name:name, existing:existing, order:fs.order, fileDims:fileDims, fileLastRetro:fileLastRetro });
    if(!existing) newSquadNames.push(name);
  });

  var squadsToRemove = [];
  var clearedRatings = [];
  if(mode === "replace"){
    state.squads.forEach(function(s){
      if(!fileNameKeys[s.name.trim().toLowerCase()]) squadsToRemove.push(s);
    });
    patches.forEach(function(p){
      if(!p.existing) return;
      Object.keys(p.existing.dimensions || {}).forEach(function(key){
        if(!(key in p.fileDims)){
          var d = dimByKeyMap[key];
          clearedRatings.push({ squad:p.name, dimension: d ? d.label : key });
        }
      });
    });
  }

  return {
    mode:mode, patches:patches, newSquadNames:newSquadNames, skipped:skipped,
    ratingCount:ratingCount, squadsToRemove:squadsToRemove, clearedRatings:clearedRatings,
    lastRetroSquadCount:lastRetroSquadCount
  };
}

// Pure per-squad merge math, split out from board-import-apply.js's
// applySquadImportPlan() so the MERGE-keeps-extras / REPLACE-clears-extras
// rule is directly unit-testable without a state/db fixture.
function mergeSquadDimensions(existingDims, fileDims, mode){
  if(mode === "replace") return Object.assign({}, fileDims);
  return Object.assign({}, existingDims, fileDims);
}

// Whether a plan would actually change anything -- gates the Apply button.
// Review finding (PR #7): originally inlined as ratingCount/newSquadNames/
// squadsToRemove only, missing clearedRatings -- a REPLACE-mode plan that
// only clears existing ratings (every board squad already named in the
// file, just with fewer ratings than before) left Apply permanently
// disabled, with no way to apply it.
function planHasChanges(plan){
  return plan.ratingCount>0 || plan.newSquadNames.length>0 || plan.squadsToRemove.length>0 || plan.clearedRatings.length>0 ||
    plan.lastRetroSquadCount>0;
}

// ---------- item 3b: dimensions/templates/board-settings import ----------
// Same file, same preview modal, same Merge/Replace toggle as the squads/
// ratings import above -- these are its sibling planning functions for the
// rest of what board-export.js's buildBoardExport() puts in the file.
//
// Matched by LABEL/NAME, not key/id -- deliberately different from how the
// squads import matches a RATING's dimension (by KEY, against the board's
// own CURRENT dimension set -- a different question, unaffected by this).
// A custom dimension's key ("local-dim-"+Date.now(), dimensions.js's
// addDimension()) and a custom template's id ("local-tpl-"+Date.now(),
// templates.js's saveCurrentAsTemplate()) are both device-local storage
// artifacts, not portable identities -- the same reasoning
// buildSquadImportPlan() already applies to squad.id. Only the label/name
// is meaningful across two different boards/devices, which is the point of
// importing a template set from one tribe into another (the product
// owner's stated goal for this item).
// A file with NO "dimensions" key at all (every item 3a-only fixture is
// exactly this shape -- formatVersion:1 makes the field genuinely optional)
// must never be read as "this file's dimension set is empty": REPLACE mode
// would then remove every board dimension on an ordinary squads-only file.
// `undefined` (key absent, no opinion) and `[]` (key present, file says
// zero) are different claims -- only the second one means anything.
function buildDimensionImportPlan(fileDimensions, mode){
  if(fileDimensions === undefined) return { mode:mode, patches:[], added:[], toRemove:[] };
  var byLabel = {};
  sortedDimensions().forEach(function(d){ byLabel[d.label.trim().toLowerCase()] = d; });
  var patches = [], added = [];
  var fileLabelKeys = {};
  (fileDimensions || []).forEach(function(fd){
    var label = (fd.label || "").trim();
    if(!label) return;
    fileLabelKeys[label.toLowerCase()] = true;
    var existing = byLabel[label.toLowerCase()] || null;
    patches.push({ existing:existing, file:fd });
    if(!existing) added.push(label);
  });
  var toRemove = mode === "replace"
    ? sortedDimensions().filter(function(d){ return !fileLabelKeys[d.label.trim().toLowerCase()]; })
    : [];
  return { mode:mode, patches:patches, added:added, toRemove:toRemove };
}

// Same fix, same reason as buildDimensionImportPlan() above.
function buildTemplateImportPlan(fileTemplates, mode){
  if(fileTemplates === undefined) return { mode:mode, patches:[], added:[], toRemove:[] };
  var byName = {};
  (state.templates || []).forEach(function(t){ byName[t.name.trim().toLowerCase()] = t; });
  var patches = [], added = [];
  var fileNameKeys = {};
  (fileTemplates || []).forEach(function(ft){
    var name = (ft.name || "").trim();
    if(!name) return;
    fileNameKeys[name.toLowerCase()] = true;
    var existing = byName[name.toLowerCase()] || null;
    patches.push({ existing:existing, file:ft });
    if(!existing) added.push(name);
  });
  var toRemove = mode === "replace"
    ? (state.templates || []).filter(function(t){ return !fileNameKeys[t.name.trim().toLowerCase()]; })
    : [];
  return { mode:mode, patches:patches, added:added, toRemove:toRemove };
}

// Board settings (state.config) are 4 named fields, not a collection --
// there's nothing to "remove" the way a missing squad/dimension/template is
// removed in Replace mode, so this takes no mode parameter: whatever known
// field the file provides just overwrites that field, the same in either
// mode -- exactly like loadTemplate() (templates.js) already writes config
// as one whole doc regardless of what triggered the load.
// isPlainObject/CONFIG_IMPORT_FIELDS are board-import-validate.js's (bare
// global cross-file references -- see that file's own header comment).
function buildConfigImportPlan(fileConfig){
  var changes = [];
  if(!isPlainObject(fileConfig)) return changes;
  CONFIG_IMPORT_FIELDS.forEach(function(field){
    if(typeof fileConfig[field] !== "string") return;
    if(state.config[field] !== fileConfig[field]) changes.push({ field:field, from:state.config[field], to:fileConfig[field] });
  });
  return changes;
}

// Shared Apply-button gate for the {patches, added, toRemove} shape
// buildDimensionImportPlan()/buildTemplateImportPlan() both return -- same
// "presence, not diff" rule planHasChanges() already uses for squads/
// ratings above (a matched entity counts as a change whenever the file
// mentions it, whether or not its fields actually differ from what's
// already stored).
function entityImportPlanHasChanges(plan){
  return plan.added.length>0 || plan.toRemove.length>0 || plan.patches.some(function(p){ return p.existing; });
}

// A matched dimension's file fields, excluding `order` -- same rule
// board-import-apply.js's applySquadImportPlan() REPLACE write already
// applies to a matched squad's own order (only .dimensions is ever patched
// from the file; a dimension's position in its list is board-local
// sequencing, not something a file from another board should be allowed to
// scramble). Pure (no I/O) despite only ever being used by the apply file --
// kept here alongside this file's other pure field-selection logic.
function dimensionImportFields(fd){
  // Only label is unconditional (isValidDimensionEntry() requires it) --
  // every other field is included only when the file actually has it, same
  // "MERGE leaves what's not mentioned alone" rule the squads/ratings import
  // already applies: update() (MERGE) only touches keys present in this
  // object, so an omitted green/red/etc. leaves the board's own value
  // exactly as it was, rather than silently blanking it. In REPLACE mode
  // (set(), the whole doc), a field genuinely absent from the file just
  // isn't in the stored doc at all -- db.js's dimension listener already
  // reads a missing green/red/etc. back as "" when it loads, so there's
  // nothing left to default here.
  var fields = { label: fd.label };
  if(fd.green !== undefined) fields.green = fd.green;
  if(fd.red !== undefined) fields.red = fd.red;
  if(fd.statements) fields.statements = fd.statements;
  if(fd.scoreBands) fields.scoreBands = fd.scoreBands;
  if(fd.strategies) fields.strategies = fd.strategies;
  if(fd.i18n) fields.i18n = fd.i18n;
  return fields;
}

// Same "only include what the file actually has" rule as
// dimensionImportFields() above, and for the same reason -- db.js's own
// template snapshot listener already defaults every one of these fields
// when reading a doc back (data.unit||"", (data.dimensions||[]).map(...),
// etc.), for both a brand-new template and a matched one, so there's
// nothing to default here either.
function templateImportFields(ft){
  var fields = { name: ft.name };
  if(ft.unit !== undefined) fields.unit = ft.unit;
  if(ft.unitPlural !== undefined) fields.unitPlural = ft.unitPlural;
  if(ft.attribution !== undefined) fields.attribution = ft.attribution;
  if(ft.dimensions !== undefined) fields.dimensions = ft.dimensions;
  if(ft.i18n) fields.i18n = ft.i18n;
  return fields;
}

// See helpers.js's matching block for why this exists and why it's safe:
// a no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildSquadImportPlan: buildSquadImportPlan,
    mergeSquadDimensions: mergeSquadDimensions, planHasChanges: planHasChanges,
    buildDimensionImportPlan: buildDimensionImportPlan, buildTemplateImportPlan: buildTemplateImportPlan,
    buildConfigImportPlan: buildConfigImportPlan, entityImportPlanHasChanges: entityImportPlanHasChanges,
    pendingDimensionKey: pendingDimensionKey, resolvePendingDimensionKeys: resolvePendingDimensionKeys
  };
}
