"use strict";


// ---------- templates ----------
// Split out from a combined dimensions-templates.js on 2026-09-12 -- see
// dimensions.js for the dimension-manager half. loadTemplate() below still
// calls closeDimManager()/renderDimList() (dimensions.js), since loading a
// template can change the dimension set out from under an open Dim
// Manager -- the one real cross-reference between the two files, same as
// any other cross-file call in this app's shared-global-scope design (see
// STATUS.md).
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
  // Story 5: a starter template's OWN dimension content (label/green/red,
  // attribution) is board DATA, not UI chrome -- it isn't looked up via
  // t(), so it's translated once here, at load time, from the template's
  // own t.i18n table (see state.js's SPOTIFY_TEMPLATE) rather than through
  // the Admin/Tribe/Squad i18n machinery. A later language switch does NOT
  // retroactively re-translate already-loaded dimensions -- same as any
  // other board content, this is a one-time snapshot into mutable state.
  var locale = (state.ui && state.ui.locale) || "en";
  var i18n = t.starter && t.i18n && t.i18n[locale];
  var dims = (i18n && i18n.dimensions) ? localizedStarterDimensions(t.dimensions, i18n.dimensions) : t.dimensions;
  var attribution = (i18n && i18n.attribution) || t.attribution || "";
  var newConfig = {
    unit: t.unit || state.config.unit,
    unitPlural: t.unitPlural || state.config.unitPlural,
    activeTemplateName: t.name,
    attribution: attribution
  };
  // reuse each dimension's saved key (falling back to a template-namespaced
  // slug of its label for templates saved before keys were tracked) --
  // loading the SAME template again later re-creates the SAME dimension
  // ids, so any ratings given while it was active are still there
  var newDimSpecs = dims.map(function(d, i){
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
