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
// customized away from ITS OWN TEMPLATE's English default (checked by exact
// string match against that template's own `dimensions`/`attribution`) --
// a hand-edited dimension is the admin's own content and must never be
// silently swapped for a translation they didn't write. Checked per FIELD
// (not per dimension), so customizing only `label` still lets `green`/`red`
// localize normally.
//
// Generalized (Stories 6-9) from an earlier version hardcoded to
// SPOTIFY_TEMPLATE alone: looks up whichever STARTER_TEMPLATES entry is
// currently active BY NAME and uses THAT template's own `.i18n` table, so
// any starter template that declares one (Tuckman, Five Dysfunctions, ...)
// gets the exact same live-render-time translation for free -- no
// per-template special-casing needed here or at any render call site.
function activeStarterTemplate(){
  return STARTER_TEMPLATES.find(function(t){ return t.name === state.config.activeTemplateName; });
}

// Bilingual dimensions (redesigned after real-usage feedback -- see
// STATUS.md): a dimension's Hebrew translation used to be a hardcoded,
// TEMPLATE-level shadow table, only ever consulted at render time by
// matching the dimension's CURRENT value against that template's own
// English default -- fragile (an array field round-tripping through a
// session doc's own JSON-shaped storage broke the reference-equality
// check that used to gate it) and unextendable (only the 3 built-in
// starter templates could ever have one; a custom/saved template or a
// hand-edited dimension got no translation, ever; and it could never be
// corrected without an engineer editing state.js).
//
// It's now a plain, editable field living ON the dimension itself --
// dim.i18n.he.{label,green,red,statements,strategies} -- same shape the
// three starter templates' own dimension entries carry below, seeded from
// their own hardcoded defaults but from here on just another field an
// admin can edit (dimensions.js) same as label/green/red. Copied forward
// wherever the dimension itself travels -- loadTemplate(), templates.js's
// saveCurrentAsTemplate(), and startSession()'s session snapshot -- so
// this ONE lookup works identically for a live board dimension, a saved
// custom template's own dimension, and a retro session's frozen copy:
// none of them need to know which template (if any) they came from.
//
// Real regression this redesign introduced, found live in the product
// owner's own board: `i18n` is only ever WRITTEN onto a dimension doc when
// loadTemplate()/startSession() actually runs, or on a brand-new seeded
// board -- an already-saved dimension doc from BEFORE this redesign
// shipped is never retroactively backfilled, so it has no `i18n` at all.
// The OLD mechanism this replaced matched a dimension's current VALUE
// against STARTER_TEMPLATES regardless of when it was saved, so it kept
// working for any pre-existing board; this redesign silently dropped that
// safety net. builtinDimByKey() restores it as a fallback UNDER the
// dimension's own i18n (an admin's real translation always wins), matching
// a built-in starter template's dimension by its stable KEY -- but unlike
// the old shadow table, which compared by fragile REFERENCE equality (the
// exact thing that broke for an array field round-tripping through a
// session doc's JSON-shaped storage), localizedDimText() below additionally
// gates each use of this fallback on the field's/element's own current
// VALUE still matching the built-in's English default -- a value (string)
// comparison can't break on a JSON round-trip the way a reference
// comparison can, and it also means a field an admin HAS since edited away
// from the default correctly falls back to plain English instead of
// showing a stale, unrelated built-in translation.
function builtinDimByKey(key){
  for (var i=0;i<STARTER_TEMPLATES.length;i++){
    var dims = STARTER_TEMPLATES[i].dimensions;
    for (var j=0;j<dims.length;j++){
      if (dims[j].key === key) return dims[j];
    }
  }
  return null;
}

// Shared by localizedDimText() below (locale-gated, used everywhere the app
// DISPLAYS a dimension) and the bilingual-dimensions editor's own pre-fill
// (dimensions.js -- it always shows/edits the Hebrew side of a dimension
// regardless of the admin's own current UI locale, so it calls this
// directly rather than through localizedDimText()). Pass `index` for an
// array field (statements/strategies); omit it for a scalar one
// (label/green/red). Returns undefined when no safe fallback exists --
// caller decides what "no fallback" means for its own context.
function builtinDimTranslation(dim, field, index, locale){
  var builtin = builtinDimByKey(dim.key);
  var builtinTr = builtin && builtin.i18n && builtin.i18n[locale];
  if(!builtinTr) return undefined;
  if(index === undefined){
    if(builtin[field] !== dim[field]) return undefined;
    return builtinTr[field];
  }
  var builtinArr = builtin[field], dimArr = dim[field];
  if(!Array.isArray(builtinArr) || !Array.isArray(dimArr) || builtinArr[index] !== dimArr[index]) return undefined;
  return builtinTr[field] && builtinTr[field][index];
}

function localizedDimText(dim, field){
  var value = dim[field];
  var locale = (state.ui && state.ui.locale) || "en";
  if(locale === "en") return value;
  var tr = dim.i18n && dim.i18n[locale] && dim.i18n[locale][field];
  if(Array.isArray(value)){
    // Per-ELEMENT fallback, not per-array: the bilingual-dimensions editor
    // (dimensions.js) lets an admin translate statements one at a time, so
    // a real Hebrew array is very often partially filled mid-edit -- an
    // all-or-nothing fallback would show a blank line for every
    // not-yet-translated entry instead of its English text. Same logic
    // extends one tier further to the built-in fallback, each element
    // independently value-gated (see builtinDimTranslation()'s comment).
    return value.map(function(v, i){
      var t = tr && tr[i];
      if(t !== undefined && t !== null && String(t).trim() !== "") return t;
      var bt = builtinDimTranslation(dim, field, i, locale);
      return (bt !== undefined && bt !== null && String(bt).trim() !== "") ? bt : v;
    });
  }
  if(tr !== undefined && tr !== null && String(tr).trim() !== "") return tr;
  var builtinTr = builtinDimTranslation(dim, field, undefined, locale);
  return (builtinTr !== undefined && builtinTr !== null && String(builtinTr).trim() !== "") ? builtinTr : value;
}

function localizedAttribution(attribution){
  var locale = (state.ui && state.ui.locale) || "en";
  if(locale === "en") return attribution;
  var tpl = activeStarterTemplate();
  if(!tpl || !tpl.i18n) return attribution;
  if(attribution !== tpl.attribution) return attribution;
  var tr = tpl.i18n[locale];
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
//
// Story 8: Hebrew translation of this template's own dimension content --
// label/green/red, same shape/status as SPOTIFY_DIMENSIONS_HE/
// TUCKMAN_DIMENSIONS_HE above. statements/strategies added later, once a
// real usage report showed the retro survey itself was never translated
// (see STATUS.md) -- same array shape/order as the English default in
// FIVE_DYSFUNCTIONS_TEMPLATE.dimensions below, read by index (see
// retro-join.js's interleavedStatements()), so reordering one without the
// other would silently mismatch a translation to the wrong statement.
var FIVE_DYSFUNCTIONS_DIMENSIONS_HE = {
  trust:          { label:"היעדר אמון",
    green:"נוח לנו להיראות פגיעים זה כלפי זה — מודים בטעויות ובחולשות, ומבקשים עזרה, בלי פחד.",
    red:"אנחנו שומרים על עצמנו; הודאה בחולשה מרגישה לא בטוחה, ולכן אמון אמיתי אף פעם לא ממש נוצר.",
    statements:[
      "חברי הצוות מתנצלים זה בפני זה במהירות ובאמת כאשר הם אומרים או עושים משהו לא הולם או עלול לפגוע בצוות.",
      "חברי הצוות מודים בגלוי בחולשות ובטעויות שלהם.",
      "חברי הצוות יודעים על חייהם האישיים זה של זה ומרגישים בנוח לדבר עליהם."
    ],
    strategies:[ "זהו ודונו בחוזקות ובחולשות האישיות.", "הקדישו זמן משמעותי לפגישות פנים אל פנים ומפגשי עבודה." ] },
  conflict:       { label:"פחד מקונפליקט",
    green:"אנחנו מנהלים דיון ישיר ונלהב על רעיונות — חילוקי דעות הם דבר נורמלי ופרודוקטיבי.",
    red:"אנחנו נמנעים מחיכוך כדי לשמור על שלווה בצוות, כך שחילוקי דעות אמיתיים נשארים מתחת לפני השטח (הרמוניה מדומה).",
    statements:[
      "חברי הצוות נלהבים וגלויים בדיון שלהם בסוגיות.",
      "פגישות הצוות מרתקות, ולא משעממות.",
      "במהלך פגישות הצוות, הסוגיות החשובות והקשות ביותר מועלות על השולחן לפתרון."
    ],
    strategies:[ "הכירו בכך שקונפליקט נדרש לפגישות פרודוקטיביות.", "הבינו את סגנונות הקונפליקט הטבעיים של חברי הצוות, וקבעו כללי יסוד משותפים להתמודדות עם קונפליקט." ] },
  commitment:     { label:"היעדר מחויבות",
    green:"אנחנו יוצאים מהחלטות עם בהירות ומחויבות, גם אחרי ויכוח אמיתי — \"לא להסכים ולהתחייב\".",
    red:"החלטות נשארות מעורפלות או מוסכמות רק בחלקן, כך שהצוות חוזר ודן בהן שוב מאוחר יותר (תחושת חוסר בהירות).",
    statements:[
      "חברי הצוות יודעים על מה עמיתיהם עובדים ואיך הם תורמים לטובת הצוות המשותפת.",
      "חברי הצוות עוזבים פגישות בביטחון שעמיתיהם מחויבים לחלוטין להחלטות שהוסכמו, גם אם היה חילוקי דעות ראשוני.",
      "חברי הצוות מסיימים דיונים עם החלטות ברורות וספציפיות וקריאות לפעולה."
    ],
    strategies:[ "סקרו התחייבויות בסוף כל פגישה כדי לוודא שכל חברי הצוות מיושרים.", "אמצו גישת \"לא להסכים ולהתחייב\" — ודאו שכל חברי הצוות מחויבים ללא קשר לחילוקי דעות ראשוניים." ] },
  accountability: { label:"הימנעות מאחריותיות",
    green:"אנחנו דורשים אחריותיות (accountability) זה מזה באופן ישיר, גם כשזה לא נוח.",
    red:"אנחנו מוכנים לסבול סטנדרטים נמוכים במקום להעיר אחד לשני.",
    statements:[
      "חברי הצוות מעירים זה לזה על ליקויים או התנהגויות לא פרודוקטיביות.",
      "חברי הצוות מודאגים מאוד מהאפשרות לאכזב את עמיתיהם.",
      "חברי הצוות מאתגרים זה את זה לגבי התוכניות והגישות שלהם."
    ],
    strategies:[ "תקשרו במפורש מטרות וסטנדרטים של התנהגות.", "דונו באופן קבוע בביצועים לעומת מטרות וסטנדרטים." ] },
  results:        { label:"התעלמות מתוצאות",
    green:"אנחנו נשארים ממוקדים בתוצאות המשותפות של הצוות, מעל מעמד אישי או אגו.",
    red:"מטרות אישיות או אגו תופסים עדיפות באופן שקט על פני התוצאות המשותפות של הצוות.",
    statements:[
      "חברי הצוות מוכנים ברצון לעשות ויתורים (כמו תקציב, תחום שליטה, כוח אדם) במחלקות או בתחומי המומחיות שלהם לטובת הצוות.",
      "המורל מושפע באופן משמעותי מאי-השגת מטרות הצוות.",
      "חברי הצוות אינם ממהרים לבקש קרדיט על תרומותיהם שלהם, אך ממהרים לציין את תרומותיהם של אחרים."
    ],
    strategies:[ "שמרו על מיקוד הצוות במטרות קבוצתיות מוחשיות.", "תגמלו יחידים בהתבסס על מטרות הצוות והצלחה קולקטיבית." ] }
};
var FIVE_DYSFUNCTIONS_ATTRIBUTION_HE = "מותאם מהערכת \"חמשת התפקודים הלקויים של צוות\" מאת פטריק לנציוני (The Table Group). טווחי הניקוד 8–9 / 6–7 / 3–5 לקוחים מההערכה המקורית; איחוד תשובות של כמה חברי צוות לדירוג לוח אחד, וההחלפה הידנית של המנחה, הם פרי פיתוחה של Dr. Agile.";

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
      strategies:[ "Identify and discuss individual strengths and weaknesses.", "Spend considerable time in face-to-face meetings and working sessions." ],
      i18n: { he: FIVE_DYSFUNCTIONS_DIMENSIONS_HE.trust } },
    { key:"conflict", label:"Fear of Conflict", order:2,
      green:"We engage in direct, passionate debate about ideas — disagreement is normal and productive.",
      red:"We avoid friction to keep the peace, so real disagreements stay under the surface (false harmony).",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members are passionate and unguarded in their discussion of issues.",
        "Team meetings are compelling, and not boring.",
        "During team meetings, the most important — and difficult — issues are put on the table to be resolved."
      ],
      strategies:[ "Acknowledge that conflict is required for productive meetings.", "Understand individual team members' natural conflict styles, and establish common ground rules for engaging in conflict." ],
      i18n: { he: FIVE_DYSFUNCTIONS_DIMENSIONS_HE.conflict } },
    { key:"commitment", label:"Lack of Commitment", order:3,
      green:"We leave decisions clear and committed to, even after real debate — “disagree and commit.”",
      red:"Decisions stay vague or half-agreed, so the team re-litigates them later (a sense of ambiguity).",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members know what their peers are working on and how they contribute to the collective good of the team.",
        "Team members leave meetings confident that their peers are completely committed to the decisions that were agreed on, even if there was initial disagreement.",
        "Team members end discussions with clear and specific resolutions and calls to action."
      ],
      strategies:[ "Review commitments at the end of each meeting to ensure all team members are aligned.", "Adopt a “disagree and commit” mentality — make sure all team members are committed regardless of initial disagreements." ],
      i18n: { he: FIVE_DYSFUNCTIONS_DIMENSIONS_HE.commitment } },
    { key:"accountability", label:"Avoidance of Accountability", order:4,
      green:"We hold each other accountable directly, even when it's uncomfortable.",
      red:"We tolerate low standards rather than call each other out.",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members call out one another's deficiencies or unproductive behaviors.",
        "Team members are deeply concerned about the prospect of letting down their peers.",
        "Team members challenge one another about their plans and approaches."
      ],
      strategies:[ "Explicitly communicate goals and standards of behavior.", "Regularly discuss performance versus goals and standards." ],
      i18n: { he: FIVE_DYSFUNCTIONS_DIMENSIONS_HE.accountability } },
    { key:"results", label:"Inattention to Results", order:5,
      green:"We stay focused on the team's collective results over individual status or ego.",
      red:"Individual goals or ego quietly take priority over the team's shared results.",
      scoreBands:{ good:8, warn:6 },
      statements:[
        "Team members willingly make sacrifices (such as budget, turf, head count) in their departments or areas of expertise for the good of the team.",
        "Morale is significantly affected by the failure to achieve team goals.",
        "Team members are slow to seek credit for their own contributions, but quick to point out those of others."
      ],
      strategies:[ "Keep the team focused on tangible group goals.", "Reward individuals based on team goals and collective success." ],
      i18n: { he: FIVE_DYSFUNCTIONS_DIMENSIONS_HE.results } }
  ],
  i18n: {
    he: { attribution: FIVE_DYSFUNCTIONS_ATTRIBUTION_HE }
  }
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
//
// Story 7: Hebrew translation of this template's own dimension content,
// same shape and same AI-translated/pending-human-review status as
// SPOTIFY_DIMENSIONS_HE above -- only label/green/red are translated (not
// .statements/.strategies: nothing reads those yet, see the comment on
// FIVE_DYSFUNCTIONS_TEMPLATE below for why).
// statements/strategies added later, same reason/shape as
// FIVE_DYSFUNCTIONS_DIMENSIONS_HE's own header comment above.
var TUCKMAN_DIMENSIONS_HE = {
  forming:    { label:"התהוות",
    green:"השלב הזה בולט כרגע — הצוות עדיין מחפש את מקומו, המטרות עשויות להיות לא ברורות, וחברי הצוות נשענים על המנהיג כדי לקבל כיוון.",
    red:"שלב ההתהוות לא בולט במיוחד כרגע — ייתכן שהצוות כבר עבר את ההתמצאות הראשונית, או שהוא עדיין בתהליך ההתבססות.",
    statements:[
      "חברי הצוות עדיין לומדים על התפקידים, המומחיות של זה של זה, ואיך הם משתלבים בצוות.",
      "יש חוסר ודאות לגבי מטרות הצוות, סדרי העדיפויות, או איך להמשיך בעבודה שלנו.",
      "חברי הצוות מצפים מהמנהיג לספק כיוון ולהבהיר ציפיות.",
      "האינטראקציות בצוות שלנו מרגישות מנומסות וזהירות, כשחברי הצוות נזהרים במה שהם אומרים."
    ],
    strategies:[ "השקיעו זמן בגיבוש צוות ובהכרות הדדית.", "תקשרו בבירור מטרות, תפקידים וציפיות.", "ספקו מנהיגות ומבנה ראשוניים חזקים.", "צרו מרחב לשאלות ולהבהרות." ] },
  storming:   { label:"סערה",
    green:"השלב הזה בולט כרגע — חילוקי דעות עולים לפני השטח, ניכרת התנגדות מסוימת למשימה, ומתח או אג'נדות אישיות מתחילים להופיע.",
    red:"שלב הסערה לא בולט במיוחד כרגע — הצוות נמנע מקונפליקט והתנגדות.",
    statements:[
      "חילוקי דעות או קונפליקטים עולים במהלך פגישות צוות או דיונים.",
      "חלק מחברי הצוות נראים כמתנגדים למשימה הנוכחית או מטילים ספק בגישות המוצעות.",
      "קליקות, תת-קבוצות, או אג'נדות אישיות מתחילות להופיע בתוך הצוות.",
      "ניכר מתח או תגובות רגשיות כאשר מתקבלות החלטות או נקבע כיוון."
    ],
    strategies:[ "העלו חילוקי דעות לפני השטח וטפלו בהם ישירות.", "קבעו כללי יסוד לקונפליקט פרודוקטיבי.", "עזרו לחברי הצוות להבין נקודות מבט מגוונות.", "חזקו מחדש את מטרות הצוות והמטרה המשותפת." ] },
  norming:    { label:"נירמול",
    green:"השלב הזה בולט כרגע — הצוות מסכים בהדרגה על נורמות משותפות, על התפקידים ברורים, ומתפתחת תמיכה הדדית.",
    red:"שלב ההתכנסות לא בולט במיוחד כרגע — עדיין מוקדם לדבר על נורמות משותפות ובהירות של תפקידים.",
    statements:[
      "הצוות הסכים על סטנדרטים, נורמות, או דרכי עבודה משותפות.",
      "חברי הצוות מבינים בבירור את התפקידים והאחריות שלהם.",
      "אנחנו מסוגלים לתת ולקבל משוב בצורה בונה, בלי פחד.",
      "יש תחושת אחדות ותמיכה הדדית בין חברי הצוות."
    ],
    strategies:[ "חזקו את הנורמות וסטנדרטים העבודה שהוסכמו.", "הכירו וחגגו יישור קו ושיתוף פעולה.", "עודדו משוב בין עמיתים ואחריותיות הדדית.", "בנו על האמון והלכידות המתפתחים." ] },
  performing: { label:"ביצועים גבוהים",
    green:"השלב הזה בולט כרגע — הצוות פועל בגמישות ובתלות הדדית, עם אנרגיה ממוקדת בתוצאות ופרודוקטיביות גבוהה.",
    red:"שלב הביצוע לא בולט במיוחד כרגע — הצוות לא פועל בגמישות ואינו ממוקד בתוצאות.",
    statements:[
      "הצוות שלנו פועל בגמישות, כאשר תפקידים ואחריות משתנים לפי הצורך.",
      "אנחנו מרכזים את האנרגיה שלנו בפתרון בעיות והשגת מטרות הצוות.",
      "הצוות מפיק תוצאות באיכות גבוהה ושומר על פרודוקטיביות חזקה.",
      "חברי הצוות לוקחים בעלות ועובדים בתלות הדדית עם פיקוח מינימלי."
    ],
    strategies:[ "האצילו סמכויות בקבלת החלטות והעצימו אוטונומיה.", "התמקדו בשיפור מתמיד ובלמידה.", "חגגו תוצאות והצלחות משותפות.", "שמרו על ביטחון פסיכולוגי ואמון." ] },
  adjourning: { label:"התפזרות",
    green:"השלב הזה בולט כרגע — הצוות מהרהר במה שהשיג ולמד, ומכיר בתרומתו של כל אחד ככל שהדברים מסתיימים או משתנים.",
    red:"שלב ההתפזרות לא בולט במיוחד כרגע — הצוות לא נמצא ברגע של סיום או מעבר.",
    statements:[
      "הצוות מהרהר בהישגים ובמה שלמדנו יחד.",
      "יש הכרה בתרומות האישיות ובערך שכל חבר הביא.",
      "חברי הצוות מביעים רגשות מעורבים לגבי סיום או שינוי הצוות.",
      "אנחנו לוקחים זמן לחגוג הצלחות ולתכנן את מה שבא בהמשך."
    ],
    strategies:[ "ערכו רטרוספקטיבות ואספו לקחים שנלמדו.", "הכירו בתרומות אישיות וקולקטיביות.", "הכירו ברגשות ובערך של מערכות היחסים.", "תכננו סיומים ומעברים מכוונים." ] }
};
var TUCKMAN_ATTRIBUTION_HE = "מותאם משלבי ההתפתחות הקבוצתית של ברוס טאקמן (Forming, Storming, Norming, Performing, Adjourning). טווחי הניקוד 10–12 / 8–9 / 4–7 לקוחים מההערכה המקורית; איחוד תשובות של כמה חברי צוות לדירוג לוח אחד, וההחלפה הידנית של המנחה, הם פרי פיתוחה של Dr. Agile.";

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
      strategies:[ "Invest time in team-building and getting to know one another.", "Clearly communicate goals, roles, and expectations.", "Provide strong initial leadership and structure.", "Create space for questions and clarification." ],
      i18n: { he: TUCKMAN_DIMENSIONS_HE.forming } },
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
      strategies:[ "Surface disagreements and address them directly.", "Establish ground rules for productive conflict.", "Help team members understand diverse perspectives.", "Reaffirm team goals and shared purpose." ],
      i18n: { he: TUCKMAN_DIMENSIONS_HE.storming } },
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
      strategies:[ "Reinforce agreed-upon norms and working standards.", "Recognize and celebrate alignment and cooperation.", "Encourage peer feedback and mutual accountability.", "Build on emerging trust and cohesion." ],
      i18n: { he: TUCKMAN_DIMENSIONS_HE.norming } },
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
      strategies:[ "Delegate decision-making and empower autonomy.", "Focus on continuous improvement and learning.", "Celebrate results and shared successes.", "Maintain psychological safety and trust." ],
      i18n: { he: TUCKMAN_DIMENSIONS_HE.performing } },
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
      strategies:[ "Conduct retrospectives and harvest lessons learned.", "Acknowledge individual and collective contributions.", "Recognize emotions and the value of relationships.", "Plan intentional closures and transitions." ],
      i18n: { he: TUCKMAN_DIMENSIONS_HE.adjourning } }
  ],
  i18n: {
    he: { attribution: TUCKMAN_ATTRIBUTION_HE }
  }
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
    return { key:d.key, label:d.label, green:d.green, red:d.red, order:d.order,
      i18n: { he: SPOTIFY_DIMENSIONS_HE[d.key] } };
  }),
  // Board-level (not per-dimension) translation -- see loadTemplate() for
  // when this gets copied onto a board's config, and localizedAttribution()
  // for how it's applied live. Per-dimension translation lives on each
  // dimension entry above instead (see localizedDimText()'s own comment).
  i18n: {
    he: { attribution: SPOTIFY_ATTRIBUTION_HE }
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
  // (?session=<secret>) -- a device in this mode shows only the join screen,
  // never the Tribe/Squad/Admin switcher, regardless of ui.view above. SEC-2:
  // this is the session's SECRET, not its relay room id -- the room id is a
  // one-way hash of it (see crypto.js's roomIdFor()), resolved asynchronously
  // by listenJoinSession() (retro-join.js) into joinRoomId below.
  joinSessionId: null,
  joinRoomId: null,
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
// Capture invitation intent before board-sync removes the team secret from the URL.
var openedFromInvitation = ["session", "cofacilitate", "team"].some(function(key){ return getQueryParam(key) !== null; });
state.joinSessionId = getQueryParam("session");
// Story 10: a co-facilitator link (?cofacilitate=<secret>) is a completely
// different join shape from a participant's (?session=<secret>) -- it boots
// the NORMAL Tribe/Squad/Admin app (never join mode) and just attaches
// this device to an already-open session by its secret, landing on Squad
// view for that session's squad -- see retro-facilitator.js's
// coFacilitateSessionByCode(), called once from db.js's initDb().
state.coFacilitateSessionId = getQueryParam("cofacilitate");
(function loadUiPrefs(){
  try{
    var v = localStorage.getItem("squadpulse:view");
    var s = localStorage.getItem("squadpulse:squad");
    var lang = localStorage.getItem("squadpulse:lang");
    if(v==="tribe" || v==="squad" || v==="admin") state.ui.view = v;
    if(s) state.ui.selectedSquadId = s;
    if(lang==="en" || lang==="he"){
      state.ui.locale = lang;
    } else {
      // No preference of THIS device's own yet -- a join/co-facilitate
      // link's own `&lang=` param (see helpers.js's langParamFor()) is the
      // only other source, and only as a fallback default: it never
      // overrides a preference this device already made for itself, which
      // is exactly why this branch is reached only when `lang` above was
      // absent/invalid. Treated as this device's own preference from here
      // on (persisted, not just applied for this one page load) -- a
      // participant who joined via a Hebrew link is overwhelmingly likely
      // a Hebrew speaker, so remembering it saves them from re-discovering
      // the language switcher on every future visit too.
      var linkLang = getQueryParam("lang");
      if(linkLang==="en" || linkLang==="he"){
        state.ui.locale = linkLang;
        try{ localStorage.setItem("squadpulse:lang", linkLang); }catch(e2){ /* per-viewer convenience only */ }
      }
    }
  }catch(e){ /* localStorage unavailable -- fall back to defaults */ }
})();

// See i18n.js's/helpers.js's matching block for why this exists and why
// it's safe: a no-op in the browser (`module` is undefined there),
// unlocking direct `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    PLACEHOLDER_DIMENSIONS: PLACEHOLDER_DIMENSIONS,
    SPOTIFY_TEMPLATE: SPOTIFY_TEMPLATE,
    FIVE_DYSFUNCTIONS_TEMPLATE: FIVE_DYSFUNCTIONS_TEMPLATE,
    TUCKMAN_TEMPLATE: TUCKMAN_TEMPLATE,
    SPOTIFY_ATTRIBUTION: SPOTIFY_ATTRIBUTION,
    STARTER_TEMPLATES: STARTER_TEMPLATES,
    localizedDimText: localizedDimText,
    localizedAttribution: localizedAttribution,
    builtinDimTranslation: builtinDimTranslation,
    state: state
  };
}
