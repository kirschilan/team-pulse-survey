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
    mapImportColumns: mapImportColumns, buildImportPlan: buildImportPlan, toCSV: toCSV
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
