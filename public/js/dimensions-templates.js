"use strict";


// ---------- dimension manager ----------
var dimBackdrop = document.getElementById("dimBackdrop");

function openDimManager(){
  renderDimList();
  dimBackdrop.hidden = false;
}
function closeDimManager(){ dimBackdrop.hidden = true; }
document.getElementById("dimManageBtn").addEventListener("click", openDimManager);
document.getElementById("dimDoneBtn").addEventListener("click", closeDimManager);
dimBackdrop.addEventListener("click", function(e){ if(e.target===dimBackdrop) closeDimManager(); });

function renderDimList(){
  var dims = sortedDimensions();
  var html = dims.map(function(d, i){
    return '<div class="dim-row" data-key="'+esc(d.key)+'">' +
      '<div class="dim-row-top">' +
        '<button class="icon-btn dim-up" title="Move up" type="button" '+(i===0?"disabled":"")+'>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 15l7-7 7 7"/></svg></button>' +
        '<button class="icon-btn dim-down" title="Move down" type="button" '+(i===dims.length-1?"disabled":"")+'>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 9l7 7 7-7"/></svg></button>' +
        '<input class="dim-label" data-field="label" value="'+esc(d.label)+'" aria-label="Dimension name" placeholder="Dimension name" dir="auto">' +
        '<button class="icon-btn danger dim-del" title="Remove dimension" type="button">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="fields">' +
        '<div><label class="grn">Green looks like</label><textarea data-field="green" placeholder="What healthy looks like" dir="auto">'+esc(d.green)+'</textarea></div>' +
        '<div><label class="rd">Red looks like</label><textarea data-field="red" placeholder="What unhealthy looks like" dir="auto">'+esc(d.red)+'</textarea></div>' +
      '</div>' +
      (isStatementDimension(d) ?
        '<p class="hint" style="margin:8px 0 0;">Scored from '+d.statements.length+' self-assessment statements (not editable here yet) — rating this dimension still uses the swatches above until the statement-based entry flow ships.</p>' : "") +
    '</div>';
  }).join("");
  document.getElementById("dimList").innerHTML = html || '<p class="hint" style="margin:0;">No dimensions yet — add your first one below.</p>';
  bindDimListEvents();
}

function bindDimListEvents(){
  document.querySelectorAll("#dimList .dim-row").forEach(function(row){
    var key = row.getAttribute("data-key");
    row.querySelectorAll("[data-field]").forEach(function(field){
      field.addEventListener("change", function(){
        updateDimensionField(key, field.getAttribute("data-field"), field.value);
      });
    });
    var upBtn = row.querySelector(".dim-up");
    var downBtn = row.querySelector(".dim-down");
    if(upBtn) upBtn.addEventListener("click", function(){ moveDimension(key, -1); });
    if(downBtn) downBtn.addEventListener("click", function(){ moveDimension(key, 1); });
    var delBtn = row.querySelector(".dim-del");
    if(delBtn) delBtn.addEventListener("click", function(){
      var d = dimByKey(key);
      openConfirm(
        "Remove dimension?",
        "Remove “" + (d ? d.label : "this dimension") + "” from the grid? Any ratings already given for it will be hidden (not deleted) unless you add it back.",
        function(){ removeDimension(key); },
        "Remove"
      );
    });
  });
}

function updateDimensionField(key, field, value){
  var d = dimByKey(key);
  if(!d) return;
  d[field] = value;
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    var patch = {}; patch[field] = value; patch.updatedAt = nowIso();
    return state.db.collection("dimensions").doc(key).update(patch);
  }, "Dimension field update for " + key);
}

function moveDimension(key, delta){
  var dims = sortedDimensions();
  var idx = dims.findIndex(function(d){ return d.key===key; });
  var swapIdx = idx + delta;
  if(idx<0 || swapIdx<0 || swapIdx>=dims.length) return;
  var a = dims[idx], b = dims[swapIdx];
  var tmp = a.order; a.order = b.order; b.order = tmp;
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    return state.db.collection("dimensions").doc(a.key).update({ order:a.order, updatedAt: nowIso() });
  }, "Move dimension " + a.key);
  syncLiveIfConnected(function(){
    return state.db.collection("dimensions").doc(b.key).update({ order:b.order, updatedAt: nowIso() });
  }, "Move dimension " + b.key);
}

function addDimension(){
  var maxOrder = state.dimensions.reduce(function(m,d){ return Math.max(m, d.order||0); }, 0);
  var payload = { label:"New dimension", green:"", red:"", order:maxOrder+1, updatedAt: nowIso() };
  liveOr(function(){
    // no local push -- the live dimensions listener delivers this write
    // straight back (latency-compensated) and fully replaces state.dimensions
    return state.db.collection("dimensions").add(payload)
      .catch(function(err){ diag("Add dimension failed: " + (err && err.code ? err.code : String(err))); });
  }, function(){
    state.dimensions.push({ key:"local-dim-"+Date.now(), label:payload.label, green:"", red:"", order:payload.order });
    renderAll();
    renderDimList();
  });
}
document.getElementById("addDimBtn").addEventListener("click", addDimension);

function removeDimension(key){
  state.dimensions = state.dimensions.filter(function(d){ return d.key!==key; });
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    return state.db.collection("dimensions").doc(key).delete();
  }, "Remove dimension " + key);
}

// ---------- templates ----------
var templatesBackdrop = document.getElementById("templatesBackdrop");

function openTemplates(){
  renderTemplateList();
  templatesBackdrop.hidden = false;
}
function closeTemplates(){ templatesBackdrop.hidden = true; }
document.getElementById("templatesBtn").addEventListener("click", openTemplates);
document.getElementById("tplCloseBtn").addEventListener("click", closeTemplates);
templatesBackdrop.addEventListener("click", function(e){ if(e.target===templatesBackdrop) closeTemplates(); });

function templateRowHtml(t, opts){
  var scoredCount = (t.dimensions||[]).filter(isStatementDimension).length;
  var meta = t.dimensions.length+' dimension'+(t.dimensions.length===1?"":"s")+(t.unit?(' &middot; rates '+esc(t.unitPlural||t.unit)):"") +
    (scoredCount ? (' &middot; '+scoredCount+' scored from statements') : "");
  return '<div class="tpl-row" data-id="'+esc(t.id)+'">' +
    '<div class="tinfo">' +
      '<div class="tname" dir="auto">'+esc(t.name)+'</div>' +
      '<div class="tmeta">'+meta+'</div>' +
    '</div>' +
    '<button class="btn" data-action="load" type="button">Load</button>' +
    (opts && opts.deletable === false ? "" :
      '<button class="icon-btn danger" data-action="delete" title="Delete template" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/></svg></button>') +
  '</div>';
}

function renderTemplateList(){
  var starterHtml = STARTER_TEMPLATES.map(function(t){ return templateRowHtml(t, { deletable:false }); }).join("");
  var ownHtml = state.templates.map(function(t){ return templateRowHtml(t); }).join("");
  var html =
    '<div class="field-label" style="margin-top:0;">Starter templates</div>' +
    starterHtml +
    '<div class="field-label">Your templates</div>' +
    (ownHtml || '<p class="hint" style="margin:0;">No saved templates yet — set up your dimensions the way you want, then “Save current as template” below.</p>');
  document.getElementById("tplList").innerHTML = html;
  document.querySelectorAll("#tplList .tpl-row").forEach(function(row){
    var id = row.getAttribute("data-id");
    var t = findAnyTemplateById(id);
    if(!t) return;
    row.querySelector('[data-action="load"]').addEventListener("click", function(){
      openConfirm(
        "Load “" + t.name + "”?",
        "This replaces your current " + state.dimensions.length + " dimension(s) with " + t.name + "’s " + t.dimensions.length + ". Ratings tied to dimensions that don't carry over will be hidden, not deleted.",
        function(){ loadTemplate(t); },
        "Load template"
      );
    });
    var delBtn = row.querySelector('[data-action="delete"]');
    if(delBtn) delBtn.addEventListener("click", function(){
      openConfirm(
        "Delete “" + t.name + "”?",
        "This removes the saved template. It won't affect your current dimensions or ratings.",
        function(){ deleteTemplate(t.id); },
        "Delete"
      );
    });
  });
}

document.getElementById("tplSaveBtn").addEventListener("click", function(){
  var input = document.getElementById("tplNameInput");
  var name = input.value.trim();
  if(!name){ input.focus(); return; }
  saveCurrentAsTemplate(name);
  input.value = "";
});

function saveCurrentAsTemplate(name){
  // carry each dimension's live key along -- loading this template back later
  // reuses the same dimension ids, so ratings already given reconnect instead
  // of the load creating fresh (and therefore rating-less) dimensions
  var dims = sortedDimensions().map(function(d){
    var spec = { key:d.key, label:d.label, green:d.green, red:d.red, order:d.order };
    if(isStatementDimension(d)) spec.statements = d.statements;
    if(d.scoreBands) spec.scoreBands = d.scoreBands;
    if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
    return spec;
  });
  var payload = {
    name:name, unit:state.config.unit, unitPlural:state.config.unitPlural,
    attribution:"", dimensions:dims, createdAt: nowIso()
  };
  liveOr(function(){
    // no local push -- the live templates listener delivers this write
    // straight back (latency-compensated) and fully replaces state.templates
    return state.db.collection("templates").add(payload).then(function(){
      diag("Saved template '" + name + "'.");
    }).catch(function(err){ diag("Save template failed: " + (err && err.code ? err.code : String(err))); });
  }, function(){
    state.templates.push(Object.assign({ id:"local-tpl-"+Date.now() }, payload));
    renderTemplateList();
  });
}

function deleteTemplate(id){
  state.templates = state.templates.filter(function(t){ return t.id!==id; });
  renderTemplateList();
  syncLiveIfConnected(function(){
    return state.db.collection("templates").doc(id).delete();
  }, "Delete template " + id);
}

function loadTemplate(t){
  var newConfig = {
    unit: t.unit || state.config.unit,
    unitPlural: t.unitPlural || state.config.unitPlural,
    activeTemplateName: t.name,
    attribution: t.attribution || ""
  };
  // reuse each dimension's saved key (falling back to a template-namespaced
  // slug of its label for templates saved before keys were tracked) --
  // loading the SAME template again later re-creates the SAME dimension
  // ids, so any ratings given while it was active are still there
  var newDimSpecs = t.dimensions.map(function(d, i){
    var key = d.key || slugify(t.id + "-" + d.label, t.id + "-dim-" + (i+1));
    var spec = { key:key, label:d.label, green:d.green||"", red:d.red||"", order:d.order||(i+1) };
    if(isStatementDimension(d)) spec.statements = d.statements;
    if(d.scoreBands) spec.scoreBands = d.scoreBands;
    if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
    return spec;
  });

  if(state.live && state.db){
    showBusy('Switching to “' + t.name + '”…');
    diag("Loading template '" + t.name + "': removing " + state.dimensions.length + " current dimension(s)...");
    var oldKeys = state.dimensions.map(function(d){ return d.key; });
    var newKeys = {}; newDimSpecs.forEach(function(d){ newKeys[d.key] = true; });
    // only delete old dimensions that the incoming set doesn't reuse --
    // avoids a pointless delete+recreate round-trip when a key carries over
    var toDelete = oldKeys.filter(function(k){ return !newKeys[k]; });
    Promise.all(toDelete.map(function(k){ return state.db.collection("dimensions").doc(k).delete(); }))
      .then(function(){
        diag("Writing " + newDimSpecs.length + " dimension(s) for '" + t.name + "'...");
        return Promise.all(newDimSpecs.map(function(d){
          var payload = { label:d.label, green:d.green, red:d.red, order:d.order, updatedAt: nowIso() };
          // statements/scoreBands/strategies are optional content used by the
          // scored-survey rating flow (not built yet) -- carried through here
          // so a template that has them keeps them once that flow exists
          if(d.statements) payload.statements = d.statements;
          if(d.scoreBands) payload.scoreBands = d.scoreBands;
          if(d.strategies) payload.strategies = d.strategies;
          return state.db.collection("dimensions").doc(d.key).set(payload);
        }));
      })
      .then(function(){
        return state.db.doc("meta/config").set(Object.assign({}, newConfig, { updatedAt: nowIso() }));
      })
      .then(function(){
        diag("Template '" + t.name + "' loaded successfully.");
        hideBusy();
        closeDimManager();
        closeTemplates();
      })
      .catch(function(err){
        hideBusy();
        diag("Load template FAILED: " + (err && err.code ? err.code : String(err)) + (err && err.message ? " - " + err.message : ""));
      });
  } else {
    state.dimensions = newDimSpecs;
    state.config = Object.assign({}, state.config, newConfig);
    renderAll();
    renderDimList();
    closeTemplates();
  }
}
