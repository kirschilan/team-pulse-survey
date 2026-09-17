"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog") -- one of six
// files split out of the former board-export-import.js. See
// board-export.js's own header comment for the full sibling list.
//
// ---------- the import modal's open/close lifecycle ----------
// Owns the "Import JSON" button, the file picker, the backdrop, and the
// pending* module state board-import-preview.js's renderJsonImportPreview()
// reads and writes on every render (a bare global cross-file reference,
// same convention as every other function in this split -- see
// board-export.js's own header comment) -- this file is what opens the
// modal (parses the file, dispatches to the preview or the error state) and
// closes it (clearing that pending state so a stale plan can never survive
// into the next import).

var jsonFileInput = document.getElementById("jsonFileInput");
var importJsonBackdrop = document.getElementById("importJsonBackdrop");
var pendingSquadImportPlan = null;
var pendingDimensionImportPlan = null;
var pendingTemplateImportPlan = null;
var pendingConfigImportChanges = null;
var pendingSquadImportMode = "merge";
var pendingImportScope = { squads:true, templates:true };

document.getElementById("importJsonBtn").addEventListener("click", function(){ jsonFileInput.click(); });

jsonFileInput.addEventListener("change", function(){
  var file = jsonFileInput.files && jsonFileInput.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    var parsed = parseBoardImportFile(String(reader.result || ""));
    if(!parsed.ok){
      renderJsonImportError(parsed);
    } else {
      pendingSquadImportMode = "merge";
      pendingImportScope = { squads:true, templates:true };
      renderJsonImportPreview(parsed.data);
    }
    importJsonBackdrop.hidden = false;
    jsonFileInput.value = "";
  };
  reader.onerror = function(){ diag("JSON import: could not read the selected file."); jsonFileInput.value = ""; };
  reader.readAsText(file);
});

function closeSquadImport(){
  importJsonBackdrop.hidden = true;
  pendingSquadImportPlan = null;
  pendingDimensionImportPlan = null;
  pendingTemplateImportPlan = null;
  pendingConfigImportChanges = null;
}
importJsonBackdrop.addEventListener("click", function(e){ if(e.target===importJsonBackdrop) closeSquadImport(); });
