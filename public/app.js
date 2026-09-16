"use strict";

// Entry point: wires up the view switcher, the one cross-cutting Escape-key
// handler (closes whichever modal happens to be open), and boots the app.
// Everything else lives in ./js/*.js, split by feature -- see STATUS.md for
// the module map and index.html for the load order. Plain global scripts,
// not ES modules: Chromium blocks cross-file `import` over file://, which
// both this app's Playwright suite and its "open index.html directly"
// support depend on, so every ./js/*.js file (and this one) is a classic
// script contributing to the shared global scope, exactly like local-store.js
// and vendor/qrcode.js already do.

// ---------- view switch (Tribe / Squad / Admin) ----------
// Purely a per-viewer UI convenience -- everyone shares the same underlying
// data regardless of which view they're looking at; this only decides which
// screen renders it, and for whom, right now. It is not access control.
function applyViewVisibility(){
  document.querySelectorAll(".view-btn").forEach(function(b){
    b.classList.toggle("active", b.getAttribute("data-view")===state.ui.view);
  });
  document.getElementById("viewTribe").hidden = state.ui.view!=="tribe";
  document.getElementById("viewSquad").hidden = state.ui.view!=="squad";
  document.getElementById("viewAdmin").hidden = state.ui.view!=="admin";
}
function setView(view){
  state.ui.view = view;
  try{ localStorage.setItem("squadpulse:view", view); }catch(e){ /* per-viewer convenience only */ }
  applyViewVisibility();
  // Every db snapshot listener gates its own re-render on
  // `state.ui.view==="..."` (see db.js) -- an update that arrives while a
  // view is hidden updates `state` correctly but never touches that view's
  // DOM, since nothing was watching. Switching back to it before now just
  // un-hid whatever was there from before, stale. A real report: a
  // facilitator clicked "Start retro session", switched to Admin to check
  // Diagnostics while the relay connected, and the button was still
  // showing "Starting..." on Squad view even though the session had
  // already started successfully -- switching views never re-rendered it.
  // Always rendering everything fresh on every switch is the fix: cheap
  // (in-memory state -> DOM, no network), and the same function already
  // used elsewhere for "state changed broadly, refresh everything".
  renderAll();
}
document.querySelectorAll(".view-btn").forEach(function(b){
  b.addEventListener("click", function(){ setView(b.getAttribute("data-view")); });
});

// Escape closes whichever modal/backdrop happens to be open right now --
// cross-cutting glue that touches every feature module's own modal, so it
// lives here at the entry point rather than inside any one of them.
document.addEventListener("keydown", function(e){
  if(e.key!=="Escape") return;
  if(!backdrop.hidden) closeModal();
  if(!dimBackdrop.hidden) closeDimManager();
  if(!templatesBackdrop.hidden) closeTemplates();
  if(!importJsonBackdrop.hidden) closeSquadImport();
  if(!confirmBackdrop.hidden) closeConfirm();
  if(!document.getElementById("joinCodeBackdrop").hidden) closeJoinCodeModal();
});

// ---------- boot ----------
function start(){
  if(isJoinMode()){
    enterJoinMode();
  } else {
    applyViewVisibility();
    renderAll();
  }
  initDb();
  showWelcomeOnFirstVisit();
}

if(window.claude && window.claude.hot){
  window.claude.hot.ready ? window.claude.hot.ready(start) : start();
} else {
  start();
}
