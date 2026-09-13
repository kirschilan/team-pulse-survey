"use strict";

// Shared mutable board state, starter template content, and the initial
// per-viewer UI prefs load. Loaded first (plain global script, not an ES
// module -- file:// blocks cross-file module imports in Chromium, which
// this app's Playwright suite and its "open index.html directly" support
// both rely on) so every later file can reference `state` as a bare global
// and mutate its properties in place (never reassign the binding itself).

// Starter dimension set (Spotify Squad Health Check-inspired). IDs match
// what this board is seeded with in the live "dimensions" collection, and
// also match the keys already used inside each squad's stored ratings --
// keep these ids stable so existing ratings never get orphaned.
var PLACEHOLDER_DIMENSIONS = [
  { key:"release",   label:"Easy to release", order:1,
    green:"Releasing is routine, low-risk, and low-drama.",
    red:"Releases are rare, risky, or dreaded events." },
  { key:"process",    label:"Suitable process", order:2,
    green:"Our way of working fits us, and we can tune it ourselves.",
    red:"Process feels imposed, bureaucratic, or mismatched to how we work." },
  { key:"techquality",label:"Tech quality", order:3,
    green:"We're proud of our codebase and engineering practices.",
    red:"Quality is a constant source of pain and slow-down." },
  { key:"value",      label:"Value", order:4,
    green:"What we ship clearly matters to users and the business.",
    red:"We're not confident our work is moving the needle." },
  { key:"speed",      label:"Speed", order:5,
    green:"We get things done quickly, without cutting corners.",
    red:"Progress feels slow and heavy." },
  { key:"mission",    label:"Mission", order:6,
    green:"We know why we exist and where we're headed.",
    red:"The mission is vague, or keeps shifting under us." },
  { key:"fun",        label:"Fun", order:7,
    green:"We genuinely enjoy working together.",
    red:"Coming to work feels like a grind." },
  { key:"learning",   label:"Learning", order:8,
    green:"We're growing, trying new things, and sharing what we learn.",
    red:"We're stagnant — same patterns, no time to learn." },
  { key:"support",    label:"Support", order:9,
    green:"We get the help we need, when we need it, from the org around us.",
    red:"We're on our own — blocked, or ignored." },
  { key:"pawns",      label:"Pawns or players", order:10,
    green:"We help decide what to build and how.",
    red:"We just execute a backlog someone else wrote." },
  { key:"teamwork",   label:"Teamwork", order:11,
    green:"We function as one team, not a collection of individuals.",
    red:"We're fragmented, siloed, or in open conflict." },
  { key:"codebase",   label:"Codebase health", order:12,
    green:"The codebase is something we can safely and confidently change.",
    red:"Every change feels risky, brittle, or full of surprises." }
];

var SPOTIFY_ATTRIBUTION = "Dimensions adapted from the Spotify Squad Health Check model (Henrik Kniberg & Spotify, via Ben Linders’ agile self-assessment survey). Scoring, weighting and the investment ranking here are Dr. Agile’s own.";

var DEFAULT_CONFIG = { unit:"Squad", unitPlural:"Squads", activeTemplateName:"Spotify Squad Health Check", attribution: SPOTIFY_ATTRIBUTION };

// Story 5: Hebrew translation of the Spotify starter template's own DATA
// (dimension label/green/red, attribution) -- distinct from Stories 1-4's UI
// CHROME translation (t()/data-i18n in locales/en.js+he.js). This content
// isn't looked up through t(): it's plain strings copied into mutable board
// data the moment a starter template is loaded (see templates.js's
// loadTemplate()), so a translation table lives here, keyed by the SAME
// dimension keys PLACEHOLDER_DIMENSIONS above uses -- never a positional
// array, so a future reordering of PLACEHOLDER_DIMENSIONS can't silently
// mismatch a translation to the wrong dimension.
//
// AI-TRANSLATED, PENDING HUMAN REVIEW, same as locales/he.js -- edit the
// Hebrew text below directly when a phrase reads wrong. Only the Spotify
// template is covered so far; Five Dysfunctions/Tuckman stay English until
// their own stories translate them.
var SPOTIFY_DIMENSIONS_HE = {
  release:    { label:"קלות שחרור לפרודקשן",
    green:"השחרור הוא שגרתי, בסיכון נמוך וללא דרמה.",
    red:"שחרורים הם נדירים, מסוכנים, או מעוררי חשש." },
  process:    { label:"תהליך עבודה מתאים",
    green:"צורת העבודה שלנו מתאימה לנו, ואנחנו יכולים לכוונן אותה בעצמנו.",
    red:"התהליך מרגיש כפוי, בירוקרטי, או לא תואם לאופן שבו אנחנו עובדים." },
  techquality:{ label:"איכות טכנולוגית",
    green:"אנחנו גאים בקוד ובשיטות העבודה ההנדסיות שלנו.",
    red:"האיכות היא מקור מתמשך לכאב ולהאטה." },
  value:      { label:"ערך",
    green:"ברור שמה שאנחנו משחררים חשוב למשתמשים ולעסק.",
    red:"אנחנו לא בטוחים שהעבודה שלנו באמת מקדמת משהו." },
  speed:      { label:"מהירות",
    green:"אנחנו מספקים דברים במהירות, בלי לקצר תהליכים.",
    red:"ההתקדמות מרגישה איטית וכבדה." },
  mission:    { label:"משימה",
    green:"אנחנו יודעים לשם מה אנחנו קיימים ולאן אנחנו הולכים.",
    red:"המשימה מעורפלת, או משתנה כל הזמן." },
  fun:        { label:"כיף",
    green:"אנחנו נהנים באמת לעבוד ביחד.",
    red:"להגיע לעבודה מרגיש כמו התשה." },
  learning:   { label:"למידה",
    green:"אנחנו מתפתחים, מנסים דברים חדשים, ומשתפים את מה שאנחנו לומדים.",
    red:"אנחנו קופאים על השמרים — אותם דפוסים, בלי זמן ללמוד." },
  support:    { label:"תמיכה",
    green:"אנחנו מקבלים את העזרה שאנחנו צריכים, בזמן שאנחנו צריכים אותה, מהארגון שסביבנו.",
    red:"אנחנו לבד — חסומים, או מתעלמים מאיתנו." },
  pawns:      { label:"שחקנים או כלים במשחק",
    green:"אנחנו עוזרים להחליט מה לבנות ואיך.",
    red:"אנחנו רק מבצעים בקלוג שמישהו אחר כתב." },
  teamwork:   { label:"עבודת צוות",
    green:"אנחנו מתפקדים כצוות אחד, לא כאוסף של יחידים.",
    red:"אנחנו מפוצלים, מבודדים, או בקונפליקט גלוי." },
  codebase:   { label:"בריאות בסיס הקוד",
    green:"בסיס הקוד הוא משהו שאנחנו יכולים לשנות בבטחה ובביטחון.",
    red:"כל שינוי מרגיש מסוכן, שביר, או מלא בהפתעות." }
};

var SPOTIFY_ATTRIBUTION_HE = "הממדים מותאמים ממודל Spotify Squad Health Check (הנריק קניברג ו-Spotify, דרך סקר ההערכה העצמית האג'ילי של בן לינדרס). הניקוד, המשקלים ודירוג ההשקעה כאן הם פרי פיתוחה של Dr. Agile.";

// Story 5 (corrected after real-usage feedback -- see STATUS.md): dimension
// label/green/red and the board's attribution are localized LIVE, at render
// time, same philosophy as i18n.js's t() -- looked up fresh on every render,
// never baked into stored data. An earlier version of this translated once,
// at the moment a starter template was explicitly (re-)loaded via the
// Templates modal -- which meant the DEFAULT board (never manually
// reloaded) stayed English forever even after switching the language
// switcher to Hebrew, since nothing ever re-ran that one-time snapshot.
// This version fixes that: any render site can call these two helpers
// directly instead of reading `d.label`/`d.green`/`d.red`/`config.attribution`
// off the dimension/config object, and they always reflect the CURRENT
// locale.
//
// Both helpers refuse to translate a dimension/attribution the admin has
// customized away from the Spotify template's own English default (checked
// by exact string match against PLACEHOLDER_DIMENSIONS/SPOTIFY_ATTRIBUTION)
// -- a hand-edited dimension is the admin's own content and must never be
// silently swapped for a translation they didn't write. Checked per FIELD
// (not per dimension), so customizing only `label` still lets `green`/`red`
// localize normally.
function localizedDimText(dim, field){
  var value = dim[field];
  var locale = (state.ui && state.ui.locale) || "en";
  if(locale === "en") return value;
  if(state.config.activeTemplateName !== SPOTIFY_TEMPLATE.name) return value;
  var base = PLACEHOLDER_DIMENSIONS.find(function(p){ return p.key === dim.key; });
  if(!base || base[field] !== value) return value;
  var table = SPOTIFY_TEMPLATE.i18n[locale] && SPOTIFY_TEMPLATE.i18n[locale].dimensions;
  var tr = table && table[dim.key];
  return (tr && tr[field]) || value;
}

function localizedAttribution(attribution){
  var locale = (state.ui && state.ui.locale) || "en";
  if(locale === "en") return attribution;
  if(state.config.activeTemplateName !== SPOTIFY_TEMPLATE.name) return attribution;
  if(attribution !== SPOTIFY_ATTRIBUTION) return attribution;
  var tr = SPOTIFY_TEMPLATE.i18n[locale];
  return (tr && tr.attribution) || attribution;
}

// ---------- starter templates (built in, not stored in the live "templates"
// collection -- always offered, never deletable, and never cost a db write
// just by existing). Each "scored" dimension below carries a bank of
// statements plus scoreBands: this is content only for now -- nothing reads
// .statements yet, so loading this template still works exactly like any
// other (each dimension just starts unscored, rated the regular way via the
// swatches). A later change teaches the rating flow to render these
// statements as a mini 1/2/3 survey and compute the color from the sum
// instead; the data is here now so that flow has something to load.
var FIVE_DYSFUNCTIONS_TEMPLATE = {
  id: "starter-5dysfunctions",
  starter: true,
  name: "The Five Dysfunctions of a Team",
  unit: "Squad", unitPlural: "Squads",
  attribution: "Adapted from Patrick Lencioni’s The Five Dysfunctions of a Team assessment (The Table Group). The 8–9 / 6–7 / 3–5 scoring bands are from the original assessment; consolidating multiple teammates’ answers into one board rating, and the facilitator override, are Dr. Agile’s own.",
  dimensions: [
    { key:"trust", label:"Absence of Trust", order:1,
      green:"We're vulnerable with each other — admitting mistakes and weaknesses, and asking for help, without fear.",
      red:"We stay guarded; admitting a weakness feels unsafe, so real trust never quite forms.",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members quickly and genuinely apologize to one another when they say or do something inappropriate or possibly damaging to the team.",
        "Team members openly admit their weaknesses and mistakes.",
        "Team members know about one another's personal lives and are comfortable discussing them."
      ],
      strategies:[ "Identify and discuss individual strengths and weaknesses.", "Spend considerable time in face-to-face meetings and working sessions." ] },
    { key:"conflict", label:"Fear of Conflict", order:2,
      green:"We engage in direct, passionate debate about ideas — disagreement is normal and productive.",
      red:"We avoid friction to keep the peace, so real disagreements stay under the surface (false harmony).",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members are passionate and unguarded in their discussion of issues.",
        "Team meetings are compelling, and not boring.",
        "During team meetings, the most important — and difficult — issues are put on the table to be resolved."
      ],
      strategies:[ "Acknowledge that conflict is required for productive meetings.", "Understand individual team members' natural conflict styles, and establish common ground rules for engaging in conflict." ] },
    { key:"commitment", label:"Lack of Commitment", order:3,
      green:"We leave decisions clear and committed to, even after real debate — “disagree and commit.”",
      red:"Decisions stay vague or half-agreed, so the team re-litigates them later (a sense of ambiguity).",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members know what their peers are working on and how they contribute to the collective good of the team.",
        "Team members leave meetings confident that their peers are completely committed to the decisions that were agreed on, even if there was initial disagreement.",
        "Team members end discussions with clear and specific resolutions and calls to action."
      ],
      strategies:[ "Review commitments at the end of each meeting to ensure all team members are aligned.", "Adopt a “disagree and commit” mentality — make sure all team members are committed regardless of initial disagreements." ] },
    { key:"accountability", label:"Avoidance of Accountability", order:4,
      green:"We hold each other accountable directly, even when it's uncomfortable.",
      red:"We tolerate low standards rather than call each other out.",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members call out one another's deficiencies or unproductive behaviors.",
        "Team members are deeply concerned about the prospect of letting down their peers.",
        "Team members challenge one another about their plans and approaches."
      ],
      strategies:[ "Explicitly communicate goals and standards of behavior.", "Regularly discuss performance versus goals and standards." ] },
    { key:"results", label:"Inattention to Results", order:5,
      green:"We stay focused on the team's collective results over individual status or ego.",
      red:"Individual goals or ego quietly take priority over the team's shared results.",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members willingly make sacrifices (such as budget, turf, head count) in their departments or areas of expertise for the good of the team.",
        "Morale is significantly affected by the failure to achieve team goals.",
        "Team members are slow to seek credit for their own contributions, but quick to point out those of others."
      ],
      strategies:[ "Keep the team focused on tangible group goals.", "Reward individuals based on team goals and collective success." ] }
  ]
};

// Tuckman's stages of group development (forming/storming/norming/
// performing/adjourning), via a common 20-statement team-assessment
// adaptation (4 statements per stage, summed 4-12, same 1/2/3 Rarely/
// Sometimes/Usually scale as the Five Dysfunctions assessment). Unlike the
// Five Dysfunctions template, a high score here isn't "healthy" or
// "unhealthy" in itself -- it just means that stage is CURRENTLY
// PROMINENT (the source material's own interpretation: 10-12 = prominent,
// 8-9 = emerging/transitioning, 4-7 = not characteristic right now). We
// reuse the app's existing good/warn/crit band mechanism to carry exactly
// that reading (green = "prominent," not "good news") rather than
// reinterpreting Tuckman as if one stage were objectively better than
// another -- the green/red anchor text on each dimension spells this out.
var TUCKMAN_TEMPLATE = {
  id: "starter-tuckman",
  starter: true,
  name: "Tuckman's Team Development Stages",
  unit: "Squad", unitPlural: "Squads",
  attribution: "Adapted from Bruce Tuckman's stages of group development (forming, storming, norming, performing, adjourning). The 10–12 / 8–9 / 4–7 scoring bands are from the source assessment; consolidating multiple teammates’ answers into one board rating, and the facilitator override, are Dr. Agile’s own.",
  dimensions: [
    { key:"forming", label:"Forming", order:1,
      green:"This stage is prominent right now — the team is still getting oriented, goals may be unclear, and members lean on the leader for direction.",
      red:"Forming isn't strongly showing up right now — the team may already be past early orientation, or still settling into it.",
      scoreBands:{ good:10, warn:8 },
      statements:[
        "Team members are still learning about each other's roles, expertise, and how they fit into the team.",
        "There is uncertainty about the team's goals, priorities, or how to proceed with our work.",
        "Team members look to the leader to provide direction and clarify expectations.",
        "Our team interactions feel polite and cautious, with members being careful about what they say."
      ],
      strategies:[ "Invest time in team-building and getting to know one another.", "Clearly communicate goals, roles, and expectations.", "Provide strong initial leadership and structure.", "Create space for questions and clarification." ] },
    { key:"storming", label:"Storming", order:2,
      green:"This stage is prominent right now — disagreements are surfacing, some resistance to the task is visible, and tension or personal agendas are showing up.",
      red:"Storming isn't strongly showing up right now — conflict and resistance aren't dominating right now.",
      scoreBands:{ good:10, warn:8 },
      statements:[
        "Disagreements or conflicts surface during team meetings or discussions.",
        "Some team members seem to resist the task at hand or question proposed approaches.",
        "Cliques, subgroups, or personal agendas are emerging within the team.",
        "Tension or emotional reactions are noticeable when decisions are made or direction is set."
      ],
      strategies:[ "Surface disagreements and address them directly.", "Establish ground rules for productive conflict.", "Help team members understand diverse perspectives.", "Reaffirm team goals and shared purpose." ] },
    { key:"norming", label:"Norming", order:3,
      green:"This stage is prominent right now — the team has agreed on shared norms, roles are clear, and mutual support is developing.",
      red:"Norming isn't strongly showing up right now — shared norms and role clarity may still be taking hold.",
      scoreBands:{ good:10, warn:8 },
      statements:[
        "The team has agreed on shared standards, norms, or ways of working together.",
        "Team members understand their roles and responsibilities clearly.",
        "We are able to give and receive feedback constructively without fear.",
        "There is a sense of unity and mutual support among team members."
      ],
      strategies:[ "Reinforce agreed-upon norms and working standards.", "Recognize and celebrate alignment and cooperation.", "Encourage peer feedback and mutual accountability.", "Build on emerging trust and cohesion." ] },
    { key:"performing", label:"Performing", order:4,
      green:"This stage is prominent right now — the team operates flexibly and interdependently, with energy focused on results and strong productivity.",
      red:"Performing isn't strongly showing up right now — the team isn't operating with this level of flexibility and results focus.",
      scoreBands:{ good:10, warn:8 },
      statements:[
        "Our team operates flexibly, with roles and responsibilities shifting as needed.",
        "We focus our energy on solving problems and achieving team goals.",
        "The team produces high-quality results and maintains strong productivity.",
        "Team members take ownership and work interdependently with minimal supervision."
      ],
      strategies:[ "Delegate decision-making and empower autonomy.", "Focus on continuous improvement and learning.", "Celebrate results and shared successes.", "Maintain psychological safety and trust." ] },
    { key:"adjourning", label:"Adjourning", order:5,
      green:"This stage is prominent right now — the team is reflecting on what it accomplished and learned, and acknowledging each other's contributions as things wind down or change.",
      red:"Adjourning isn't strongly showing up right now — the team isn't in a winding-down or transition moment.",
      scoreBands:{ good:10, warn:8 },
      statements:[
        "The team reflects on accomplishments and what we've learned together.",
        "There is acknowledgment of individual contributions and the value each member brought.",
        "Team members express mixed emotions about the team ending or changing.",
        "We are taking time to celebrate successes and plan for what comes next."
      ],
      strategies:[ "Conduct retrospectives and harvest lessons learned.", "Acknowledge individual and collective contributions.", "Recognize emotions and the value of relationships.", "Plan intentional closures and transitions." ] }
  ]
};

// The board's own default dimension set (PLACEHOLDER_DIMENSIONS above) was
// never itself registered as a loadable starter template -- only the seed
// data for a fresh board. That meant switching to Five Dysfunctions or
// Tuckman and back left no way to reload the original Spotify Squad Health
// Check set from the Templates modal. Fixed by wrapping the same dimension
// data in a proper starter template entry, same shape as the other two.
var SPOTIFY_TEMPLATE = {
  id: "starter-spotify",
  starter: true,
  name: "Spotify Squad Health Check",
  unit: "Squad", unitPlural: "Squads",
  attribution: SPOTIFY_ATTRIBUTION,
  dimensions: PLACEHOLDER_DIMENSIONS.map(function(d){
    return { key:d.key, label:d.label, green:d.green, red:d.red, order:d.order };
  }),
  // Story 5: locale -> translated content, consulted only by loadTemplate()
  // at the moment this starter template is loaded (see templates.js). Not
  // consulted for the fresh-board seed (PLACEHOLDER_DIMENSIONS assigned
  // directly, always English) or the Templates-modal list/name (Story 8).
  i18n: {
    he: { attribution: SPOTIFY_ATTRIBUTION_HE, dimensions: SPOTIFY_DIMENSIONS_HE }
  }
};

var STARTER_TEMPLATES = [ SPOTIFY_TEMPLATE, FIVE_DYSFUNCTIONS_TEMPLATE, TUCKMAN_TEMPLATE ];
function findAnyTemplateById(id){
  var starter = STARTER_TEMPLATES.find(function(t){ return t.id===id; });
  if(starter) return starter;
  return state.templates.find(function(t){ return t.id===id; });
}

// ids match the doc ids the artifact is seeded with (squad-1..squad-7), so a
// click that happens before the live snapshot arrives still resolves once it does
var PLACEHOLDER_SQUADS = [1,2,3,4,5,6,7].map(function(n){
  return { id:"squad-"+n, name:"Squad "+n, order:n, dimensions:{} };
});

var state = {
  squads: PLACEHOLDER_SQUADS,
  dimensions: PLACEHOLDER_DIMENSIONS,
  templates: [],
  sessions: [],
  config: Object.assign({}, DEFAULT_CONFIG),
  live:false, db:null,
  // Exactly one of these is ever set at a time -- see modals.js's
  // activeEditor(). Two separate, plainly-named slots instead of one
  // `editing` object with a hidden `mode:"session"` flag, so which kind of
  // edit is in progress is visible from the field itself.
  editingCell:null, editingOverride:null,
  confirmAction:null,
  // per-viewer UI state -- which of the three views is showing, and (for
  // Squad view) which squad this browser is currently acting as. This is
  // NOT synced through the shared db: it's local to this browser only, so
  // remembering it via localStorage is just a convenience (each device
  // tends to be used by/for the same squad) and never grants or restricts
  // access to anything -- the underlying data stays fully shared/visible.
  // locale: which language's strings the Admin panel renders (see i18n.js)
  // -- "en"/"he" today, more as future stories translate more of the app.
  // Same per-viewer-only, localStorage-remembered shape as view/
  // selectedSquadId above.
  ui: { view:"tribe", selectedSquadId:null, locale:"en" },
  // set when this page was opened via a retro session's join link
  // (?session=<id>) -- a device in this mode shows only the join screen,
  // never the Tribe/Squad/Admin switcher, regardless of ui.view above
  joinSessionId: null,
  joinSession: null,
  // set by listenJoinSession() when the relay itself couldn't be reached at
  // all (vs. reachable-but-no-such-doc) -- lets the join screen tell "can't
  // connect to the relay" apart from "this code doesn't match a session"
  joinUnavailable: false,
  // this device's in-progress/completed answers for the *current* session --
  // never synced anywhere except the anonymous submission itself; purely
  // local so this one browser knows what it's already answered/is drafting
  joinDraftAnswers: {},
  joinSubmittedResults: {},  // dimension key -> { sum, band } once submitted
  // facilitator-side: live tally of anonymous submissions for whichever
  // session is currently shown in Squad view (see subscribeSessionResponses)
  sessionResponses: []
};

function getQueryParam(name){
  try{ return new URLSearchParams(window.location.search).get(name); }catch(e){ return null; }
}
state.joinSessionId = getQueryParam("session");
// Story 10: a co-facilitator link (?cofacilitate=<code>) is a completely
// different join shape from a participant's (?session=<id>) -- it boots
// the NORMAL Tribe/Squad/Admin app (never join mode) and just attaches
// this device to an already-open session by code, landing on Squad view
// for that session's squad -- see retro-facilitator.js's
// coFacilitateSessionByCode(), called once from db.js's initDb().
state.coFacilitateSessionId = getQueryParam("cofacilitate");
(function loadUiPrefs(){
  try{
    var v = localStorage.getItem("squadpulse:view");
    var s = localStorage.getItem("squadpulse:squad");
    var lang = localStorage.getItem("squadpulse:lang");
    if(v==="tribe" || v==="squad" || v==="admin") state.ui.view = v;
    if(s) state.ui.selectedSquadId = s;
    if(lang==="en" || lang==="he") state.ui.locale = lang;
  }catch(e){ /* localStorage unavailable -- fall back to defaults */ }
})();

// See i18n.js's/helpers.js's matching block for why this exists and why
// it's safe: a no-op in the browser (`module` is undefined there),
// unlocking direct `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLACEHOLDER_DIMENSIONS: PLACEHOLDER_DIMENSIONS,
    SPOTIFY_TEMPLATE: SPOTIFY_TEMPLATE,
    SPOTIFY_ATTRIBUTION: SPOTIFY_ATTRIBUTION,
    STARTER_TEMPLATES: STARTER_TEMPLATES,
    localizedDimText: localizedDimText,
    localizedAttribution: localizedAttribution,
    state: state
  };
}
