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

// NOTE: the template object parameter is named `tpl`, not `t`, throughout
// this file -- `t` is the global translation function (i18n.js), and a
// local `var t = <template>` would shadow it for the rest of that scope,
// silently turning any `t("some.key")` call inside into "call this template
// object as a function" (a TypeError at runtime). Real risk introduced by
// Story 9's i18n wiring below, not a style preference.
function templateRowHtml(tpl, opts){
  var scoredCount = (tpl.dimensions||[]).filter(isStatementDimension).length;
  var meta = (tpl.dimensions.length===1 ? t("templates.meta.dimensionsOne") : t("templates.meta.dimensionsMany", {count: tpl.dimensions.length})) +
    (tpl.unit ? t("templates.meta.rates", {unit: tpl.unitPlural||tpl.unit}) : "") +
    (scoredCount ? t("templates.meta.scoredFromStatements", {count: scoredCount}) : "");
  return '<div class="tpl-row" data-id="'+esc(tpl.id)+'">' +
    '<div class="tinfo">' +
      '<div class="tname" dir="auto">'+esc(tpl.name)+'</div>' +
      '<div class="tmeta">'+meta+'</div>' +
    '</div>' +
    '<button class="btn" data-action="load" type="button">'+esc(t("templates.loadButton"))+'</button>' +
    (opts && opts.deletable === false ? "" :
      '<button class="icon-btn danger" data-action="delete" title="'+esc(t("templates.deleteTitle"))+'" type="button">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"/></svg></button>') +
  '</div>';
}

function renderTemplateList(){
  var starterHtml = STARTER_TEMPLATES.map(function(tpl){ return templateRowHtml(tpl, { deletable:false }); }).join("");
  var ownHtml = state.templates.map(function(tpl){ return templateRowHtml(tpl); }).join("");
  var html =
    '<div class="field-label" style="margin-top:0;">'+esc(t("templates.starterHeading"))+'</div>' +
    starterHtml +
    '<div class="field-label">'+esc(t("templates.ownHeading"))+'</div>' +
    (ownHtml || '<p class="hint" style="margin:0;">'+esc(t("templates.emptyOwnHint"))+'</p>');
  document.getElementById("tplList").innerHTML = html;
  document.querySelectorAll("#tplList .tpl-row").forEach(function(row){
    var id = row.getAttribute("data-id");
    var tpl = findAnyTemplateById(id);
    if(!tpl) return;
    row.querySelector('[data-action="load"]').addEventListener("click", function(){
      openConfirm(
        t("templates.confirmLoadTitle", {name: tpl.name}),
        t("templates.confirmLoadMessage", {oldCount: state.dimensions.length, name: tpl.name, newCount: tpl.dimensions.length}),
        function(){ loadTemplate(tpl); },
        t("templates.confirmLoadButton")
      );
    });
    var delBtn = row.querySelector('[data-action="delete"]');
    if(delBtn) delBtn.addEventListener("click", function(){
      openConfirm(
        t("templates.confirmDeleteTitle", {name: tpl.name}),
        t("templates.confirmDeleteMessage"),
        function(){ deleteTemplate(tpl.id); },
        t("templates.confirmDeleteButton")
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
  state.templates = state.templates.filter(function(tpl){ return tpl.id!==id; });
  renderTemplateList();
  syncLiveIfConnected(function(){
    return state.db.collection("templates").doc(id).delete();
  }, "Delete template " + id);
}

function loadTemplate(tpl){
  // Stored dimension/config content is ALWAYS the template's own English
  // (Story 5: for the Spotify starter template, PLACEHOLDER_DIMENSIONS'
  // canonical text either way -- localizing it for a non-English locale is
  // a RENDER-time concern (state.js's localizedDimText()/
  // localizedAttribution(), applied at every display site) rather than
  // something baked in here. Keeping the stored data locale-independent is
  // what makes switching languages update the board immediately, including
  // the default board that was never explicitly reloaded from the
  // Templates modal, and lets those helpers reliably tell "still the
  // template's own text" apart from "an admin customized this."
  var newConfig = {
    unit: tpl.unit || state.config.unit,
    unitPlural: tpl.unitPlural || state.config.unitPlural,
    activeTemplateName: tpl.name,
    attribution: tpl.attribution || ""
  };
  // reuse each dimension's saved key (falling back to a template-namespaced
  // slug of its label for templates saved before keys were tracked) --
  // loading the SAME template again later re-creates the SAME dimension
  // ids, so any ratings given while it was active are still there
  var newDimSpecs = tpl.dimensions.map(function(d, i){
    var key = d.key || slugify(tpl.id + "-" + d.label, tpl.id + "-dim-" + (i+1));
    var spec = { key:key, label:d.label, green:d.green||"", red:d.red||"", order:d.order||(i+1) };
    if(isStatementDimension(d)) spec.statements = d.statements;
    if(d.scoreBands) spec.scoreBands = d.scoreBands;
    if(d.strategies && d.strategies.length) spec.strategies = d.strategies;
    return spec;
  });

  if(state.live && state.db){
    showBusy(t("templates.switchingBusy", {name: tpl.name}));
    diag("Loading template '" + tpl.name + "': removing " + state.dimensions.length + " current dimension(s)...");
    var oldKeys = state.dimensions.map(function(d){ return d.key; });
    var newKeys = {}; newDimSpecs.forEach(function(d){ newKeys[d.key] = true; });
    // only delete old dimensions that the incoming set doesn't reuse --
    // avoids a pointless delete+recreate round-trip when a key carries over
    var toDelete = oldKeys.filter(function(k){ return !newKeys[k]; });
    // board-sync.js's suppressBoardPushDuring(): the dimension writes and
    // the config write below are separate Firestore-like operations, each
    // of which independently fires a db.js onSnapshot listener that would
    // otherwise push an inconsistent intermediate snapshot (new dimensions,
    // still-old config) to the relay -- see that function's own comment for
    // the real bug this caused (Tuckman's dimensions loaded correctly, but
    // the model name/attribution regressed back to the previous template).
    suppressBoardPushDuring(function(){
      return Promise.all(toDelete.map(function(k){ return state.db.collection("dimensions").doc(k).delete(); }))
        .then(function(){
          diag("Writing " + newDimSpecs.length + " dimension(s) for '" + tpl.name + "'...");
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
        });
    })
      .then(function(){
        diag("Template '" + tpl.name + "' loaded successfully.");
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
