"use strict";

// An on-demand introduction. Native modal focus/inert handling leaves the
// board and participant draft untouched; no persistence or navigation here.
var aboutDialog = document.getElementById("aboutDialog");
var aboutHelpBtn = document.getElementById("aboutHelpBtn");
aboutHelpBtn.addEventListener("click", function(){
  if(!aboutDialog.open) aboutDialog.showModal();
});
document.getElementById("aboutCloseBtn").addEventListener("click", function(){
  aboutDialog.close();
});
aboutDialog.addEventListener("close", function(){ aboutHelpBtn.focus(); });
// Do not let the app-wide Escape handler close an underlying editor too.
aboutDialog.addEventListener("keydown", function(event){
  if(event.key === "Escape") event.stopPropagation();
});
