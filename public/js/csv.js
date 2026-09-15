"use strict";


// ---------- CSV export ----------
function toCSV(){
  var dims = sortedDimensions();
  // the Template column records which dimension set was active at export time --
  // without it, a file re-imported after switching templates has no way to
  // flag that its dimension names may no longer mean the same thing.
  // The Dimension Key column records each dimension's STABLE id, so a file
  // can still be re-imported correctly after a dimension is renamed --
  // matching purely by the Dimension (label) text breaks the moment that
  // text changes, e.g. after translating labels to Hebrew.
  var templateName = state.config.activeTemplateName || "Custom";
  var rows = [[state.config.unit, "Dimension", "Health", "Trend", "Note", "Template", "Dimension Key"]];
  sortedSquads().forEach(function(sq){
    dims.forEach(function(d){
      var cell = (sq.dimensions && sq.dimensions[d.key]) || {};
      var color = cell.color==="good"?"Green":cell.color==="warn"?"Yellow":cell.color==="crit"?"Red":"Not scored";
      var trend = cell.trend==="up"?"Improving":cell.trend==="down"?"Declining":cell.trend==="flat"?"Steady":"";
      rows.push([sq.name, d.label, color, trend, cell.note||"", templateName, d.key]);
    });
  });
  return rows.map(function(r){
    return r.map(function(v){
      var s = String(v==null?"":v);
      return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    }).join(",");
  }).join("\r\n");
}

document.getElementById("exportBtn").addEventListener("click", async function(){
  var csv = toCSV();
  try{
    var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
    if(downloads){
      await downloads.save({ filename:"squad-pulse-snapshot.csv", data: csv });
      return;
    }
  }catch(e){ /* fall through */ }
  // fallback: open a data URL the viewer can save manually (no capability available)
  var w = window.open("", "_blank");
  if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(csv)+"</pre>"); }
});

// ---------- JSON board export (beta) ----------
// A full board backup/restore format, unlike toCSV()'s flat ratings-only
// table: carries config, every dimension's/template's full definition
// (including scored-template statements/scoreBands/strategies, and each
// one's Hebrew i18n override verbatim -- state.js's dim.i18n.he.{...}/
// tpl.i18n.he.{...} passed through as-is, not flattened into a symmetric
// {en,he} shape the way scripts/export-template-translations.js does for
// its own, different, human-review purpose), and every squad's ratings.
// formatVersion:1 is the first version of this format -- no migration
// path needed yet, since nothing existing depends on an older shape.
// Deliberately excludes `sessions` (ephemeral, never meant to be portable)
// and any team-sync secret (a durable credential has no business in a
// downloadable file) -- this function never reads state.db/state.live or
// anything team-sync-related, so there's nothing to accidentally leak.
// Squads are matched on import by NAME, same as toCSV()/buildImportPlan()
// -- squad.id is a storage-generated value (see state.js/squads.js), never
// a portable identity, so it's deliberately left out of this export rather
// than implying a portability it doesn't have.
function buildBoardExport(){
  return {
    formatVersion: 1,
    exportedAt: nowIso(),
    config: Object.assign({}, state.config),
    dimensions: sortedDimensions().map(function(d){
      var out = { key:d.key, label:d.label, green:d.green||"", red:d.red||"", order:d.order };
      if(d.statements) out.statements = d.statements;
      if(d.scoreBands) out.scoreBands = d.scoreBands;
      if(d.strategies && d.strategies.length) out.strategies = d.strategies;
      if(d.i18n) out.i18n = d.i18n;
      return out;
    }),
    templates: (state.templates||[]).map(function(tpl){
      var out = { id:tpl.id, name:tpl.name, unit:tpl.unit, unitPlural:tpl.unitPlural, attribution:tpl.attribution||"", dimensions:tpl.dimensions };
      if(tpl.i18n) out.i18n = tpl.i18n;
      return out;
    }),
    squads: sortedSquads().map(function(sq){
      return { name:sq.name, order:sq.order, dimensions: sq.dimensions||{} };
    })
  };
}

function toJSON(){
  return JSON.stringify(buildBoardExport(), null, 2);
}

document.getElementById("exportJsonBtn").addEventListener("click", async function(){
  var json = toJSON();
  try{
    var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
    if(downloads){
      await downloads.save({ filename:"squad-pulse-board.json", data: json });
      return;
    }
  }catch(e){ /* fall through */ }
  var w = window.open("", "_blank");
  if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(json)+"</pre>"); }
});

// ---------- JSON board import (beta): squads & ratings ----------
// Story 13, item 3a. Scope is deliberately narrow, same split as the export
// side: this reads only a buildBoardExport()-shaped file's `squads` section
// -- dimensions/templates/config from the same file are item 3b, not built
// yet, and are surfaced as an informational note in the preview rather than
// silently ignored.
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
// "download a backup first" instead (same toJSON() this file already has).
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

// Item 3b's own validation, same parse-boundary rule as the squad/rating
// checks above -- a malformed dimensions/templates/config section must be
// rejected here, not thrown from inside buildDimensionImportPlan()/
// buildTemplateImportPlan()/renderImportPreview() later. Loose on purpose:
// only the fields this app actually reads are type-checked (green/red/
// statements/etc.); unknown extra fields are neither validated nor
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
// CONFIG_IMPORT_FIELDS is the single list both validation and planning
// (buildConfigImportPlan(), below) key off of. An unknown field is ignored,
// not rejected -- same forward-compat stance as the rest of this file.
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

// Pure planning step -- matches file squads to board squads by NAME (same
// rule toCSV()'s import already uses; squad.id is a storage artifact, never
// a portable identity -- see buildBoardExport()'s own comment above), and
// each rating's dimension by KEY against the board's CURRENT dimension set.
// A rating for a key not found today is reported, not guessed at, exactly
// like buildImportPlan()'s CSV equivalent.
// PR #12 review finding: two boards/devices never share a dimension's key
// (item 3b's own design -- see buildDimensionImportPlan()'s comment), so
// once a file also carries its own `dimensions` section, a rating's KEY is
// only ever meaningful to the SOURCE board. A destination board's real
// match is by LABEL -- either an already-existing dimension (resolved
// immediately here) or one about to be created in the same operation
// (resolved once it exists, via the pendingDimensionKey()/
// resolvePendingDimensionKeys() pair below).
var PENDING_DIMENSION_PREFIX = "pending-dimension:";
function pendingDimensionKey(label){ return PENDING_DIMENSION_PREFIX + label; }
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

  var patches = [], newSquadNames = [], skipped = [], ratingCount = 0;
  var fileNameKeys = {};
  (data.squads || []).forEach(function(fs){
    var name = (fs.name || "").trim();
    if(!name) return;
    fileNameKeys[name.toLowerCase()] = true;
    var existing = existingByName[name.toLowerCase()] || null;
    var fileDims = {};
    Object.keys(fs.dimensions || {}).forEach(function(key){
      var dim = dimByKeyMap[key];
      var label = fileDimKeyToLabel[key];
      if(!dim && label) dim = dimByLabelMap[label.trim().toLowerCase()];
      if(!dim && label && extraLabelSet[label.trim().toLowerCase()]){
        fileDims[pendingDimensionKey(label)] = fs.dimensions[key];
        ratingCount++;
        return;
      }
      if(!dim){ skipped.push({ squad:name, dimension:key, reason:"dimension not found" }); return; }
      fileDims[dim.key] = fs.dimensions[key];
      ratingCount++;
    });
    patches.push({ name:name, existing:existing, order:fs.order, fileDims:fileDims });
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
    ratingCount:ratingCount, squadsToRemove:squadsToRemove, clearedRatings:clearedRatings
  };
}

// Pure per-squad merge math, split out from applySquadImportPlan() so the
// MERGE-keeps-extras / REPLACE-clears-extras rule is directly unit-testable
// without a state/db fixture.
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
  return plan.ratingCount>0 || plan.newSquadNames.length>0 || plan.squadsToRemove.length>0 || plan.clearedRatings.length>0;
}

// ---------- item 3b: dimensions/templates/board-settings import ----------
// Same file, same preview modal, same Merge/Replace toggle as the squads/
// ratings import above -- these are its sibling planning functions for the
// rest of what buildBoardExport() puts in the file.
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

var jsonFileInput = document.getElementById("jsonFileInput");
var importJsonBackdrop = document.getElementById("importJsonBackdrop");
var pendingSquadImportPlan = null;
var pendingDimensionImportPlan = null;
var pendingTemplateImportPlan = null;
var pendingConfigImportChanges = null;
var pendingSquadImportMode = "merge";
var pendingImportScope = { squads:true, templates:true };

document.getElementById("importJsonBtn").addEventListener("click", function(){ jsonFileInput.click(); });

jsonFileInput.addEventListener("change", function(){
  var file = jsonFileInput.files && jsonFileInput.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var parsed = parseBoardImportFile(String(reader.result || ""));
    if(!parsed.ok){
      renderJsonImportError(parsed);
    } else {
      pendingSquadImportMode = "merge";
      pendingImportScope = { squads:true, templates:true };
      renderJsonImportPreview(parsed.data);
    }
    importJsonBackdrop.hidden = false;
    jsonFileInput.value = "";
  };
  reader.onerror = function(){ diag("JSON import: could not read the selected file."); jsonFileInput.value = ""; };
  reader.readAsText(file);
});

function renderJsonImportError(parsed){
  var body;
  if(parsed.error === "unsupported-version"){
    body = t("importJson.errorUnsupportedVersion", { fileVersion:parsed.fileVersion, appVersion:SUPPORTED_BOARD_FORMAT_VERSION });
  } else {
    body = t("importJson.errorMalformed");
  }
  document.getElementById("importJsonBody").innerHTML =
    '<div class="error-state"><h4>'+esc(t("importJson.errorTitle"))+'</h4><p>'+esc(body)+'</p></div>' +
    '<div class="modal-actions"><button class="btn ghost" id="importJsonCloseErr" type="button">'+esc(t("importJson.close"))+'</button></div>';
  document.getElementById("importJsonCloseErr").addEventListener("click", closeSquadImport);
}

// t() has no built-in pluralization -- same convention as templates.js's
// templates.meta.dimensionsOne/dimensionsMany key pairs, since Hebrew's
// plural grammar isn't just an English "+s" either way.
function countKey(base, count){ return base + (count===1 ? "One" : "Many"); }

// {field: i18n key} for buildConfigImportPlan()'s diff rows -- CONFIG_IMPORT_FIELDS
// is the source list; this just names each one for display.
var CONFIG_FIELD_I18N_KEY = {
  unit: "importJson.configFieldUnit", unitPlural: "importJson.configFieldUnitPlural",
  activeTemplateName: "importJson.configFieldActiveTemplateName", attribution: "importJson.configFieldAttribution"
};

// Shared chip-row renderer for the {patches, added, toRemove} plan shape --
// used for both dimensions and templates, same "no changes" fallback shown
// in the reviewed mockup.
function entityChipsHtml(plan, newKeyBase, updatedKeyBase, removedKeyBase){
  var updatedCount = plan.patches.filter(function(p){ return p.existing; }).length;
  var chips = [];
  if(plan.added.length) chips.push('<span class="chip ok">'+esc(t(countKey(newKeyBase, plan.added.length), { count:plan.added.length }))+'</span>');
  if(updatedCount) chips.push('<span class="chip">'+esc(t(countKey(updatedKeyBase, updatedCount), { count:updatedCount }))+'</span>');
  if(plan.mode==="replace" && plan.toRemove.length) chips.push('<span class="chip crit">'+esc(t(countKey(removedKeyBase, plan.toRemove.length), { count:plan.toRemove.length }))+'</span>');
  if(!chips.length) chips.push('<span class="chip none">'+esc(t("importJson.chipNoChanges"))+'</span>');
  return chips.join("");
}

function renderJsonImportPreview(fileData){
  var mode = pendingSquadImportMode;
  var scope = pendingImportScope;
  var dimPlan = buildDimensionImportPlan(fileData.dimensions, mode);
  var tplPlan = buildTemplateImportPlan(fileData.templates, mode);
  var configChanges = buildConfigImportPlan(fileData.config);
  // dimPlan.added is only a real promise once the Templates scope is
  // actually going to be applied -- otherwise no dimension will be
  // created this round, and a rating for one must still report "not
  // found" rather than claim a count it can't deliver (see
  // buildSquadImportPlan()'s own comment on extraDimensionLabels).
  var squadPlan = buildSquadImportPlan(fileData, mode, scope.templates ? dimPlan.added : undefined);
  pendingSquadImportPlan = squadPlan;
  pendingDimensionImportPlan = dimPlan;
  pendingTemplateImportPlan = tplPlan;
  pendingConfigImportChanges = configChanges;

  var squadsHtml = "";
  if(scope.squads){
    var updatedExisting = squadPlan.patches.filter(function(p){ return p.existing; }).length;
    var chips = '<div class="import-stats">' +
      '<span class="chip ok">'+esc(t(countKey("importJson.chipRatings", squadPlan.ratingCount), { count:squadPlan.ratingCount }))+'</span>' +
      '<span class="chip">'+esc(t(countKey("importJson.chipUpdated", updatedExisting), { count:updatedExisting, unit:unitLower(), unitPlural:unitPluralLower() }))+'</span>' +
      (squadPlan.newSquadNames.length ? '<span class="chip">'+esc(t(countKey("importJson.chipNew", squadPlan.newSquadNames.length), { count:squadPlan.newSquadNames.length, unit:unitLower(), unitPlural:unitPluralLower(), names:squadPlan.newSquadNames.join(", ") }))+'</span>' : '') +
      (squadPlan.mode==="replace" && squadPlan.squadsToRemove.length ? '<span class="chip crit">'+esc(t(countKey("importJson.chipRemoved", squadPlan.squadsToRemove.length), { count:squadPlan.squadsToRemove.length, unit:unitLower(), unitPlural:unitPluralLower(), names:squadPlan.squadsToRemove.map(function(s){return s.name;}).join(", ") }))+'</span>' : '') +
    '</div>';
    var skipsHtml = "";
    if(squadPlan.skipped.length){
      skipsHtml = '<div class="import-skips">' + squadPlan.skipped.slice(0,50).map(function(s){
        return '<div class="srow">'+esc(t("importJson.skippedRow", { squad:s.squad, dimension:s.dimension }))+'</div>';
      }).join("") + '</div>';
    }
    squadsHtml = '<div class="section-heading"><div class="field-label">'+esc(t("importJson.scopeSquads"))+'</div></div>' + chips + skipsHtml;
  }

  var restHtml = "";
  if(scope.templates){
    var configHtml = "";
    if(configChanges.length){
      configHtml = '<div class="section-heading"><div class="field-label">'+esc(t("importJson.configHeading"))+'</div></div>' +
        '<div class="config-diff">' + configChanges.map(function(c){
          return '<div class="crow"><span class="cfield">'+esc(t(CONFIG_FIELD_I18N_KEY[c.field] || c.field))+'</span>' +
            '<span class="cfrom">'+esc(c.from)+'</span><span class="carrow">&rarr;</span><span class="cto">'+esc(c.to)+'</span></div>';
        }).join("") + '</div>';
    }
    restHtml =
      '<div class="section-heading"><div class="field-label">'+esc(t("importJson.dimensionsHeading"))+'</div></div>' +
      '<div class="import-stats">'+entityChipsHtml(dimPlan, "importJson.chipDimNew", "importJson.chipDimUpdated", "importJson.chipDimRemoved")+'</div>' +
      '<div class="section-heading"><div class="field-label">'+esc(t("importJson.templatesHeading"))+'</div></div>' +
      '<div class="import-stats">'+entityChipsHtml(tplPlan, "importJson.chipTplNew", "importJson.chipTplUpdated", "importJson.chipTplRemoved")+'</div>' +
      configHtml;
  }

  var dangerGroups = [];
  if(scope.squads && squadPlan.mode === "replace" && (squadPlan.squadsToRemove.length || squadPlan.clearedRatings.length)){
    var squadItems = squadPlan.squadsToRemove.map(function(s){ return '<li>'+esc(t("importJson.willRemoveSquad", { name:s.name }))+'</li>'; })
      .concat(squadPlan.clearedRatings.map(function(c){ return '<li>'+esc(t("importJson.willClearRating", { squad:c.squad, dimension:c.dimension }))+'</li>'; }));
    dangerGroups.push('<ul>'+squadItems.join("")+'</ul>');
  }
  if(scope.templates && mode === "replace" && dimPlan.toRemove.length){
    dangerGroups.push('<span class="wgroup">'+esc(t("importJson.removedDimensionsGroupTitle"))+'</span><ul>' +
      dimPlan.toRemove.map(function(d){ return '<li>'+esc(t("importJson.willRemoveDimension", { name:d.label }))+'</li>'; }).join("") + '</ul>');
  }
  if(scope.templates && mode === "replace" && tplPlan.toRemove.length){
    dangerGroups.push('<span class="wgroup">'+esc(t("importJson.removedTemplatesGroupTitle"))+'</span><ul>' +
      tplPlan.toRemove.map(function(tpl){ return '<li>'+esc(t("importJson.willRemoveTemplate", { name:tpl.name }))+'</li>'; }).join("") + '</ul>');
  }

  var replaceWarning = "";
  if(dangerGroups.length){
    replaceWarning = '<div class="import-warning danger"><b>'+esc(t("importJson.replaceWarningTitle"))+'</b>' + dangerGroups.join("") +
      '<div class="backup-offer"><button class="btn" id="importJsonBackupBtn" type="button">'+esc(t("importJson.downloadBackup"))+'</button>' +
      '<span class="backup-done" id="importJsonBackupDone" hidden>'+esc(t("importJson.backupDone"))+'</span>' +
      '<span class="backup-failed" id="importJsonBackupFailed" hidden>'+esc(t("importJson.backupFailed"))+'</span></div></div>';
  }

  var scopeChosen = scope.squads || scope.templates;
  var hasChanges = (scope.squads && planHasChanges(squadPlan)) ||
    (scope.templates && (entityImportPlanHasChanges(dimPlan) || entityImportPlanHasChanges(tplPlan) || configChanges.length>0));

  document.getElementById("importJsonBody").innerHTML =
    '<h3>'+esc(t("importJson.title"))+'</h3>' +
    '<p class="hint">'+esc(t("importJson.hint"))+'</p>' +
    '<div class="field-label">'+esc(t("importJson.scopeLabel"))+'</div>' +
    '<div class="scope-row">' +
      '<label class="scope-check"><input type="checkbox" id="importJsonScopeSquads" '+(scope.squads?"checked":"")+'> '+esc(t("importJson.scopeSquads"))+'</label>' +
      '<label class="scope-check"><input type="checkbox" id="importJsonScopeTemplates" '+(scope.templates?"checked":"")+'> '+esc(t("importJson.scopeRest"))+'</label>' +
    '</div>' +
    '<div class="field-label">'+esc(t("importJson.modeLabel"))+'</div>' +
    '<div class="mode-switch">' +
      '<button class="mode-btn'+(mode==="merge"?" active":"")+'" data-mode="merge" type="button">'+esc(t("importJson.modeMerge"))+'</button>' +
      '<button class="mode-btn'+(mode==="replace"?" active":"")+'" data-mode="replace" type="button">'+esc(t("importJson.modeReplace"))+'</button>' +
    '</div>' +
    '<p class="external-tip">'+esc(t("importJson.externalTip"))+' <a href="https://meldmerge.org" target="_blank" rel="noopener">Meld</a>.</p>' +
    squadsHtml + restHtml + replaceWarning +
    (scopeChosen ? '' : '<p class="hint" style="margin-top:14px;">'+esc(t("importJson.noScopeHint"))+'</p>') +
    '<div class="modal-actions">' +
      '<button class="btn ghost" id="importJsonCancel" type="button">'+esc(t("importJson.cancel"))+'</button>' +
      '<button class="btn primary" id="importJsonApplyBtn" type="button" '+((scopeChosen && hasChanges) ? "" : "disabled")+'>'+esc(t("importJson.apply"))+'</button>' +
    '</div>';

  document.querySelectorAll("#importJsonBody .mode-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      pendingSquadImportMode = btn.getAttribute("data-mode");
      renderJsonImportPreview(fileData);
    });
  });
  document.getElementById("importJsonScopeSquads").addEventListener("change", function(){
    pendingImportScope = Object.assign({}, pendingImportScope, { squads: this.checked });
    renderJsonImportPreview(fileData);
  });
  document.getElementById("importJsonScopeTemplates").addEventListener("change", function(){
    pendingImportScope = Object.assign({}, pendingImportScope, { templates: this.checked });
    renderJsonImportPreview(fileData);
  });
  document.getElementById("importJsonCancel").addEventListener("click", closeSquadImport);
  document.getElementById("importJsonApplyBtn").addEventListener("click", function(){
    // Captured locally, not read back off the pending* module vars inside
    // applySquadsNow() -- closeSquadImport() (below) nulls those out
    // immediately, but when the Templates scope is checked,
    // applySquadsNow() itself doesn't run until AFTER
    // applyDimensionTemplateConfigImportPlan()'s own async new-dimension
    // creation resolves, by which point the module vars would already be
    // gone.
    var scope = pendingImportScope, squadPlan = pendingSquadImportPlan;
    function applySquadsNow(){
      if(!scope.squads || !squadPlan) return;
      // PR #12 review finding: a rating for a dimension this SAME import
      // is about to create was tracked as a pendingDimensionKey() marker
      // (see buildSquadImportPlan()) rather than a real key, precisely
      // because that key doesn't exist until the dimension import above
      // has actually run -- resolve it now, using the board's dimensions
      // as they stand after that.
      squadPlan.patches.forEach(function(p){ p.fileDims = resolvePendingDimensionKeys(p.fileDims); });
      applySquadImportPlan(squadPlan);
    }
    if(scope.templates){
      applyDimensionTemplateConfigImportPlan(pendingDimensionImportPlan, pendingTemplateImportPlan, pendingConfigImportChanges, pendingSquadImportMode, applySquadsNow);
    } else {
      applySquadsNow();
    }
    closeSquadImport();
  });
  var backupBtn = document.getElementById("importJsonBackupBtn");
  if(backupBtn){
    backupBtn.addEventListener("click", async function(){
      // Review finding (PR #7): the previous version showed "Backup
      // downloaded" unconditionally -- a rejected downloads.save() (caught
      // and swallowed) or a blocked fallback popup (window.open() returning
      // null) both still reached the success line. Since this backup is the
      // offered protection right before a destructive Replace, a false
      // "downloaded" is worse than no message at all: only show success once
      // a save/popup genuinely happened.
      var json = toJSON();
      var succeeded = false;
      try{
        var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
        if(downloads){
          await downloads.save({ filename:"squad-pulse-board-backup.json", data: json });
          succeeded = true;
        } else {
          var w = window.open("", "_blank");
          if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(json)+"</pre>"); succeeded = true; }
        }
      }catch(e){ succeeded = false; }
      document.getElementById("importJsonBackupDone").hidden = !succeeded;
      document.getElementById("importJsonBackupFailed").hidden = succeeded;
    });
  }
}

function closeSquadImport(){
  importJsonBackdrop.hidden = true;
  pendingSquadImportPlan = null;
  pendingDimensionImportPlan = null;
  pendingTemplateImportPlan = null;
  pendingConfigImportChanges = null;
}
importJsonBackdrop.addEventListener("click", function(e){ if(e.target===importJsonBackdrop) closeSquadImport(); });

function applySquadImportPlan(plan){
  if(!plan) return;
  var mode = plan.mode;
  var newOnes = plan.patches.filter(function(p){ return !p.existing; });
  function applyAll(){
    plan.patches.forEach(function(p){
      if(!p.existing) return;
      p.existing.dimensions = mergeSquadDimensions(p.existing.dimensions || {}, p.fileDims, mode);
      syncLiveIfConnected(function(){
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
        if(mode === "replace"){
          return state.db.collection("squads").doc(p.existing.id).set({
            name: p.existing.name, order: p.existing.order,
            dimensions: p.existing.dimensions, updatedAt: nowIso()
          });
        }
        var patch = { dimensions:{}, updatedAt: nowIso() };
        Object.keys(p.fileDims).forEach(function(k){ patch.dimensions[k] = p.fileDims[k]; });
        return state.db.collection("squads").doc(p.existing.id).update(patch);
      }, "JSON import write for squads/" + p.existing.id);
    });
    if(mode === "replace"){
      plan.squadsToRemove.forEach(function(s){ removeSquad(s.id); });
    }
    renderAll();
    diag("JSON import applied (" + mode + "): " + plan.ratingCount + " rating(s), " + newOnes.length + " new " + unitPluralLower() +
      (mode==="replace" ? ", " + plan.squadsToRemove.length + " removed" : "") + ".");
  }
  if(newOnes.length===0){ applyAll(); return; }
  var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
  if(state.live && state.db){
    showBusy("Importing " + newOnes.length + " new " + (newOnes.length===1?unitLower():unitPluralLower()) + "…");
    Promise.all(newOnes.map(function(p, i){
      return state.db.collection("squads").add({ name:p.name, order:maxOrder+1+i, dimensions:p.fileDims, updatedAt: nowIso() })
        .then(function(ref){ p.existing = { id: ref.id, name:p.name, order:maxOrder+1+i, dimensions:p.fileDims }; });
    })).then(function(){ hideBusy(); applyAll(); }).catch(function(err){
      hideBusy();
      diag("JSON import: creating new " + unitPluralLower() + " failed: " + (err && err.code ? err.code : String(err)));
    });
  } else {
    newOnes.forEach(function(p, i){
      var sq = { id:"local-"+Date.now()+"-"+i, name:p.name, order:maxOrder+1+i, dimensions:p.fileDims };
      state.squads.push(sq);
      p.existing = sq;
    });
    applyAll();
  }
}

// A matched dimension's file fields, excluding `order` -- same rule
// applySquadImportPlan()'s REPLACE write already applies to a matched
// squad's own order (only .dimensions is ever patched from the file; a
// dimension's position in its list is board-local sequencing, not
// something a file from another board should be allowed to scramble).
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

// Applies the dimensions/templates/board-settings plans buildDimensionImportPlan()/
// buildTemplateImportPlan()/buildConfigImportPlan() built. Mirrors
// applySquadImportPlan()'s own two-phase shape (create any brand-new
// entities first, since their ids only exist once the write returns; then
// apply every matched update, removal, and the config diff together).
// onDone (optional): called once every write here has been issued and
// state.dimensions/state.templates reflect the final result, including any
// newly-created dimension's real key -- the squads/ratings import (a
// separate plan/apply pair) uses this to resolve a rating for a
// dimension THIS call just created before writing that rating out (see
// the Apply-button handler and resolvePendingDimensionKeys()).
function applyDimensionTemplateConfigImportPlan(dimPlan, tplPlan, configChanges, mode, onDone){
  if(!dimPlan || !tplPlan) return;
  function applyMatchedAndConfig(){
    dimPlan.patches.forEach(function(p){
      if(!p.existing) return;
      var fields = dimensionImportFields(p.file);
      Object.assign(p.existing, fields);
      syncLiveIfConnected(function(){
        if(mode === "replace"){
          return state.db.collection("dimensions").doc(p.existing.key).set(Object.assign({ order:p.existing.order, updatedAt: nowIso() }, fields));
        }
        return state.db.collection("dimensions").doc(p.existing.key).update(Object.assign({ updatedAt: nowIso() }, fields));
      }, "JSON import write for dimensions/" + p.existing.key);
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
      syncLiveIfConnected(function(){
        return state.db.collection("templates").doc(p.existing.id).update(Object.assign({ updatedAt: nowIso() }, fields));
      }, "JSON import write for templates/" + p.existing.id);
    });
    if(mode === "replace"){
      dimPlan.toRemove.forEach(function(d){ removeDimension(d.key); });
      tplPlan.toRemove.forEach(function(tpl){ deleteTemplate(tpl.id); });
    }
    if(configChanges && configChanges.length){
      var newConfig = Object.assign({}, state.config);
      configChanges.forEach(function(c){ newConfig[c.field] = c.to; });
      state.config = newConfig;
      syncLiveIfConnected(function(){
        return state.db.doc("meta/config").set(Object.assign({}, newConfig, { updatedAt: nowIso() }));
      }, "JSON import write for meta/config");
    }
    renderAll();
    if(!dimBackdrop.hidden) renderDimList();
    if(!templatesBackdrop.hidden) renderTemplateList();
    diag("JSON import applied to dimensions/templates/board settings (" + mode + "): " +
      dimPlan.patches.filter(function(p){ return p.existing; }).length + " dimension(s) updated, " + dimPlan.added.length + " new" +
      (mode==="replace" ? ", " + dimPlan.toRemove.length + " removed" : "") + "; " +
      tplPlan.patches.filter(function(p){ return p.existing; }).length + " template(s) updated, " + tplPlan.added.length + " new" +
      (mode==="replace" ? ", " + tplPlan.toRemove.length + " removed" : "") + "; " +
      (configChanges ? configChanges.length : 0) + " board setting(s) changed.");
    if(onDone) onDone();
  }

  var newDims = dimPlan.patches.filter(function(p){ return !p.existing; });
  var newTpls = tplPlan.patches.filter(function(p){ return !p.existing; });
  if(newDims.length===0 && newTpls.length===0){ applyMatchedAndConfig(); return; }

  var maxDimOrder = state.dimensions.reduce(function(m,d){ return Math.max(m, d.order||0); }, 0);
  if(state.live && state.db){
    showBusy("Importing " + (newDims.length+newTpls.length) + " new item(s)…");
    var writes = newDims.map(function(p, i){
      var payload = Object.assign({ order: maxDimOrder+1+i, updatedAt: nowIso() }, dimensionImportFields(p.file));
      return state.db.collection("dimensions").add(payload).then(function(ref){ p.existing = Object.assign({ key: ref.id }, payload); });
    }).concat(newTpls.map(function(p){
      var payload = Object.assign({ createdAt: nowIso() }, templateImportFields(p.file));
      return state.db.collection("templates").add(payload).then(function(ref){ p.existing = Object.assign({ id: ref.id }, payload); });
    }));
    Promise.all(writes).then(function(){ hideBusy(); applyMatchedAndConfig(); }).catch(function(err){
      hideBusy();
      diag("JSON import: creating new dimensions/templates failed: " + (err && err.code ? err.code : String(err)));
    });
  } else {
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
    applyMatchedAndConfig();
  }
}

// ---------- CSV import ----------
var importBackdrop = document.getElementById("importBackdrop");
var csvFileInput = document.getElementById("csvFileInput");
var pendingImportPlan = null;

document.getElementById("importCsvBtn").addEventListener("click", function(){ csvFileInput.click(); });

csvFileInput.addEventListener("change", function(){
  var file = csvFileInput.files && csvFileInput.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var rows = parseCSV(String(reader.result||""));
      pendingImportPlan = buildImportPlan(rows);
      renderImportPreview(pendingImportPlan);
      document.getElementById("importUnitLabel").textContent = state.config.unit;
      document.getElementById("importUnitLabel2").textContent = state.config.unit;
      importBackdrop.hidden = false;
      diag("CSV parsed: " + rows.length + " row(s), " + pendingImportPlan.ratingCount + " rating(s) matched, " + pendingImportPlan.skipped.length + " skipped.");
    }catch(err){
      diag("CSV import: failed to parse file: " + (err && err.message ? err.message : String(err)));
    }
    csvFileInput.value = ""; // allow re-selecting the same file later
  };
  reader.onerror = function(){ diag("CSV import: could not read the selected file."); csvFileInput.value = ""; };
  reader.readAsText(file);
});

function parseCSV(text){
  var rows = [], row = [], field = "", inQuotes = false;
  for(var i=0;i<text.length;i++){
    var c = text[i];
    if(inQuotes){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else {
      if(c === '"'){ inQuotes = true; }
      else if(c === ','){ row.push(field); field = ""; }
      else if(c === '\r'){ /* ignore -- \n (below) ends the row */ }
      else if(c === '\n'){ row.push(field); field = ""; rows.push(row); row = []; }
      else { field += c; }
    }
  }
  if(field.length>0 || row.length>0){ row.push(field); rows.push(row); }
  return rows.filter(function(r){ return !(r.length<=1 && (r[0]||"").trim()===""); });
}

function colorFromWord(w){
  w = String(w||"").trim().toLowerCase();
  if(w==="green") return "good";
  if(w==="yellow") return "warn";
  if(w==="red") return "crit";
  return "unscored";
}
function trendFromWord(w){
  w = String(w||"").trim().toLowerCase();
  if(w==="improving") return "up";
  if(w==="declining") return "down";
  if(w==="steady") return "flat";
  return undefined;
}

// Maps the header row to column positions by NAME (case-insensitive), so
// reordered columns still import correctly. Column 0 is always read as the
// entity-name column regardless of its header text, since that header is
// dynamic (it's whatever the unit label is -- "Squad", "Team", "Person"...).
// If none of the known header names are recognized at all (e.g. every header
// was renamed, or blanked), falls back to toCSV()'s fixed column order so
// renaming headers never breaks an import.
function mapImportColumns(headerRow){
  var idx = { dimension:1, health:2, trend:3, note:4, template:5, dimensionKey:6 };
  var recognized = 0;
  (headerRow||[]).forEach(function(h, i){
    var key = String(h||"").trim().toLowerCase();
    if(key==="dimension"){ idx.dimension = i; recognized++; }
    else if(key==="health"){ idx.health = i; recognized++; }
    else if(key==="trend"){ idx.trend = i; recognized++; }
    else if(key==="note"){ idx.note = i; recognized++; }
    else if(key==="template"){ idx.template = i; recognized++; }
    else if(key==="dimension key" || key==="dimensionkey" || key==="key"){ idx.dimensionKey = i; recognized++; }
  });
  idx.recognized = recognized;
  return idx;
}

// Reads the columns toCSV() writes: <unit>, Dimension, Health, Trend, Note,
// Template (files exported before Template existed still import fine --
// that column just reads as blank). Matches squads by name (creating ones
// that don't exist yet) and dimensions by label against the CURRENT
// dimension set -- a row whose dimension isn't found today is reported, not
// guessed at. Also surfaces which template the file itself was exported
// under, so a mismatch against the board's current template can be flagged
// rather than just silently producing a pile of "not found" rows.
function buildImportPlan(rows){
  var cols = mapImportColumns(rows[0]);
  var dataRows = rows.slice(1); // first row is always the header, whatever it says
  var dimByKeyMap = {};
  var dimByLabel = {};
  sortedDimensions().forEach(function(d){
    dimByKeyMap[d.key] = d;
    dimByLabel[d.label.trim().toLowerCase()] = d;
  });
  var existingByName = {};
  state.squads.forEach(function(s){ existingByName[s.name.trim().toLowerCase()] = s; });

  var squadPatches = {}, order = [], newSquadNames = [], skipped = [], ratingCount = 0;
  var fileTemplateNames = [], seenTemplateNames = {};

  dataRows.forEach(function(r, idx){
    var squadName = (r[0]||"").trim();
    var dimLabel = (r[cols.dimension]||"").trim();
    var dimKeyVal = (r[cols.dimensionKey]||"").trim();
    var fileTemplate = (r[cols.template]||"").trim();
    if(fileTemplate && !seenTemplateNames[fileTemplate]){ seenTemplateNames[fileTemplate] = true; fileTemplateNames.push(fileTemplate); }
    if(!squadName || (!dimLabel && !dimKeyVal)) return;
    // match by the stable Dimension Key first -- it still resolves correctly
    // after a dimension's label has been renamed or translated (e.g. to
    // Hebrew); fall back to matching by label text for older exports (no
    // Dimension Key column) or hand-edited/foreign files
    var dim = (dimKeyVal && dimByKeyMap[dimKeyVal]) || dimByLabel[dimLabel.toLowerCase()];
    if(!dim){
      skipped.push({ row: idx+2, squad: squadName, dimension: dimLabel || dimKeyVal, reason: "dimension not found" });
      return;
    }
    var nameKey = squadName.toLowerCase();
    if(!squadPatches[nameKey]){
      squadPatches[nameKey] = { name: squadName, existing: existingByName[nameKey] || null, dims: {} };
      order.push(nameKey);
      if(!existingByName[nameKey]) newSquadNames.push(squadName);
    }
    squadPatches[nameKey].dims[dim.key] = { color: colorFromWord(r[cols.health]), trend: trendFromWord(r[cols.trend]), note: (r[cols.note]||"").trim() };
    ratingCount++;
  });

  var patches = order.map(function(k){ return squadPatches[k]; });
  return {
    patches: patches, newSquadNames: newSquadNames, skipped: skipped, ratingCount: ratingCount,
    fileTemplateNames: fileTemplateNames,
    currentTemplateName: state.config.activeTemplateName || "Custom"
  };
}

function renderImportPreview(plan){
  var updatedExisting = plan.patches.filter(function(p){ return p.existing; }).length;
  var chips = '<div class="import-stats">' +
    '<span class="chip ok">'+plan.ratingCount+' rating'+(plan.ratingCount===1?"":"s")+' to import</span>' +
    '<span class="chip">'+updatedExisting+' existing '+esc(updatedExisting===1?unitLower():unitPluralLower())+' updated</span>' +
    (plan.newSquadNames.length ? '<span class="chip">'+plan.newSquadNames.length+' new '+esc(plan.newSquadNames.length===1?unitLower():unitPluralLower())+': '+plan.newSquadNames.map(esc).join(", ")+'</span>' : '') +
    (plan.skipped.length ? '<span class="chip warn">'+plan.skipped.length+' row'+(plan.skipped.length===1?"":"s")+' skipped</span>' : '') +
  '</div>';

  // flag when the file's own recorded template doesn't match what's
  // active now -- the likeliest reason dimension names would fail to match
  var templateWarning = "";
  if(plan.fileTemplateNames.length > 1){
    templateWarning = '<div class="import-warning">This file mixes rows exported under different templates (' +
      plan.fileTemplateNames.map(esc).join(", ") + '). Ratings may get matched to the wrong dimension if any names overlap by coincidence.</div>';
  } else if(plan.fileTemplateNames.length === 1 && plan.fileTemplateNames[0] !== plan.currentTemplateName){
    templateWarning = '<div class="import-warning">This file was exported under &ldquo;' + esc(plan.fileTemplateNames[0]) +
      '&rdquo;, but the board is currently on &ldquo;' + esc(plan.currentTemplateName) +
      '&rdquo;. Dimension names may not line up &mdash; that’s the most likely reason for any rows skipped below. Switch back to that template first if you want every row to match.</div>';
  } else if(plan.fileTemplateNames.length === 0){
    templateWarning = '<div class="import-warning">This file doesn’t record which template it was exported under (an older export). Rows are still matched by dimension name only.</div>';
  }

  var skipsHtml = "";
  if(plan.skipped.length){
    skipsHtml = '<div class="import-skips">' + plan.skipped.slice(0,50).map(function(s){
      return '<div class="srow">Row '+s.row+': “'+esc(s.dimension)+'” not found among current dimensions ('+esc(s.squad)+')</div>';
    }).join("") + '</div>';
  }
  document.getElementById("importSummary").innerHTML = (plan.ratingCount===0 && plan.skipped.length===0)
    ? '<p class="hint" style="margin:0;">No matching rows found in this file.</p>' + templateWarning
    : templateWarning + chips + skipsHtml;
  var applyBtn = document.getElementById("importApplyBtn");
  applyBtn.disabled = plan.ratingCount===0;
}

function closeImport(){ importBackdrop.hidden = true; pendingImportPlan = null; }
document.getElementById("importCancel").addEventListener("click", closeImport);
importBackdrop.addEventListener("click", function(e){ if(e.target===importBackdrop) closeImport(); });

document.getElementById("importApplyBtn").addEventListener("click", function(){
  if(!pendingImportPlan || pendingImportPlan.ratingCount===0) { closeImport(); return; }
  applyImportPlan(pendingImportPlan);
  closeImport();
});

function applyImportRatingsToSquad(sq, dims){
  // clone before mutating -- sq.dimensions may be a plain object we built
  // ourselves, but stay consistent with the frozen-snapshot precaution used
  // everywhere else ratings are written
  sq.dimensions = Object.assign({}, sq.dimensions);
  Object.keys(dims).forEach(function(dimKey){
    var d = dims[dimKey];
    var rec = { color: d.color };
    if(d.trend) rec.trend = d.trend;
    if(d.note) rec.note = d.note;
    sq.dimensions[dimKey] = rec;
  });
  syncLiveIfConnected(function(){
    var patch = { dimensions:{}, updatedAt: nowIso() };
    Object.keys(dims).forEach(function(dimKey){ patch.dimensions[dimKey] = sq.dimensions[dimKey]; });
    return state.db.collection("squads").doc(sq.id).update(patch);
  }, "CSV import write for squads/" + sq.id);
}

// See helpers.js's matching block for why this exists and why it's safe:
// a no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseCSV: parseCSV, colorFromWord: colorFromWord, trendFromWord: trendFromWord,
    mapImportColumns: mapImportColumns, buildImportPlan: buildImportPlan, toCSV: toCSV,
    buildBoardExport: buildBoardExport, toJSON: toJSON,
    parseBoardImportFile: parseBoardImportFile, buildSquadImportPlan: buildSquadImportPlan,
    mergeSquadDimensions: mergeSquadDimensions, planHasChanges: planHasChanges,
    buildDimensionImportPlan: buildDimensionImportPlan, buildTemplateImportPlan: buildTemplateImportPlan,
    buildConfigImportPlan: buildConfigImportPlan, entityImportPlanHasChanges: entityImportPlanHasChanges,
    pendingDimensionKey: pendingDimensionKey, resolvePendingDimensionKeys: resolvePendingDimensionKeys
  };
}

function applyImportPlan(plan){
  var newOnes = plan.patches.filter(function(p){ return !p.existing; });
  function applyAll(){
    plan.patches.forEach(function(p){ if(p.existing) applyImportRatingsToSquad(p.existing, p.dims); });
    renderAll();
    diag("CSV import applied: " + plan.ratingCount + " rating(s) across " + plan.patches.length + " " + unitPluralLower() + ".");
  }
  if(newOnes.length===0){ applyAll(); return; }
  var maxOrder = state.squads.reduce(function(m,s){ return Math.max(m, s.order||0); }, 0);
  if(state.live && state.db){
    showBusy("Importing " + newOnes.length + " new " + (newOnes.length===1?unitLower():unitPluralLower()) + "…");
    Promise.all(newOnes.map(function(p, i){
      return state.db.collection("squads").add({ name:p.name, order:maxOrder+1+i, dimensions:{}, updatedAt: nowIso() })
        .then(function(ref){ p.existing = { id: ref.id, name:p.name, order:maxOrder+1+i, dimensions:{} }; });
    })).then(function(){ hideBusy(); applyAll(); }).catch(function(err){
      hideBusy();
      diag("CSV import: creating new " + unitPluralLower() + " failed: " + (err && err.code ? err.code : String(err)));
    });
  } else {
    newOnes.forEach(function(p, i){
      var sq = { id:"local-"+Date.now()+"-"+i, name:p.name, order:maxOrder+1+i, dimensions:{} };
      state.squads.push(sq);
      p.existing = sq;
    });
    applyAll();
  }
}
