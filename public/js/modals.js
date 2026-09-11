"use strict";


// ---------- busy overlay ----------
var busyOverlayEl = document.getElementById("busyOverlay");
var busyTextEl = document.getElementById("busyText");
function showBusy(text){ busyTextEl.textContent = text || "Working…"; busyOverlayEl.hidden = false; }
function hideBusy(){ busyOverlayEl.hidden = true; }

// ---------- generic confirm modal ----------
var confirmBackdrop = document.getElementById("confirmBackdrop");
function openConfirm(title, message, onConfirm, okLabel){
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMessage").textContent = message;
  document.getElementById("confirmOk").textContent = okLabel || "Confirm";
  state.confirmAction = onConfirm;
  confirmBackdrop.hidden = false;
}
function closeConfirm(){ confirmBackdrop.hidden = true; state.confirmAction = null; }
document.getElementById("confirmCancel").addEventListener("click", closeConfirm);
document.getElementById("confirmOk").addEventListener("click", function(){
  var action = state.confirmAction;
  closeConfirm();
  if(action) action();
});
confirmBackdrop.addEventListener("click", function(e){ if(e.target===confirmBackdrop) closeConfirm(); });

// ---------- cell rating modal ----------
var backdrop = document.getElementById("backdrop");
var modal = document.getElementById("modal");

function openEditor(squadId, dimKey){
  var sq = findSquad(squadId);
  var d = dimByKey(dimKey);
  diag("open cell squad=" + squadId + " dim=" + dimKey + " -> squad " + (sq ? "FOUND (" + sq.name + ")" : "NOT FOUND"));
  if(!sq || !d) return;
  var cell = (sq.dimensions && sq.dimensions[dimKey]) || {};
  state.editing = { squadId:squadId, dimKey:dimKey, color: cell.color||"unscored", trend: cell.trend||"flat", note: cell.note||"" };

  document.getElementById("modalTitle").textContent = d.label;
  document.getElementById("modalSquadline").textContent = sq.name;
  document.getElementById("modalGreen").textContent = d.green;
  document.getElementById("modalRed").textContent = d.red;
  var noteBox = document.getElementById("modalNote");
  noteBox.value = state.editing.note;
  noteBox.placeholder = "Why this rating? What's driving it?";
  document.getElementById("modalResetOverride").hidden = true;
  updateSwatchSelection();
  updateTrendSelection();
  backdrop.hidden = false;
  noteBox.focus({preventScroll:true});
}

function updateSwatchSelection(){
  document.querySelectorAll("#swatches .swatch").forEach(function(sw){
    sw.classList.toggle("selected", sw.getAttribute("data-color")===state.editing.color);
  });
}
function updateTrendSelection(){
  document.querySelectorAll("#trendsel button").forEach(function(b){
    b.classList.toggle("selected", b.getAttribute("data-trend")===state.editing.trend);
  });
}

document.querySelectorAll("#swatches .swatch").forEach(function(sw){
  sw.addEventListener("click", function(){
    state.editing.color = sw.getAttribute("data-color");
    updateSwatchSelection();
  });
});
document.querySelectorAll("#trendsel button").forEach(function(b){
  b.addEventListener("click", function(){
    state.editing.trend = b.getAttribute("data-trend");
    updateTrendSelection();
  });
});

function closeModal(){ backdrop.hidden = true; state.editing = null; }
document.getElementById("modalCancel").addEventListener("click", closeModal);
backdrop.addEventListener("click", function(e){ if(e.target===backdrop) closeModal(); });

document.getElementById("modalSave").addEventListener("click", function(){
  try{
    diag("Save clicked; state.editing=" + (state.editing ? JSON.stringify(state.editing) : "null"));
    if(!state.editing) { diag("Save aborted: no state.editing (dialog opened without a valid cell?)"); return; }
    var ed = state.editing;
    ed.note = document.getElementById("modalNote").value.trim();
    if(ed.mode === "session"){
      setSessionOverride(ed.sessionId, ed.dimKey, { color: ed.color, trend: ed.trend, note: ed.note });
      diag("Session override set: " + ed.sessionId + " / " + ed.dimKey + " = " + ed.color);
      renderSquadView();
      return;
    }
    var sq = findSquad(ed.squadId);
    if(sq){
      // shallow-clone in case the current dimensions map is a frozen
      // reference (e.g. straight from a live snapshot) -- never mutate it in place
      sq.dimensions = Object.assign({}, sq.dimensions);
      sq.dimensions[ed.dimKey] = { color: ed.color, trend: ed.trend, note: ed.note };
      diag("Local state updated: " + sq.name + " / " + ed.dimKey + " = " + ed.color + ". Re-rendering + persisting...");
      persistDimensionRating(sq, ed.dimKey);
      renderAll();
    } else {
      diag("Save FAILED: squad id '" + ed.squadId + "' not found in current state.squads (" + state.squads.map(function(s){return s.id;}).join(",") + ")");
    }
  } catch(err){
    diag("Save threw an exception: " + (err && err.message ? err.message : String(err)));
  } finally {
    closeModal();
  }
});

document.getElementById("modalResetOverride").addEventListener("click", function(){
  if(!state.editing || state.editing.mode!=="session") return;
  clearSessionOverride(state.editing.sessionId, state.editing.dimKey);
  closeModal();
  renderSquadView();
});
