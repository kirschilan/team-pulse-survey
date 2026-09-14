"use strict";


// ---------- dimension manager ----------
// Split out from a combined dimensions-templates.js on 2026-09-12 -- see
// templates.js for the template save/load/delete half. loadTemplate() (in
// templates.js) still calls closeDimManager()/renderDimList() here, since
// loading a template can change the dimension set out from under an open
// Dim Manager -- that's the one real cross-reference between the two
// files, same as any other cross-file call in this app's shared-global-
// scope design (see STATUS.md).
var dimBackdrop = document.getElementById("dimBackdrop");

function openDimManager(){
  renderDimList();
  dimBackdrop.hidden = false;
}
function closeDimManager(){ dimBackdrop.hidden = true; }
document.getElementById("dimManageBtn").addEventListener("click", openDimManager);
document.getElementById("dimDoneBtn").addEventListener("click", closeDimManager);
dimBackdrop.addEventListener("click", function(e){ if(e.target===dimBackdrop) closeDimManager(); });

// Bilingual dimensions (product owner-approved redesign -- see STATUS.md's
// session log and the mockup it was approved from): a dimension's Hebrew
// translation is a real, editable field (dim.i18n.he.*) right alongside
// its English one, not a hardcoded template-level lookup table only the
// built-in starter templates could ever have (state.js's localizedDimText()
// is the underlying mechanism). renderDimList() fully rebuilds #dimList's
// innerHTML on every edit (same as it always has), which would otherwise
// collapse an open translation panel the instant an admin finishes typing
// into it -- this tracks each dimension's panel open/closed state across
// those re-renders, independent of whether it happens to have a
// translation yet (openI18nPanels[key] is only ever set once a human
// actually clicks the toggle this session).
var openI18nPanels = {};

// Effective Hebrew value for the editor's own pre-fill -- the dimension's
// OWN stored i18n.he (an admin's real edit) if present, else state.js's
// builtinDimTranslation() fallback for a dimension that matches a built-in
// starter template's default but has no i18n of its own yet (a legacy
// board that loaded that template before the per-dimension i18n redesign
// shipped -- see state.js's own comment on builtinDimTranslation()). This
// is deliberately locale-INDEPENDENT (unlike state.js's localizedDimText()):
// this panel always shows/edits the Hebrew side regardless of which
// language the admin is currently viewing the rest of the app in. Purely a
// DISPLAY/pre-fill concern -- nothing is written to the dimension's own
// `i18n` until an admin actually edits an input (bindDimListEvents() below).
function effectiveHeValue(d, field, index){
  var he = (d.i18n && d.i18n.he) || {};
  var own = index === undefined ? he[field] : (he[field] && he[field][index]);
  if(own !== undefined && own !== null && String(own).trim() !== "") return own;
  var fallback = builtinDimTranslation(d, field, index, "he");
  return (fallback !== undefined && fallback !== null && String(fallback).trim() !== "") ? fallback : "";
}

function dimHasI18n(d){
  if(String(effectiveHeValue(d, "label")).trim() || String(effectiveHeValue(d, "green")).trim() || String(effectiveHeValue(d, "red")).trim()) return true;
  return ["statements", "strategies"].some(function(field){
    return (d[field] || []).some(function(_, i){ return String(effectiveHeValue(d, field, i)).trim() !== ""; });
  });
}

// One row of aligned EN/HE text inputs for an array field (statements or
// strategies) -- HE inputs are always exactly as many as the EN array has
// (a translation, not independent content), pre-filled from
// effectiveHeValue() (dim's own i18n, or a matching built-in default) when
// present. `lang` drives which update function a change event calls; EN
// inputs live in the main (always-visible) part of the row, HE inputs live
// inside the translation panel.
function arrayFieldEditorHtml(d, field, lang, headingKey){
  var items = d[field] || [];
  if(!items.length) return "";
  var rows = items.map(function(_, i){
    var value = lang==="en" ? items[i] : effectiveHeValue(d, field, i);
    return '<input type="text" class="dim-array-item" data-field="'+field+'" data-lang="'+lang+'" data-index="'+i+'" value="'+esc(value)+'" dir="auto">';
  }).join("");
  return '<div class="field-label" style="margin-top:10px;">'+esc(t(headingKey))+'</div>' +
    '<div class="dim-array-list">'+rows+'</div>';
}

function i18nPanelHtml(d){
  var hasI18n = dimHasI18n(d);
  var sourceHint = hasI18n
    ? t("dimManager.i18n.sourceDefault", {template: state.config.activeTemplateName || ""})
    : t("dimManager.i18n.sourceNone");
  var isOpen = openI18nPanels.hasOwnProperty(d.key) ? openI18nPanels[d.key] : hasI18n;
  return '<button class="i18n-toggle" type="button" aria-expanded="'+(isOpen?"true":"false")+'" data-key="'+esc(d.key)+'">' +
      (hasI18n ? esc(t("dimManager.i18n.editedToggle")) : esc(t("dimManager.i18n.addToggle"))) +
      '<svg class="chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>' +
    '</button>' +
    '<div class="i18n-panel" data-key="'+esc(d.key)+'"'+(isOpen?"":" hidden")+'>' +
      '<p class="i18n-source">'+esc(sourceHint)+'</p>' +
      '<input class="dim-label" data-field="label" data-lang="he" value="'+esc(effectiveHeValue(d, "label"))+'" placeholder="שם הממד בעברית" dir="rtl">' +
      '<div class="fields">' +
        '<div><label class="grn">ירוק נראה כך</label><textarea data-field="green" data-lang="he" placeholder="איך נראית בריאות" dir="rtl">'+esc(effectiveHeValue(d, "green"))+'</textarea></div>' +
        '<div><label class="rd">אדום נראה כך</label><textarea data-field="red" data-lang="he" placeholder="איך נראה חוסר בריאות" dir="rtl">'+esc(effectiveHeValue(d, "red"))+'</textarea></div>' +
      '</div>' +
      arrayFieldEditorHtml(d, "statements", "he", "dimManager.statementsHeading") +
      arrayFieldEditorHtml(d, "strategies", "he", "dimManager.strategiesHeading") +
    '</div>';
}

function renderDimList(){
  var dims = sortedDimensions();
  var html = dims.map(function(d, i){
    return '<div class="dim-row" data-key="'+esc(d.key)+'">' +
      '<div class="dim-row-top">' +
        '<button class="icon-btn dim-up" title="'+esc(t("dimManager.moveUpTitle"))+'" type="button" '+(i===0?"disabled":"")+'>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 15l7-7 7 7"/></svg></button>' +
        '<button class="icon-btn dim-down" title="'+esc(t("dimManager.moveDownTitle"))+'" type="button" '+(i===dims.length-1?"disabled":"")+'>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 9l7 7 7-7"/></svg></button>' +
        '<input class="dim-label" data-field="label" data-lang="en" value="'+esc(d.label)+'" aria-label="'+esc(t("dimManager.nameAriaLabel"))+'" placeholder="'+esc(t("dimManager.namePlaceholder"))+'" dir="auto">' +
        '<button class="icon-btn danger dim-del" title="'+esc(t("dimManager.removeTitle"))+'" type="button">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="fields">' +
        '<div><label class="grn">'+esc(t("dimManager.greenLabel"))+'</label><textarea data-field="green" data-lang="en" placeholder="'+esc(t("dimManager.greenPlaceholder"))+'" dir="auto">'+esc(d.green)+'</textarea></div>' +
        '<div><label class="rd">'+esc(t("dimManager.redLabel"))+'</label><textarea data-field="red" data-lang="en" placeholder="'+esc(t("dimManager.redPlaceholder"))+'" dir="auto">'+esc(d.red)+'</textarea></div>' +
      '</div>' +
      arrayFieldEditorHtml(d, "statements", "en", "dimManager.statementsHeading") +
      arrayFieldEditorHtml(d, "strategies", "en", "dimManager.strategiesHeading") +
      i18nPanelHtml(d) +
    '</div>';
  }).join("");
  document.getElementById("dimList").innerHTML = html || '<p class="hint" style="margin:0;">'+esc(t("dimManager.emptyHint"))+'</p>';
  bindDimListEvents();
}

function bindDimListEvents(){
  document.querySelectorAll("#dimList .dim-row").forEach(function(row){
    var key = row.getAttribute("data-key");

    row.querySelectorAll('[data-field="label"], [data-field="green"], [data-field="red"]').forEach(function(field){
      field.addEventListener("change", function(){
        var lang = field.getAttribute("data-lang");
        var fieldName = field.getAttribute("data-field");
        if(lang === "he") updateDimensionI18nField(key, fieldName, field.value);
        else updateDimensionField(key, fieldName, field.value);
      });
    });
    row.querySelectorAll(".dim-array-item").forEach(function(field){
      field.addEventListener("change", function(){
        var lang = field.getAttribute("data-lang");
        var fieldName = field.getAttribute("data-field");
        var index = Number(field.getAttribute("data-index"));
        if(lang === "he") updateDimensionI18nArrayItem(key, fieldName, index, field.value);
        else updateDimensionArrayItem(key, fieldName, index, field.value);
      });
    });

    var i18nToggle = row.querySelector(".i18n-toggle");
    if(i18nToggle) i18nToggle.addEventListener("click", function(){
      var panel = row.querySelector(".i18n-panel");
      var nowOpen = i18nToggle.getAttribute("aria-expanded") !== "true";
      i18nToggle.setAttribute("aria-expanded", String(nowOpen));
      panel.hidden = !nowOpen;
      openI18nPanels[key] = nowOpen;
    });

    var upBtn = row.querySelector(".dim-up");
    var downBtn = row.querySelector(".dim-down");
    if(upBtn) upBtn.addEventListener("click", function(){ moveDimension(key, -1); });
    if(downBtn) downBtn.addEventListener("click", function(){ moveDimension(key, 1); });
    var delBtn = row.querySelector(".dim-del");
    if(delBtn) delBtn.addEventListener("click", function(){
      var d = dimByKey(key);
      openConfirm(
        t("dimManager.confirmRemoveTitle"),
        t("dimManager.confirmRemoveMessage", {name: d ? d.label : t("dimManager.untitledFallback")}),
        function(){ removeDimension(key); },
        t("dimManager.confirmRemoveButton")
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

// The four functions below all persist the WHOLE `i18n` object (rather
// than a dotted-path patch) -- Firestore-shaped `update()` in this app
// replaces whatever key it's given wholesale (see local-store.js/
// relay-client.js), so patching just `i18n.he.label` would silently drop
// every other language/field already stored there.
function updateDimensionI18nField(key, field, value){
  var d = dimByKey(key);
  if(!d) return;
  d.i18n = d.i18n || {};
  d.i18n.he = d.i18n.he || {};
  d.i18n.he[field] = value;
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    return state.db.collection("dimensions").doc(key).update({ i18n: d.i18n, updatedAt: nowIso() });
  }, "Dimension i18n field update for " + key);
}

function updateDimensionArrayItem(key, field, index, value){
  var d = dimByKey(key);
  if(!d || !Array.isArray(d[field])) return;
  d[field] = d[field].slice();
  d[field][index] = value;
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    var patch = {}; patch[field] = d[field]; patch.updatedAt = nowIso();
    return state.db.collection("dimensions").doc(key).update(patch);
  }, "Dimension array field update for " + key);
}

function updateDimensionI18nArrayItem(key, field, index, value){
  var d = dimByKey(key);
  if(!d) return;
  d.i18n = d.i18n || {};
  d.i18n.he = d.i18n.he || {};
  // pad to the ENGLISH array's length so editing item #1 before #0 doesn't
  // leave #0 as `undefined` (which would render blank instead of falling
  // back to English -- see state.js's localizedDimText() per-element check)
  var arr = (d.i18n.he[field] || []).slice();
  var enLen = (d[field] || []).length;
  while(arr.length < enLen) arr.push("");
  arr[index] = value;
  d.i18n.he[field] = arr;
  renderAll();
  renderDimList();
  syncLiveIfConnected(function(){
    return state.db.collection("dimensions").doc(key).update({ i18n: d.i18n, updatedAt: nowIso() });
  }, "Dimension i18n array field update for " + key);
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
