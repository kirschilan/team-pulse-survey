"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog") -- one of six
// files split out of the former board-export-import.js (903 lines when
// REF-4 was proposed, 1093 by the time RETRO-1 and this split actually
// landed). See board-export.js's own header comment for the full sibling
// list and the "still one shared window scope, not ES modules" note that
// applies to every one of them.
//
// ---------- JSON board import (beta): parsing + shape validation ----------
// Story 13, items 3a (squads & ratings) + 3b (dimensions/templates/board
// settings) -- one file, one preview modal (board-import-preview.js), one
// Merge/Replace toggle, governing whichever of the two scopes (Squads &
// ratings / Dimensions, templates & board settings) are checked.
//
// Mode (product owner's decision, see the reviewed mockup): a real choice,
// offered every time, applying at BOTH levels --
//   MERGE (default): add/update squads from the file; a board squad absent
//     from the file is left alone; a matched squad's own ratings for a
//     dimension the file doesn't mention are left alone too.
//   REPLACE: a board squad absent from the file is removed outright (listed
//     by name before applying); a matched squad's ratings become EXACTLY
//     what the file lists -- a rating the file doesn't mention is cleared.
// No second confirm dialog for Replace -- the preview offers a one-click
// "download a backup first" instead (board-export.js's toJSON()).
var SUPPORTED_BOARD_FORMAT_VERSION = 1;

// Validates each squad entry's shape, AND each of its ratings' shape, at the
// parse boundary -- found missing in review (PR #7), in two rounds:
// (1) buildSquadImportPlan() ran directly inside FileReader.onload with no
// try/catch, so a null squad entry or a non-string `name` threw an uncaught
// exception instead of showing the malformed-file error UI; (2) a rating's
// OWN fields went unchecked, so e.g. {color:"good", note:123} passed
// straight through into the persisted store and then crashed rendering --
// render.js's/squads.js's `cell.note && cell.note.trim()` assumes a string.
// Worse than just a crash: `color`/`trend` are interpolated UNESCAPED into a
// CSS class attribute in both of those files (`'cell-btn '+color+'"'`) --
// always safe before because every existing writer (the rating-modal UI,
// CSV's colorFromWord()) only ever produces one of a fixed enum, but a raw
// JSON import copied whatever string was in the file, opening real
// attribute-injection room for a color/trend containing a `"`. Restricting
// color/trend to the app's real enum (not just "must be a string") closes
// both problems with the same check.
//
// isPlainObject is also used by board-import-plan.js's buildConfigImportPlan()
// (a bare global, same convention every other cross-file reference in this
// app already uses -- see board-export.js's header comment) -- exported
// below for the same reason.
function isPlainObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }
var VALID_RATING_COLORS = { good:true, warn:true, crit:true, unscored:true };
var VALID_RATING_TRENDS = { up:true, down:true, flat:true };

// Third review round on the same PR: bracket lookup (TABLE[value]) directly
// on an untyped value is unsafe three ways -- a non-string can COERCE to a
// matching key string (an array like ["good"] stringifies to exactly
// "good"); a string naming an INHERITED Object.prototype property (e.g.
// "constructor") reads truthy even though it was never one of the real
// enum values; and an object with a non-callable `toString` THROWS
// converting itself into a property key, uncaught -- the same "bypasses the
// friendly error UI" failure as the squad-shape fix above, just reached
// through the rating check instead. `typeof value === "string"` first
// means a throw can never happen (only strings ever reach the lookup) and
// forecloses the coercion case; `hasOwnProperty` (not bracket lookup) means
// an inherited property name never counts as a match.
function isValidEnumWord(value, table){
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(table, value);
}

function isValidRating(r){
  if(!isPlainObject(r)) return false;
  if(r.color !== undefined && !isValidEnumWord(r.color, VALID_RATING_COLORS)) return false;
  if(r.trend !== undefined && !isValidEnumWord(r.trend, VALID_RATING_TRENDS)) return false;
  if(r.note !== undefined && typeof r.note !== "string") return false;
  return true;
}

// RETRO-1: same parse-boundary validation rule as isValidRating() above --
// a squad's lastRetro.dimensions entries are shaped like a rating PLUS an
// `overridden` boolean (the same effectiveDimResult() shape retro-facilitator.js
// already produces), never like a rating's own `note` field.
function isValidLastRetroDim(v){
  if(!isPlainObject(v)) return false;
  if(v.color !== undefined && !isValidEnumWord(v.color, VALID_RATING_COLORS)) return false;
  if(v.trend !== undefined && !isValidEnumWord(v.trend, VALID_RATING_TRENDS)) return false;
  if(v.overridden !== undefined && typeof v.overridden !== "boolean") return false;
  return true;
}
function isValidLastRetro(lr){
  if(lr === undefined) return true;
  if(!isPlainObject(lr)) return false;
  if(lr.finishedAt !== undefined && typeof lr.finishedAt !== "string") return false;
  if(lr.experimentNote !== undefined && typeof lr.experimentNote !== "string") return false;
  if(lr.dimensions !== undefined){
    if(!isPlainObject(lr.dimensions)) return false;
    var keys = Object.keys(lr.dimensions);
    for(var i=0;i<keys.length;i++){
      if(!isValidLastRetroDim(lr.dimensions[keys[i]])) return false;
    }
  }
  return true;
}

// Item 3b's own validation, same parse-boundary rule as the squad/rating
// checks above -- a malformed dimensions/templates/config section must be
// rejected here, not thrown from inside board-import-plan.js's
// buildDimensionImportPlan()/buildTemplateImportPlan() or
// board-import-preview.js's renderJsonImportPreview() later. Loose on
// purpose: only the fields this app actually reads are type-checked (green/
// red/statements/etc.); unknown extra fields are neither validated nor
// rejected, matching formatVersion:1's "no migration needed yet" stance --
// a future version can add fields without old imports choking on them.
function isValidDimensionEntry(fd){
  if(!isPlainObject(fd)) return false;
  if(typeof fd.label !== "string" || !fd.label.trim()) return false;
  if(fd.key !== undefined && typeof fd.key !== "string") return false;
  if(fd.green !== undefined && typeof fd.green !== "string") return false;
  if(fd.red !== undefined && typeof fd.red !== "string") return false;
  if(fd.order !== undefined && typeof fd.order !== "number") return false;
  if(fd.statements !== undefined && !Array.isArray(fd.statements)) return false;
  if(fd.scoreBands !== undefined && !isPlainObject(fd.scoreBands)) return false;
  if(fd.strategies !== undefined && !Array.isArray(fd.strategies)) return false;
  return true;
}

function isValidTemplateEntry(ft){
  if(!isPlainObject(ft)) return false;
  if(typeof ft.name !== "string" || !ft.name.trim()) return false;
  if(ft.unit !== undefined && typeof ft.unit !== "string") return false;
  if(ft.unitPlural !== undefined && typeof ft.unitPlural !== "string") return false;
  if(ft.attribution !== undefined && typeof ft.attribution !== "string") return false;
  if(ft.dimensions !== undefined){
    if(!Array.isArray(ft.dimensions)) return false;
    for(var i=0;i<ft.dimensions.length;i++){
      if(!isValidDimensionEntry(ft.dimensions[i])) return false;
    }
  }
  return true;
}

// Board settings (state.config) are 4 named fields this app understands --
// CONFIG_IMPORT_FIELDS is the single list both this validation and
// board-import-plan.js's buildConfigImportPlan() key off of (a bare global
// cross-file reference, same as isPlainObject above -- exported below for
// the same reason). An unknown field is ignored, not rejected -- same
// forward-compat stance as the rest of this file.
var CONFIG_IMPORT_FIELDS = ["unit", "unitPlural", "activeTemplateName", "attribution"];
function isValidConfigEntry(cfg){
  if(cfg === undefined) return true;
  if(!isPlainObject(cfg)) return false;
  return CONFIG_IMPORT_FIELDS.every(function(field){ return cfg[field] === undefined || typeof cfg[field] === "string"; });
}

function parseBoardImportFile(text){
  var data;
  try{ data = JSON.parse(text); }catch(e){ return { ok:false, error:"not-json" }; }
  if(!data || typeof data.formatVersion !== "number") return { ok:false, error:"missing-version" };
  if(data.formatVersion > SUPPORTED_BOARD_FORMAT_VERSION) return { ok:false, error:"unsupported-version", fileVersion:data.formatVersion };
  if(!Array.isArray(data.squads)) return { ok:false, error:"missing-squads" };
  for(var i=0;i<data.squads.length;i++){
    var fs = data.squads[i];
    if(!isPlainObject(fs)) return { ok:false, error:"invalid-squad" };
    if(fs.name !== undefined && typeof fs.name !== "string") return { ok:false, error:"invalid-squad" };
    if(fs.dimensions !== undefined){
      if(!isPlainObject(fs.dimensions)) return { ok:false, error:"invalid-squad" };
      var dimKeys = Object.keys(fs.dimensions);
      for(var j=0;j<dimKeys.length;j++){
        if(!isValidRating(fs.dimensions[dimKeys[j]])) return { ok:false, error:"invalid-rating" };
      }
    }
    if(!isValidLastRetro(fs.lastRetro)) return { ok:false, error:"invalid-last-retro" };
  }
  if(data.dimensions !== undefined){
    if(!Array.isArray(data.dimensions)) return { ok:false, error:"invalid-dimensions" };
    for(var di=0;di<data.dimensions.length;di++){
      if(!isValidDimensionEntry(data.dimensions[di])) return { ok:false, error:"invalid-dimension" };
    }
  }
  if(data.templates !== undefined){
    if(!Array.isArray(data.templates)) return { ok:false, error:"invalid-templates" };
    for(var ti=0;ti<data.templates.length;ti++){
      if(!isValidTemplateEntry(data.templates[ti])) return { ok:false, error:"invalid-template" };
    }
  }
  if(!isValidConfigEntry(data.config)) return { ok:false, error:"invalid-config" };
  return { ok:true, data:data };
}

// See helpers.js's matching block for why this exists and why it's safe:
// a no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node. isPlainObject and
// CONFIG_IMPORT_FIELDS are included even though no test calls them
// directly -- board-import-plan.js's buildConfigImportPlan() needs them
// wired onto `global` before it can run under Node (see tests/unit/README.md).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseBoardImportFile: parseBoardImportFile,
    isPlainObject: isPlainObject,
    CONFIG_IMPORT_FIELDS: CONFIG_IMPORT_FIELDS
  };
}
