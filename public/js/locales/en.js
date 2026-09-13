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
  // Story 6: the app header/nav chrome, outside every view container. The
  // app NAME itself is a deliberate brand-name pass-through -- same literal
  // value in every locale (see locales/he.js's header comment) -- still
  // routed through t() so it satisfies "every string on an i18n-supported
  // screen goes through t()" mechanically without producing an awkward
  // literal translation of a proper noun.
  "header.appName": "Squad Pulse",
  "header.tagline": "A fast, visual health snapshot across your {unitPlural} — so you can see at a glance where things are strong and where to invest next.",
  "header.syncConnecting": "Connecting…",
  "header.syncLive": "Live — synced across viewers",
  "header.syncPreviewOnly": "Preview only — not connected",
  "header.joinRetro": "Join a retro",
  "header.backToRetro": "← Back to my retro",
  "header.viewTribe": "Tribe view",
  "header.viewSquad": "Squad view",
  "header.viewAdmin": "Admin",

  // Story 9: the Templates modal's own chrome. The template NAMES
  // themselves and a starter template's own dimension content (Stories
  // 5/7/8) are NOT covered here -- a template's name and a saved custom
  // template's dimension text are the admin's own content, not app chrome.
  "templates.title": "Survey templates",
  "templates.hint": "Swap in a ready-made set of dimensions, or save your current setup so you (or a teammate) can reuse it later.",
  "templates.starterHeading": "Starter templates",
  "templates.ownHeading": "Your templates",
  "templates.emptyOwnHint": "No saved templates yet — set up your dimensions the way you want, then save the current setup as a template below.",
  "templates.namePlaceholder": "Name this setup, e.g. “My team's checklist”",
  "templates.saveButton": "Save current as template",
  "templates.closeButton": "Close",
  "templates.loadButton": "Load",
  "templates.deleteTitle": "Delete template",
  "templates.meta.dimensionsOne": "1 dimension",
  "templates.meta.dimensionsMany": "{count} dimensions",
  "templates.meta.rates": " · rates {unit}",
  "templates.meta.scoredFromStatements": " · {count} scored from statements",
  "templates.confirmLoadTitle": "Load “{name}”?",
  "templates.confirmLoadMessage": "This replaces your current {oldCount} dimension(s) with {name}'s {newCount}. Ratings tied to dimensions that don't carry over will be hidden, not deleted.",
  "templates.confirmLoadButton": "Load template",
  "templates.confirmDeleteTitle": "Delete “{name}”?",
  "templates.confirmDeleteMessage": "This removes the saved template. It won't affect your current dimensions or ratings.",
  "templates.confirmDeleteButton": "Delete",
  "templates.switchingBusy": "Switching to “{name}”…",

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
  "admin.diagnostics.copyButton": "Copy diagnostics",

  "common.color.good": "Green",
  "common.color.warn": "Yellow",
  "common.color.crit": "Red",
  "common.color.unscored": "Not yet scored",
  "common.trend.up": "Improving",
  "common.trend.down": "Declining",
  "common.trend.flat": "Steady",
  "common.trend.upSuffix": ", improving",
  "common.trend.downSuffix": ", declining",
  "common.scoreLine": "{score} pts · {fraction} scored",
  "common.ptsOnly": "{score} pts",
  "common.breakdownLine": "{crit} red · {warn} yellow",
  "common.hasNoteTitle": "Has a note",

  "tribe.stats.assessedLabel": "{unitPlural} assessed",
  "tribe.stats.assessedSub": "{countUnit} tracked",
  "tribe.stats.riskLabel": "Items at risk",
  "tribe.stats.riskSub": "dimensions marked red across all squads",
  "tribe.stats.hotspotLabel": "Top systemic hotspot",
  "tribe.stats.hotspotNone": "None yet",
  "tribe.stats.hotspotSubFlagged": "{count} of {totalUnit} flagged this red",
  "tribe.stats.hotspotSubNone": "no dimension is red across multiple {unitPlural}",

  "tribe.hotspots.heading": "Cross-squad hotspots",
  "tribe.hotspots.hint": "Dimensions where trouble shows up in more than one squad — likely worth an org-level fix, not a squad-by-squad one. Shown in aggregate; no squad is named here by default.",
  "tribe.hotspots.countLine": "{crit} red / {total}",
  "tribe.hotspots.empty": "Score a few {unitPlural} to see patterns emerge.",

  "tribe.breakdown.summary": "Squad-by-squad breakdown",
  "tribe.breakdown.hint": "Collapsed by default so the headline view stays about patterns, not individual squads — expand any time to see or drill into a specific squad. Read-only here; squads enter their own ratings from Squad view.",
  "tribe.ranking.heading": "Where to invest first",
  "tribe.ranking.hint": "Squads ranked by weighted risk (red counts double). Highest first.",
  "tribe.ranking.empty": "Add a {unit} to get started.",
  "tribe.grid.empty": "No dimensions yet. Add one from Admin, or load a template.",

  "tribe.legend.summaryOne": "How to read the 1 dimension",
  "tribe.legend.summaryMany": "How to read the {count} dimensions",
  "tribe.legend.empty": "No dimensions defined yet.",
  "tribe.legend.attribDefault": "Dimensions are fully custom to this board — manage them any time via Edit dimensions or Templates.",
  "tribe.legend.greenLabel": "Green:",
  "tribe.legend.redLabel": "Red:",
  "tribe.tooltip.noDescription": "No description yet",

  "squad.picker.heading": "Choose your squad",
  "squad.picker.hint": "Pick your squad to enter or update this check-in's ratings. Only this squad's own data is shown here.",
  "squad.picker.empty": "No {unitPlural} yet — ask an admin to add one.",
  "squad.empty": "Select your {unit} above to enter or review its ratings.",
  "squad.hotspots.heading": "Your hotspots",
  "squad.hotspots.hint": "Where {name} is flagged red or yellow right now.",
  "squad.hotspots.empty": "Nothing red or yellow right now — nice work.",
  "squad.entries.empty": "No dimensions yet — ask an admin to set some up.",

  "ratingModal.healthLabel": "Health",
  "ratingModal.trendLabel": "Trend since last check",
  "ratingModal.noteLabel": "Note (optional)",
  "ratingModal.notePlaceholder": "Why this rating? What's driving it?",
  "ratingModal.cancel": "Cancel",
  "ratingModal.save": "Save",
  "ratingModal.greenLabel": "Green looks like:",
  "ratingModal.redLabel": "Red looks like:"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOCALE_EN: LOCALE_EN };
}
