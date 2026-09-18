"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog") -- one of six
// files split out of the former board-export-import.js. See
// board-export.js's own header comment for the full sibling list.
//
// ---------- the import modal's own preview rendering ----------
// Renders the plans board-import-plan.js's pure functions build into the
// modal body board-import-ui.js opens/closes, and re-binds this render's
// own mode/scope/Apply/backup controls on every call (this modal's DOM is
// fully rebuilt each time the mode or scope toggles change, not patched in
// place -- these bindings are the one place this file's own "preview,
// don't persist" boundary gets crossed, since Apply's own click handler is
// what actually calls into board-import-apply.js; genuinely inseparable
// from rendering itself without changing behavior, which REF-4 doesn't --
// see STATUS.md's session log).

// t() has no built-in pluralization -- same convention as templates.js's
// templates.meta.dimensionsOne/dimensionsMany key pairs, since Hebrew's
// plural grammar isn't just an English "+s" either way.
function countKey(base, count){ return base + (count===1 ? "One" : "Many"); }

function renderJsonImportError(parsed){
  var body;
  if(parsed.error === "unsupported-version"){
    body = t("importJson.errorUnsupportedVersion", { fileVersion:parsed.fileVersion, appVersion:SUPPORTED_BOARD_FORMAT_VERSION });
  } else {
    body = t("importJson.errorMalformed");
  }
  document.getElementById("importJsonBody").innerHTML =
    '<div class="error-state"><h4>'+esc(t("importJson.errorTitle"))+'</h4><p>'+esc(body)+'</p></div>' +
    '<div class="modal-actions"><button class="btn ghost" id="importJsonCloseErr" type="button">'+esc(t("importJson.close"))+'</button></div>';
  document.getElementById("importJsonCloseErr").addEventListener("click", closeSquadImport);
}

// {field: i18n key} for buildConfigImportPlan()'s diff rows -- CONFIG_IMPORT_FIELDS
// is the source list; this just names each one for display.
var CONFIG_FIELD_I18N_KEY = {
  unit: "importJson.configFieldUnit", unitPlural: "importJson.configFieldUnitPlural",
  activeTemplateName: "importJson.configFieldActiveTemplateName", attribution: "importJson.configFieldAttribution"
};

// Shared chip-row renderer for the {patches, added, toRemove} plan shape --
// used for both dimensions and templates, same "no changes" fallback shown
// in the reviewed mockup.
function entityChipsHtml(plan, newKeyBase, updatedKeyBase, removedKeyBase){
  var updatedCount = plan.patches.filter(function(p){ return p.existing; }).length;
  var chips = [];
  if(plan.added.length) chips.push('<span class="chip ok">'+esc(t(countKey(newKeyBase, plan.added.length), { count:plan.added.length }))+'</span>');
  if(updatedCount) chips.push('<span class="chip">'+esc(t(countKey(updatedKeyBase, updatedCount), { count:updatedCount }))+'</span>');
  if(plan.mode==="replace" && plan.toRemove.length) chips.push('<span class="chip crit">'+esc(t(countKey(removedKeyBase, plan.toRemove.length), { count:plan.toRemove.length }))+'</span>');
  if(!chips.length) chips.push('<span class="chip none">'+esc(t("importJson.chipNoChanges"))+'</span>');
  return chips.join("");
}

function renderJsonImportPreview(fileData){
  var mode = pendingSquadImportMode;
  var scope = pendingImportScope;
  var dimPlan = buildDimensionImportPlan(fileData.dimensions, mode);
  var tplPlan = buildTemplateImportPlan(fileData.templates, mode);
  var configChanges = buildConfigImportPlan(fileData.config);
  // dimPlan.added is only a real promise once the Templates scope is
  // actually going to be applied -- otherwise no dimension will be
  // created this round, and a rating for one must still report "not
  // found" rather than claim a count it can't deliver (see
  // buildSquadImportPlan()'s own comment on extraDimensionLabels).
  var squadPlan = buildSquadImportPlan(fileData, mode, scope.templates ? dimPlan.added : undefined);
  pendingSquadImportPlan = squadPlan;
  pendingDimensionImportPlan = dimPlan;
  pendingTemplateImportPlan = tplPlan;
  pendingConfigImportChanges = configChanges;

  var squadsHtml = "";
  if(scope.squads){
    var updatedExisting = squadPlan.patches.filter(function(p){ return p.existing; }).length;
    var chips = '<div class="import-stats">' +
      '<span class="chip ok">'+esc(t(countKey("importJson.chipRatings", squadPlan.ratingCount), { count:squadPlan.ratingCount }))+'</span>' +
      '<span class="chip">'+esc(t(countKey("importJson.chipUpdated", updatedExisting), { count:updatedExisting, unit:unitLower(), unitPlural:unitPluralLower() }))+'</span>' +
      (squadPlan.newSquadNames.length ? '<span class="chip">'+esc(t(countKey("importJson.chipNew", squadPlan.newSquadNames.length), { count:squadPlan.newSquadNames.length, unit:unitLower(), unitPlural:unitPluralLower(), names:squadPlan.newSquadNames.join(", ") }))+'</span>' : '') +
      (squadPlan.mode==="replace" && squadPlan.squadsToRemove.length ? '<span class="chip crit">'+esc(t(countKey("importJson.chipRemoved", squadPlan.squadsToRemove.length), { count:squadPlan.squadsToRemove.length, unit:unitLower(), unitPlural:unitPluralLower(), names:squadPlan.squadsToRemove.map(function(s){return s.name;}).join(", ") }))+'</span>' : '') +
      // RETRO-1: makes an included retro result visible in the preview,
      // not just a silent side effect of applying -- the facilitator sees
      // that this file also carries a finished retro's context before
      // clicking Apply.
      (squadPlan.lastRetroSquadCount ? '<span class="chip">'+esc(t(countKey("importJson.chipLastRetro", squadPlan.lastRetroSquadCount), { count:squadPlan.lastRetroSquadCount }))+'</span>' : '') +
    '</div>';
    var skipsHtml = "";
    if(squadPlan.skipped.length){
      skipsHtml = '<div class="import-skips">' + squadPlan.skipped.slice(0,50).map(function(s){
        return '<div class="srow">'+esc(t("importJson.skippedRow", { squad:s.squad, dimension:s.dimension }))+'</div>';
      }).join("") + '</div>';
    }
    squadsHtml = '<div class="section-heading"><div class="field-label">'+esc(t("importJson.scopeSquads"))+'</div></div>' + chips + skipsHtml;
  }

  var restHtml = "";
  if(scope.templates){
    var configHtml = "";
    if(configChanges.length){
      configHtml = '<div class="section-heading"><div class="field-label">'+esc(t("importJson.configHeading"))+'</div></div>' +
        '<div class="config-diff">' + configChanges.map(function(c){
          return '<div class="crow"><span class="cfield">'+esc(t(CONFIG_FIELD_I18N_KEY[c.field] || c.field))+'</span>' +
            '<span class="cfrom">'+esc(c.from)+'</span><span class="carrow">&rarr;</span><span class="cto">'+esc(c.to)+'</span></div>';
        }).join("") + '</div>';
    }
    restHtml =
      '<div class="section-heading"><div class="field-label">'+esc(t("importJson.dimensionsHeading"))+'</div></div>' +
      '<div class="import-stats">'+entityChipsHtml(dimPlan, "importJson.chipDimNew", "importJson.chipDimUpdated", "importJson.chipDimRemoved")+'</div>' +
      '<div class="section-heading"><div class="field-label">'+esc(t("importJson.templatesHeading"))+'</div></div>' +
      '<div class="import-stats">'+entityChipsHtml(tplPlan, "importJson.chipTplNew", "importJson.chipTplUpdated", "importJson.chipTplRemoved")+'</div>' +
      configHtml;
  }

  var dangerGroups = [];
  if(scope.squads && squadPlan.mode === "replace" && (squadPlan.squadsToRemove.length || squadPlan.clearedRatings.length)){
    var squadItems = squadPlan.squadsToRemove.map(function(s){ return '<li>'+esc(t("importJson.willRemoveSquad", { name:s.name }))+'</li>'; })
      .concat(squadPlan.clearedRatings.map(function(c){ return '<li>'+esc(t("importJson.willClearRating", { squad:c.squad, dimension:c.dimension }))+'</li>'; }));
    dangerGroups.push('<ul>'+squadItems.join("")+'</ul>');
  }
  if(scope.templates && mode === "replace" && dimPlan.toRemove.length){
    dangerGroups.push('<span class="wgroup">'+esc(t("importJson.removedDimensionsGroupTitle"))+'</span><ul>' +
      dimPlan.toRemove.map(function(d){ return '<li>'+esc(t("importJson.willRemoveDimension", { name:d.label }))+'</li>'; }).join("") + '</ul>');
  }
  if(scope.templates && mode === "replace" && tplPlan.toRemove.length){
    dangerGroups.push('<span class="wgroup">'+esc(t("importJson.removedTemplatesGroupTitle"))+'</span><ul>' +
      tplPlan.toRemove.map(function(tpl){ return '<li>'+esc(t("importJson.willRemoveTemplate", { name:tpl.name }))+'</li>'; }).join("") + '</ul>');
  }

  var replaceWarning = "";
  if(dangerGroups.length){
    replaceWarning = '<div class="import-warning danger"><b>'+esc(t("importJson.replaceWarningTitle"))+'</b>' + dangerGroups.join("") +
      '<div class="backup-offer"><button class="btn" id="importJsonBackupBtn" type="button">'+esc(t("importJson.downloadBackup"))+'</button>' +
      '<span class="backup-done" id="importJsonBackupDone" hidden>'+esc(t("importJson.backupDone"))+'</span>' +
      '<span class="backup-failed" id="importJsonBackupFailed" hidden>'+esc(t("importJson.backupFailed"))+'</span></div></div>';
  }

  var scopeChosen = scope.squads || scope.templates;
  var hasChanges = (scope.squads && planHasChanges(squadPlan)) ||
    (scope.templates && (entityImportPlanHasChanges(dimPlan) || entityImportPlanHasChanges(tplPlan) || configChanges.length>0));

  document.getElementById("importJsonBody").innerHTML =
    '<h3>'+esc(t("importJson.title"))+'</h3>' +
    '<p class="hint">'+esc(t("importJson.hint"))+'</p>' +
    '<div class="field-label">'+esc(t("importJson.scopeLabel"))+'</div>' +
    '<div class="scope-row">' +
      '<label class="scope-check"><input type="checkbox" id="importJsonScopeSquads" '+(scope.squads?"checked":"")+'> '+esc(t("importJson.scopeSquads"))+'</label>' +
      '<label class="scope-check"><input type="checkbox" id="importJsonScopeTemplates" '+(scope.templates?"checked":"")+'> '+esc(t("importJson.scopeRest"))+'</label>' +
    '</div>' +
    '<div class="field-label">'+esc(t("importJson.modeLabel"))+'</div>' +
    '<div class="mode-switch">' +
      '<button class="mode-btn'+(mode==="merge"?" active":"")+'" data-mode="merge" type="button">'+esc(t("importJson.modeMerge"))+'</button>' +
      '<button class="mode-btn'+(mode==="replace"?" active":"")+'" data-mode="replace" type="button">'+esc(t("importJson.modeReplace"))+'</button>' +
    '</div>' +
    '<p class="external-tip">'+esc(t("importJson.externalTip"))+' <a href="https://meldmerge.org" target="_blank" rel="noopener">Meld</a>.</p>' +
    squadsHtml + restHtml + replaceWarning +
    (scopeChosen ? '' : '<p class="hint" style="margin-top:14px;">'+esc(t("importJson.noScopeHint"))+'</p>') +
    '<div class="modal-actions">' +
      '<button class="btn ghost" id="importJsonCancel" type="button">'+esc(t("importJson.cancel"))+'</button>' +
      '<button class="btn primary" id="importJsonApplyBtn" type="button" '+((scopeChosen && hasChanges) ? "" : "disabled")+'>'+esc(t("importJson.apply"))+'</button>' +
    '</div>';

  document.querySelectorAll("#importJsonBody .mode-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      pendingSquadImportMode = btn.getAttribute("data-mode");
      renderJsonImportPreview(fileData);
    });
  });
  document.getElementById("importJsonScopeSquads").addEventListener("change", function(){
    pendingImportScope = Object.assign({}, pendingImportScope, { squads: this.checked });
    renderJsonImportPreview(fileData);
  });
  document.getElementById("importJsonScopeTemplates").addEventListener("change", function(){
    pendingImportScope = Object.assign({}, pendingImportScope, { templates: this.checked });
    renderJsonImportPreview(fileData);
  });
  document.getElementById("importJsonCancel").addEventListener("click", closeSquadImport);
  document.getElementById("importJsonApplyBtn").addEventListener("click", function(){
    // Captured locally, not read back off the pending* module vars inside
    // applySquadsNow() -- closeSquadImport() (board-import-ui.js) nulls
    // those out immediately, but when the Templates scope is checked,
    // applySquadsNow() itself doesn't run until AFTER
    // applyDimensionTemplateConfigImportPlan()'s own async new-dimension
    // creation resolves, by which point the module vars would already be
    // gone.
    var scope = pendingImportScope, squadPlan = pendingSquadImportPlan;
    function applySquadsNow(){
      if(!scope.squads || !squadPlan) return Promise.resolve();
      // PR #12 review finding: a rating for a dimension this SAME import
      // is about to create was tracked as a pendingDimensionKey() marker
      // (see buildSquadImportPlan(), board-import-plan.js) rather than a
      // real key, precisely because that key doesn't exist until the
      // dimension import above has actually run -- resolve it now, using
      // the board's dimensions as they stand after that.
      squadPlan.patches.forEach(function(p){
        p.fileDims = resolvePendingDimensionKeys(p.fileDims);
        // RETRO-1: a lastRetro snapshot's own dimensions map goes through
        // the exact same pending-key resolution as a squad's ratings above.
        if(p.fileLastRetro) p.fileLastRetro.dimensions = resolvePendingDimensionKeys(p.fileLastRetro.dimensions || {});
      });
      return applySquadImportPlan(squadPlan);
    }
    // REF-1 (STATUS.md's "Code quality & refactoring backlog"): both apply
    // functions below (board-import-apply.js) now return a promise that
    // resolves only once every write they issued has actually settled --
    // previously this handler fired closeSquadImport() (and, inside those
    // functions, the "JSON import applied" diagnostic) synchronously,
    // right after ISSUING the writes, never after they landed.
    // showBusy()/hideBusy() now covers the WHOLE apply operation, not just
    // the new-entity-creation sub-step that already used it -- so the
    // modal visibly stays open (busy) for exactly as long as the real work
    // is still in flight, success or failure.
    showBusy();
    var whole = scope.templates
      ? applyDimensionTemplateConfigImportPlan(pendingDimensionImportPlan, pendingTemplateImportPlan, pendingConfigImportChanges, pendingSquadImportMode, applySquadsNow)
      : applySquadsNow();
    whole.then(hideBusy, hideBusy).then(closeSquadImport);
  });
  var backupBtn = document.getElementById("importJsonBackupBtn");
  if(backupBtn){
    backupBtn.addEventListener("click", async function(){
      // Review finding (PR #7): the previous version showed "Backup
      // downloaded" unconditionally -- a rejected downloads.save() (caught
      // and swallowed) or a blocked fallback popup (window.open() returning
      // null) both still reached the success line. Since this backup is the
      // offered protection right before a destructive Replace, a false
      // "downloaded" is worse than no message at all: only show success once
      // a save/popup genuinely happened.
      var json = toJSON();
      var succeeded = false;
      try{
        var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
        if(downloads){
          await downloads.save({ filename:"squad-pulse-board-backup.json", data: json });
          succeeded = true;
        } else {
          var w = window.open("", "_blank");
          if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(json)+"</pre>"); succeeded = true; }
        }
      }catch(e){ succeeded = false; }
      document.getElementById("importJsonBackupDone").hidden = !succeeded;
      document.getElementById("importJsonBackupFailed").hidden = succeeded;
    });
  }
}
