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
  "about.creditFonts": "Fonts: Public Sans and Archivo, served by Google Fonts under the SIL Open Font License 1.1.",
  "about.creditsTitle": "Credits & licenses",
  "about.creditProduct": "Squad Pulse is built by Dr. Agile. The app’s aggregation, weighting, investment ranking, and facilitator workflow are adaptations for this tool.",
  "about.creditSpotify": "Spotify Squad Health Check: Henrik Kniberg and Spotify. This project also credits Ben Linders’ agile self-assessment resources.",
  "about.creditFive": "The Five Dysfunctions of a Team: Patrick Lencioni / The Table Group. This app is an adaptation, not the official assessment.",
  "about.creditTuckman": "Team development stages: Bruce W. Tuckman (1965), with Mary Ann C. Jensen (1977). The source of this app’s 20-statement assessment and score bands has not yet been verified.",
  "about.creditRights": "Model names and assessment materials belong to their respective rights holders. Attribution does not grant permission to reproduce them or imply endorsement. The app’s Apache license does not relicense third-party assessment content.",
  "about.creditQr": "QR generation: qrcode-generator, copyright © 2009 Kazuhiko Arase, MIT License.",
  "about.appLicense": "Application license — Apache 2.0",
  "about.qrLicense": "QR generator — full MIT notice",
  "about.spotifySource": "Spotify model source",
  "about.benSource": "Ben Linders — self-assessment resources",
  "about.fiveSource": "The Table Group — original model",
  "about.tuckmanSource": "Tuckman — 1965 paper",
  "about.jensenSource": "Tuckman & Jensen — 1977 paper",
  "about.termsTitle": "Terms of use",
  "about.termsVersion": "Draft v0.1 • 2026-09-15 • Pending owner approval; no effective date yet.",
  "about.termsPurpose": "Squad Pulse supports team reflection and improvement. Results are discussion prompts, not validated individual performance measures or professional advice. Facilitators and participants remain responsible for how they interpret and use results.",
  "about.termsUse": "Use the app lawfully and with permission to share the information you enter. Respect participants and third-party rights. Do not use it to harass people, access boards without authorization, or disrupt the service.",
  "about.termsData": "Board data is stored in your browser. When sync is enabled, an encrypted copy is sent to the configured relay and may be retained there. Anyone with a team link can access and change that board. Session codes and invitations grant access to retro sessions; participant links can also share the team board. Share them only with intended collaborators.",
  "about.termsPrivacy": "Avoid entering sensitive personal information. Encryption does not make shared links private: retro encryption keys derive from the session code, so a relay operator can derive them. Hosting providers may receive connection metadata. Ask the operator of your deployment about retention and deletion; clearing browser storage does not delete relay copies.",
  "about.termsAvailability": "The software is provided as is under its applicable licenses, without guarantees of availability, accuracy, or preservation of data. Keep copies of information you need. Nothing in this notice excludes rights or liabilities that cannot lawfully be excluded.",
  "about.termsAcceptance": "Closing this introduction only remembers your display preference on this browser. It does not record acceptance of these draft terms. You can reopen them at any time through About & help.",

  "about.participantTitle": "Joining a retro?",
  "about.participantText": "Open your facilitator’s invitation or enter their six-character code. Answer each statement or choose a color, then submit. Follow the discussion; results may be held until the facilitator reveals them.",
  "about.join": "Join a retro",
  "about.return": "Back to my retro",
  "about.facilitatorTitle": "Running a retro?",
  "about.setup": "In Admin, set up your squads and choose or customize a template.",
  "about.start": "In Squad view, choose a squad and start a retro. Share the participant link, QR code, or session code.",
  "about.discuss": "Choose live or held results. Discuss the responses, adjust the consolidated rating if needed, and record an improvement experiment.",
  "about.finish": "Finish retro & apply results saves the consolidated ratings to the squad’s board.",
  "about.links": "A team link shares the board for ongoing collaboration. A retro invitation opens a particular session; participant invitations also carry the team link when team sync is enabled. Use the separate co-facilitator invitation for someone helping run the session.",
  "about.resultsTitle": "How to read the results",
  "about.colors": "Green: going well. Yellow: mixed or needs attention. Red: a challenge to discuss. Gray: not yet scored. Read the selected template’s dimension descriptions: some assessments use score bands with their own meaning.",
  "about.trends": "Trend arrows record whether things are improving or declining; they are separate from the current color.",
  "about.views": "Squad view focuses on one team. Tribe view highlights dimensions that are red or yellow across squads; expand the squad breakdown for details. Use these signals to start a conversation and choose where to help.",

  "about.open": "About & help",
  "about.title": "Welcome to Squad Pulse",
  "about.tagline": "Understand your team. Choose what to improve.",
  "about.intro": "Take a quick team health check, guide a retrospective, and spot patterns across squads.",
  "about.squad": "Squad view brings a team's health ratings and retrospective together.",
  "about.tribe": "Tribe view highlights shared challenges across squads to help focus improvement.",
  "about.admin": "Admin lets you set up squads and customize assessment templates.",
  "about.credit": "Built by Dr. Agile",
  "about.close": "Back to the app",

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
  "header.viewSwitchAriaLabel": "View",

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
  "admin.language.ariaLabel": "Language",

  "admin.boardSetup.heading": "Board setup",
  "admin.boardSetup.hint": "Manage the survey model and squad list. Changes here apply to everyone viewing this board.",
  "admin.boardSetup.editDimensions": "Edit dimensions",
  "admin.boardSetup.templates": "Templates",
  "admin.boardSetup.importCsv": "Import CSV",
  "admin.boardSetup.exportCsv": "Export CSV",
  "admin.boardSetup.exportJson": "Export JSON (beta)",

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
  "common.ok": "OK",

  "tribe.stats.assessedLabel": "{unitPlural} assessed",
  "tribe.stats.assessedSub": "{countUnit} tracked",
  "tribe.stats.sectionAriaLabel": "Snapshot at a glance",
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
  "ratingModal.redLabel": "Red looks like:",

  // Story 10: the retro JOIN flow (participant-facing screens) -- the
  // "Join a retro" code-entry modal, the join screen's connecting/ended/
  // unreachable/not-open states, the survey form chrome, and the personal
  // result screen. Dimension content itself (label/green/red/statement
  // text) stays untranslated by the same principle Story 9 applied to
  // template names: it's the admin's own authored content, snapshotted
  // onto the session at start time, not app chrome.
  "join.codeModal.title": "Join a retro",
  "join.codeModal.hint": "Enter the session code your Scrum Master shared. Answering a survey? Tap Join. Co-facilitating (you'll see the live results and can finish the retro too)? Tap Co-facilitate instead.",
  "join.codeModal.codePlaceholder": "e.g. 7K4QXB",
  "join.codeModal.cancel": "Cancel",
  "join.codeModal.coFacilitate": "Co-facilitate",
  "join.codeModal.join": "Join",
  "join.backButton": "← Back to Squad Pulse",
  "join.diagSummary": "Trouble joining? Tap for diagnostics",
  "join.diagHint": "If this isn't connecting, copy or screenshot what appears below and send it to whoever's running the retro.",
  "join.connectingHeading": "Connecting…",
  "join.connectingHint": "Hang tight while we connect to the board.",
  "join.endedHeading": "This retro has ended",
  "join.endedHint": "The facilitator closed this session. Ask them for a new link if another one is starting.",
  "join.unavailableHeading": "Can't connect to the retro server",
  "join.unavailableHint": "This device never reached the relay. Check your connection, or ask whoever's running the retro if it's up.",
  "join.notOpenHeading": "This retro session isn't open",
  "join.notOpenHint": "Check the link with whoever is running the retro — it may have already ended, or the link may be out of date.",
  "join.thanksHeading": "Thanks — here's your results",
  "join.retroLabel": "Retro: “{name}”.",
  "join.joiningHeading": "You're joining {squad}'s retro",
  "join.formHint": "Answer honestly — your answers are anonymous, and only your squad's combined result is ever shown.",
  "join.noDimensionsHint": "This retro doesn't have any dimensions set up yet.",
  "join.scale.rarely": "Rarely",
  "join.scale.sometimes": "Sometimes",
  "join.scale.usually": "Usually",
  "join.squadHealthCheckHeading": "Squad health check",
  "join.submitButton": "Submit",
  "join.submittingButton": "Submitting…",

  // Story 11: the retro FACILITATION flow (facilitator-facing screens) --
  // the session card (start/start-again, session code, live tally, reveal
  // toggle, sprint-experiment note, finish/close), the per-dimension
  // override editor (shares the rating modal's own markup -- see
  // modals.js's activeEditor()), and their confirm dialogs. Same scope
  // boundary as Story 10: dimension content (label/green/red) stays
  // untranslated, it's the admin's own authored content.
  "retro.noSession.heading": "Retro session",
  "retro.noSession.hint": "Start a live session using the board's current template (“{templateName}”) — teammates can join and answer on their own device.",
  "retro.startButton": "Start retro session",
  "retro.startingButton": "Starting…",
  "retro.inProgressHeading": "Retro session in progress",
  "retro.retroLabel": "Retro: “{name}”.",
  "retro.codeBlock.heading": "Session code",
  "retro.codeBlock.hint": "Have teammates open Squad Pulse and tap “Join a retro” up top, then type this code in.",
  "retro.reveal.ariaLabel": "Reveal mode",
  "retro.reveal.hold": "Hold results",
  "retro.reveal.live": "Show live",
  "retro.countLine.one": "1 teammate has submitted so far.",
  "retro.countLine.many": "{count} teammates have submitted so far.",
  "retro.live.heading": "Live results",
  "retro.live.waiting": "Waiting…",
  "retro.live.overriddenTag": "Overridden",
  "retro.live.overrideTitle": "Override this result",
  "retro.live.seeResponsesOne": "See all 1 response",
  "retro.live.seeResponsesMany": "See all {count} responses",
  "retro.live.responseRowLabel": "Response {n}",
  "retro.held.heading": "Results held",
  "retro.held.hint": " Switch to “Show live” any time to see the consolidated results as they come in.",
  "retro.experiment.heading": "Sprint experiment",
  "retro.experiment.hint": "What will the team try differently next sprint?",
  "retro.experiment.placeholder": "e.g. Pair on the riskiest story each day",
  "retro.experiment.saved": "Saved",
  "retro.experiment.saveButton": "Save note",
  "retro.finishButton": "Finish retro & apply results",
  "retro.closeButton": "Close session without applying results",
  "retro.shareLink.summary": "Or scan/share a link",
  "retro.shareLink.hint": "On some phones, scanning this opens the Claude app to the regular board instead of the retro — if that happens, use the session code above instead.",
  "retro.shareLink.linkLabel": "Join link",
  "retro.shareLink.copy": "Copy",
  "retro.coFacilitate.summary": "Bring in a co-facilitator",
  "retro.coFacilitate.hint": "A different link from the join link above — opening this gets the FULL facilitator view (live tally, override, finish), not the survey.",
  "retro.coFacilitate.linkLabel": "Co-facilitator link",
  "retro.coFacilitate.errorTitle": "Couldn't co-facilitate that session",
  "retro.coFacilitate.errorFallback": "Something went wrong reaching the relay. Check the diagnostic log below for details.",
  "retro.coFacilitate.notConnected": "Not connected to the relay yet — try again in a moment.",
  "retro.coFacilitate.codeNotOpen": "That session code isn't open.",
  "retro.confirmStart.errorTitle": "Couldn't start the retro session",
  "retro.confirmClose.title": "Close this retro session?",
  "retro.confirmClose.message": "Ends the session for everyone with the link. This does not change any of {name}'s existing ratings.",
  "retro.confirmClose.button": "Close without applying results",
  "retro.confirmFinishEmpty.title": "Finish this retro?",
  "retro.confirmFinishEmpty.message": "No submissions or overrides yet, so {name}'s ratings won't change. This just closes the session.",
  "retro.confirmFinish.title": "Finish this retro?",
  "retro.confirmFinish.message": "Writes these results into {name}'s ratings, then closes the session — {summary}",
  "retro.confirmFinish.button": "Finish & apply",
  "retro.confirmFinish.overriddenSuffix": " (overridden)",
  "retro.override.squadline": "Overriding this retro's consolidated result",
  "retro.override.notePlaceholder": "Why override this? (optional)",

  // Story 12: the Edit Dimensions modal (Admin). The dimension NAMES/green/
  // red text themselves are the admin's own authored content and stay
  // untranslated -- same principle Stories 9/10/11 already applied to
  // template names and session content. A freshly added dimension's default
  // "New dimension" label also stays English by the SAME precedent Story 4
  // already set for addSquad()'s "New {unit}" default -- it's editable
  // placeholder content, not app chrome.
  "dimManager.title": "Edit dimensions",
  "dimManager.hint": "These are the columns of your snapshot grid. Add, rename, reorder or remove them — changes apply to everyone viewing this board. Ratings for a removed dimension are hidden, not lost, unless you add a dimension back with the same purpose.",
  "dimManager.emptyHint": "No dimensions yet — add your first one below.",
  "dimManager.moveUpTitle": "Move up",
  "dimManager.moveDownTitle": "Move down",
  "dimManager.nameAriaLabel": "Dimension name",
  "dimManager.namePlaceholder": "Dimension name",
  "dimManager.removeTitle": "Remove dimension",
  "dimManager.greenLabel": "Green looks like",
  "dimManager.redLabel": "Red looks like",
  "dimManager.greenPlaceholder": "What healthy looks like",
  "dimManager.redPlaceholder": "What unhealthy looks like",
  "dimManager.statementsHeading": "Self-assessment statements",
  "dimManager.strategiesHeading": "Takeaway strategies",
  "dimManager.addButton": "+ Add dimension",
  "dimManager.doneButton": "Done",
  "dimManager.confirmRemoveTitle": "Remove dimension?",
  "dimManager.confirmRemoveMessage": "Remove “{name}” from the grid? Any ratings already given for it will be hidden (not deleted) unless you add it back.",
  "dimManager.confirmRemoveButton": "Remove",
  "dimManager.untitledFallback": "this dimension",

  // Bilingual dimensions: the per-dimension Hebrew-translation panel in
  // Edit Dimensions. These describe the panel itself (chrome, follows the
  // admin's own current UI language) -- the panel's OWN field labels are
  // fixed Hebrew text regardless of UI language (you're labeling Hebrew
  // content, not translating app chrome), so they're not t() keys.
  "dimManager.i18n.addToggle": "🇮🇱 Add a Hebrew translation",
  "dimManager.i18n.editedToggle": "🇮🇱 Hebrew translation — added",
  "dimManager.i18n.sourceDefault": "Default translation from {template} — editable",
  "dimManager.i18n.sourceNone": "No translation yet — this dimension shows English under a Hebrew UI until one is added"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LOCALE_EN: LOCALE_EN };
}
