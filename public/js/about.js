"use strict";

// An on-demand introduction. Native modal focus/inert handling leaves the
// board and participant draft untouched; no persistence or navigation here.
var aboutDialog = document.getElementById("aboutDialog");
var aboutHelpBtn = document.getElementById("aboutHelpBtn");
aboutHelpBtn.addEventListener("click", function(){
  document.getElementById("aboutJoinBtn").textContent = t(state.joinSessionId ? "about.return" : "about.join");
  if(!aboutDialog.open) aboutDialog.showModal();
});
document.getElementById("aboutCloseBtn").addEventListener("click", function(){
  aboutDialog.close();
});
aboutDialog.addEventListener("close", function(){
  try{ localStorage.setItem("squadpulse:welcomeSeen", "1"); }catch(e){ /* dismissal must work without storage */ }
  // A guide action may already have focused the join-code input.
  if(document.getElementById("joinCodeBackdrop").hidden) aboutHelpBtn.focus();
});
// Do not let the app-wide Escape handler close an underlying editor too.
aboutDialog.addEventListener("keydown", function(event){
  if(event.key === "Escape") event.stopPropagation();
});

// Native dialog backdrop clicks target the dialog itself. Check bounds so
// clicks on padding/content do not accidentally dismiss it.
function outsideAbout(event){
  var rect = aboutDialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right ||
    event.clientY < rect.top || event.clientY > rect.bottom;
}
var aboutPointerStartedOutside = false;
aboutDialog.addEventListener("pointerdown", function(event){
  aboutPointerStartedOutside = event.target === aboutDialog && outsideAbout(event);
});
aboutDialog.addEventListener("click", function(event){
  if(aboutPointerStartedOutside && event.target === aboutDialog && outsideAbout(event)) aboutDialog.close();
  aboutPointerStartedOutside = false;
});
document.getElementById("aboutJoinBtn").addEventListener("click", function(){
  aboutDialog.close();
  if(state.joinSessionId) returnToJoinScreen();
  else document.getElementById("joinCodeBtn").click();
});

// A per-browser convenience, separate from any terms acknowledgment.
function showWelcomeOnFirstVisit(){
  if(openedFromInvitation) return;
  try{ if(localStorage.getItem("squadpulse:welcomeSeen") === "1") return; }catch(e){ /* show once for this page */ }
  aboutHelpBtn.click();
}
