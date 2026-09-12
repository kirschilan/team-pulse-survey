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
