"use strict";

// REF-4 (STATUS.md's "Code quality & refactoring backlog"): one of six files
// split out of the former board-export-import.js (Story 13, item 4 first
// renamed it from csv.js once JSON became the only board export/import
// format; by REF-4 it had grown to 1093 lines mixing six responsibilities
// with no internal boundary -- see STATUS.md's session log for the full
// split). This file is JSON board EXPORT only. Its siblings:
// board-import-validate.js (parse + shape validation), board-import-plan.js
// (pure merge/replace planning), board-import-preview.js (the import
// modal's own preview rendering), board-import-apply.js (persistence
// execution), board-import-ui.js (the import modal's open/close lifecycle).
// Every function below stays a bare global, exactly as it was in the one
// file it came from -- these are plain classic `<script>` files sharing one
// `window` scope (see STATUS.md's `file://` constraint), not ES modules, so
// nothing about how any of these six actually run together has changed.

// ---------- JSON board export (beta) ----------
// A full board backup/restore format: carries config, every dimension's/
// template's full definition (including scored-template statements/
// scoreBands/strategies, and each one's Hebrew i18n override verbatim --
// state.js's dim.i18n.he.{...}/tpl.i18n.he.{...} passed through as-is, not
// flattened into a symmetric {en,he} shape the way
// scripts/export-template-translations.js does for its own, different,
// human-review purpose), and every squad's ratings.
// formatVersion:1 is the first version of this format -- no migration
// path needed yet, since nothing existing depends on an older shape.
// Deliberately excludes `sessions` (ephemeral, never meant to be portable)
// and any team-sync secret (a durable credential has no business in a
// downloadable file) -- this function never reads state.db/state.live or
// anything team-sync-related, so there's nothing to accidentally leak.
// Squads are matched on import by NAME -- squad.id is a storage-generated
// value (see state.js/squads.js), never a portable identity, so it's
// deliberately left out of this export rather than implying a portability
// it doesn't have.
function buildBoardExport(){
  return {
    formatVersion: 1,
    exportedAt: nowIso(),
    config: Object.assign({}, state.config),
    dimensions: sortedDimensions().map(function(d){
      var out = { key:d.key, label:d.label, green:d.green||"", red:d.red||"", order:d.order };
      if(d.statements) out.statements = d.statements;
      if(d.scoreBands) out.scoreBands = d.scoreBands;
      if(d.strategies && d.strategies.length) out.strategies = d.strategies;
      if(d.i18n) out.i18n = d.i18n;
      return out;
    }),
    templates: (state.templates||[]).map(function(tpl){
      var out = { id:tpl.id, name:tpl.name, unit:tpl.unit, unitPlural:tpl.unitPlural, attribution:tpl.attribution||"", dimensions:tpl.dimensions };
      if(tpl.i18n) out.i18n = tpl.i18n;
      return out;
    }),
    squads: sortedSquads().map(function(sq){
      var out = { name:sq.name, order:sq.order, dimensions: sq.dimensions||{} };
      // RETRO-1 (STATUS.md's "Facilitated retro backlog"): a squad's most
      // recently FINISHED retro (see finishRetroAndApply(), retro-facilitator.js)
      // carries context the resulting ratings alone don't -- which dimensions
      // were manually overridden, the sprint-experiment note, and when it
      // finished. Omitted entirely (not a present-but-empty object) for a
      // squad that has never finished one, same "absent means no opinion"
      // convention formatVersion:1 already uses for dimensions/templates.
      if(sq.lastRetro) out.lastRetro = sq.lastRetro;
      return out;
    })
  };
}

function toJSON(){
  return JSON.stringify(buildBoardExport(), null, 2);
}

document.getElementById("exportJsonBtn").addEventListener("click", async function(){
  var json = toJSON();
  try{
    var downloads = await (window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve(null));
    if(downloads){
      await downloads.save({ filename:"squad-pulse-board.json", data: json });
      return;
    }
  }catch(e){ /* fall through */ }
  var w = window.open("", "_blank");
  if(w){ w.document.write("<pre style='white-space:pre-wrap;font-family:monospace;padding:16px;'>"+esc(json)+"</pre>"); }
});

// See helpers.js's matching block for why this exists and why it's safe:
// a no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildBoardExport: buildBoardExport, toJSON: toJSON };
}
