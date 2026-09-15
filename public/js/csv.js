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

// Validates each squad entry's shape at the parse boundary -- found missing
// in review (PR #7): buildSquadImportPlan() ran directly inside
// FileReader.onload with no try/catch, so a null entry or a non-string
// `name` threw an uncaught exception instead of showing the malformed-file
// error UI. `dimensions` isn't required (a squad can have none yet), but if
// present must be a plain object -- individual rating VALUES are still
// whatever the caller wrote, matched against real dimensions/colors by
// buildSquadImportPlan() itself, same as CSV import already tolerates.
function isPlainObject(v){ return !!v && typeof v === "object" && !Array.isArray(v); }

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
    if(fs.dimensions !== undefined && !isPlainObject(fs.dimensions)) return { ok:false, error:"invalid-squad" };
  }
  return { ok:true, data:data };
}

// Pure planning step -- matches file squads to board squads by NAME (same
// rule toCSV()'s import already uses; squad.id is a storage artifact, never
// a portable identity -- see buildBoardExport()'s own comment above), and
// each rating's dimension by KEY against the board's CURRENT dimension set.
// A rating for a key not found today is reported, not guessed at, exactly
// like buildImportPlan()'s CSV equivalent.
function buildSquadImportPlan(data, mode){
  var dimByKeyMap = {};
  sortedDimensions().forEach(function(d){ dimByKeyMap[d.key] = d; });
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
      if(!dimByKeyMap[key]){ skipped.push({ squad:name, dimension:key, reason:"dimension not found" }); return; }
      fileDims[key] = fs.dimensions[key];
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

var jsonFileInput = document.getElementById("jsonFileInput");
var importJsonBackdrop = document.getElementById("importJsonBackdrop");
var pendingSquadImportPlan = null;
var pendingSquadImportMode = "merge";

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
      pendingSquadImportPlan = buildSquadImportPlan(parsed.data, pendingSquadImportMode);
      renderSquadImportPreview(parsed.data, pendingSquadImportPlan);
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

function renderSquadImportPreview(fileData, plan){
  var extraSections = [];
  if(Array.isArray(fileData.dimensions) && fileData.dimensions.length){
    var otherParts = [];
    if(fileData.dimensions.length) otherParts.push(t("importJson.scopeDimensions", { count:fileData.dimensions.length }));
    if(Array.isArray(fileData.templates) && fileData.templates.length) otherParts.push(t("importJson.scopeTemplates", { count:fileData.templates.length }));
    if(fileData.config) otherParts.push(t("importJson.scopeConfig"));
    extraSections.push('<div class="scope-note">'+esc(t("importJson.scopeNote", { list: otherParts.join(", ") }))+'</div>');
  }

  var updatedExisting = plan.patches.filter(function(p){ return p.existing; }).length;
  var chips = '<div class="import-stats">' +
    '<span class="chip ok">'+esc(t(countKey("importJson.chipRatings", plan.ratingCount), { count:plan.ratingCount }))+'</span>' +
    '<span class="chip">'+esc(t(countKey("importJson.chipUpdated", updatedExisting), { count:updatedExisting, unit:unitLower(), unitPlural:unitPluralLower() }))+'</span>' +
    (plan.newSquadNames.length ? '<span class="chip">'+esc(t(countKey("importJson.chipNew", plan.newSquadNames.length), { count:plan.newSquadNames.length, unit:unitLower(), unitPlural:unitPluralLower(), names:plan.newSquadNames.join(", ") }))+'</span>' : '') +
    (plan.mode==="replace" && plan.squadsToRemove.length ? '<span class="chip crit">'+esc(t(countKey("importJson.chipRemoved", plan.squadsToRemove.length), { count:plan.squadsToRemove.length, unit:unitLower(), unitPlural:unitPluralLower(), names:plan.squadsToRemove.map(function(s){return s.name;}).join(", ") }))+'</span>' : '') +
  '</div>';

  var replaceWarning = "";
  if(plan.mode === "replace" && (plan.squadsToRemove.length || plan.clearedRatings.length)){
    var items = plan.squadsToRemove.map(function(s){ return '<li>'+esc(t("importJson.willRemoveSquad", { name:s.name }))+'</li>'; })
      .concat(plan.clearedRatings.map(function(c){ return '<li>'+esc(t("importJson.willClearRating", { squad:c.squad, dimension:c.dimension }))+'</li>'; }));
    replaceWarning = '<div class="import-warning danger"><b>'+esc(t("importJson.replaceWarningTitle"))+'</b><ul>'+items.join("")+'</ul>' +
      '<div class="backup-offer"><button class="btn" id="importJsonBackupBtn" type="button">'+esc(t("importJson.downloadBackup"))+'</button>' +
      '<span class="backup-done" id="importJsonBackupDone" hidden>'+esc(t("importJson.backupDone"))+'</span>' +
      '<span class="backup-failed" id="importJsonBackupFailed" hidden>'+esc(t("importJson.backupFailed"))+'</span></div></div>';
  }

  var skipsHtml = "";
  if(plan.skipped.length){
    skipsHtml = '<div class="import-skips">' + plan.skipped.slice(0,50).map(function(s){
      return '<div class="srow">'+esc(t("importJson.skippedRow", { squad:s.squad, dimension:s.dimension }))+'</div>';
    }).join("") + '</div>';
  }

  document.getElementById("importJsonBody").innerHTML =
    '<h3>'+esc(t("importJson.title"))+'</h3>' +
    '<p class="hint">'+esc(t("importJson.hint"))+'</p>' +
    '<div class="field-label">'+esc(t("importJson.modeLabel"))+'</div>' +
    '<div class="mode-switch">' +
      '<button class="mode-btn'+(plan.mode==="merge"?" active":"")+'" data-mode="merge" type="button">'+esc(t("importJson.modeMerge"))+'</button>' +
      '<button class="mode-btn'+(plan.mode==="replace"?" active":"")+'" data-mode="replace" type="button">'+esc(t("importJson.modeReplace"))+'</button>' +
    '</div>' +
    '<p class="external-tip">'+esc(t("importJson.externalTip"))+' <a href="https://meldmerge.org" target="_blank" rel="noopener">Meld</a>.</p>' +
    chips + replaceWarning + skipsHtml + extraSections.join("") +
    '<div class="modal-actions">' +
      '<button class="btn ghost" id="importJsonCancel" type="button">'+esc(t("importJson.cancel"))+'</button>' +
      '<button class="btn primary" id="importJsonApplyBtn" type="button" '+(planHasChanges(plan) ? "" : "disabled")+'>'+esc(t("importJson.apply"))+'</button>' +
    '</div>';

  document.querySelectorAll("#importJsonBody .mode-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      pendingSquadImportMode = btn.getAttribute("data-mode");
      pendingSquadImportPlan = buildSquadImportPlan(fileData, pendingSquadImportMode);
      renderSquadImportPreview(fileData, pendingSquadImportPlan);
    });
  });
  document.getElementById("importJsonCancel").addEventListener("click", closeSquadImport);
  document.getElementById("importJsonApplyBtn").addEventListener("click", function(){
    applySquadImportPlan(pendingSquadImportPlan);
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

function closeSquadImport(){ importJsonBackdrop.hidden = true; pendingSquadImportPlan = null; }
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
    mergeSquadDimensions: mergeSquadDimensions, planHasChanges: planHasChanges
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
