"use strict";

// Lets the product owner review/correct a starter template's English AND
// Hebrew content as one plain JSON file, instead of editing state.js's
// hardcoded JS objects directly -- every translation there is marked
// "AI-translated, pending human review" (see state.js's own comments), and
// this is the round-trip that review is meant to go through: export, edit
// the file, hand it back to a Claude Code session to apply to state.js.
// This script only exports; there's no importer here on purpose -- state.js
// is source code, not data a script should rewrite unattended, so applying
// an edited file back is a Claude-assisted step (Claude reads the file and
// edits state.js directly), not an automated one.
//
// Usage: node scripts/export-template-translations.js [output-path]
//   (defaults to translations-export.json in the repo root)

const fs = require("fs");
const path = require("path");
const { installFakeDom } = require("../tests/unit/fake_dom.js");

// state.js's own top-level code touches window.location/localStorage --
// same reason tests/unit/*.js installs this before require()-ing it.
installFakeDom();

const { STARTER_TEMPLATES } = require("../public/js/state.js");

function bilingual(en, he){
  return { en: en || "", he: he || "" };
}

function exportTemplate(tpl){
  const dimensions = {};
  tpl.dimensions.forEach(function(d){
    const he = (d.i18n && d.i18n.he) || {};
    const entry = {
      label: bilingual(d.label, he.label),
      green: bilingual(d.green, he.green),
      red: bilingual(d.red, he.red)
    };
    if(d.statements) entry.statements = bilingual(d.statements, he.statements);
    if(d.strategies) entry.strategies = bilingual(d.strategies, he.strategies);
    dimensions[d.key] = entry;
  });
  return {
    attribution: bilingual(tpl.attribution, tpl.i18n && tpl.i18n.he && tpl.i18n.he.attribution),
    dimensions: dimensions
  };
}

function buildExport(){
  const templates = {};
  STARTER_TEMPLATES.forEach(function(tpl){ templates[tpl.name] = exportTemplate(tpl); });
  return { generatedAt: new Date().toISOString(), templates: templates };
}

const outPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "translations-export.json"));
fs.writeFileSync(outPath, JSON.stringify(buildExport(), null, 2) + "\n");
console.log("[export-template-translations] wrote " + outPath);
