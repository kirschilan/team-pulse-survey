"use strict";

// English is the source of truth for every key -- i18n.js's t() falls back
// to this table whenever the active locale is missing a key (see i18n.js),
// so a partially-translated language degrades to English one string at a
// time rather than showing a blank or a raw key. Every key here MUST also
// exist in locales/he.js (or whichever locale is added next) -- enforced by
// tests/unit/test_i18n.js's key-parity check, which is this repo's
// mechanical half of the "every future change supports every language"
// policy (see STATUS.md).
//
// {word} tokens (e.g. {unit}, {name}) are filled in by t(key, vars) at call
// time -- see i18n.js. The value substituted for {unit}/{unitPlural} is
// whatever this board's admin named it (Squad/Team/Person/...) and is NOT
// itself translated here; that's a separate, deeper feature this story
// doesn't attempt.
var LOCALE_EN = {
  "admin.language.heading": "Language",
  "admin.language.betaBadge": "Beta",
  "admin.language.hint": "Choose the language for the Admin panel. More of the app will follow as translation coverage grows.",

  "admin.boardSetup.heading": "Board setup",
  "admin.boardSetup.hint": "Manage the survey model and squad list. Changes here apply to everyone viewing this board.",
  "admin.boardSetup.editDimensions": "Edit dimensions",
  "admin.boardSetup.templates": "Templates",
  "admin.boardSetup.importCsv": "Import CSV",
  "admin.boardSetup.exportCsv": "Export CSV",

  "admin.teamSync.heading": "Team sync",
  "admin.teamSync.hint": "This board syncs, live, with every other device that opens the link below — over the same encrypted relay retro sessions already use. Nobody without the link can read or change it.",
  "admin.teamSync.notConnectedHint": "Syncing is off for this device.",
  "admin.teamSync.connectedStatus": "Connected — this device stays in sync, live, with every other device using this link.",
  "admin.teamSync.startLink": "Start a new team link",
  "admin.teamSync.linkLabel": "Team link",
  "admin.teamSync.copy": "Copy",
  "admin.teamSync.stopSyncing": "Stop syncing",
  "admin.teamSync.joinHint": "Have a team link from a teammate? Opening it connects automatically — or paste it here to join (or switch to) their team:",
  "admin.teamSync.joinPlaceholder": "Paste a team link",
  "admin.teamSync.join": "Join",

  "admin.squads.heading": "Squads",
  "admin.squads.hint": "Add, rename or remove squads. Ratings live with the squad, not the name — renaming is safe.",
  "admin.squads.addButton": "+ Add {unit}",
  "admin.squads.nameAriaLabel": "{unit} name",
  "admin.squads.removeTitle": "Remove {unit}",
  "admin.squads.emptyList": "No {unitPlural} yet — add one below.",
  "admin.squads.confirmRemoveTitle": "Remove {unit}?",
  "admin.squads.confirmRemoveMessage": "Remove “{name}”? Its ratings go with it.",
  "admin.squads.confirmRemoveButton": "Remove",
  "admin.squads.untitledFallback": "Untitled {unit}",
  "admin.squads.thisUnit": "this {unit}",

  "admin.diagnostics.summary": "Diagnostics (temporary — for troubleshooting save issues)",
  "admin.diagnostics.hint": "If saving isn't working, open this, try rating a cell, then copy or screenshot what appears below.",
  "admin.diagnostics.copyButton": "Copy diagnostics"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOCALE_EN: LOCALE_EN };
}
