"use strict";


// ---------- multi-language support ----------
// Story 1: Admin panel. Story 4: Tribe view, Squad view, and the shared
// rating modal. Story 6: the app header/nav chrome. Story 9: the Templates
// modal. Story 10: the retro JOIN flow (participant screens + the "Join a
// retro" code modal). Story 11: the retro FACILITATOR flow (session card,
// override editor, confirm dialogs). Story 12: the Edit Dimensions modal.
// Story 13: the JSON board export button and the JSON import preview modal
// (#importJsonBackdrop) -- item 1/3a, translated from the start; CSV export/
// import remain English-only (their own future item 4). RTL_SCOPED_CONTAINERS
// below lists every container currently translated -- each gets its own
// dir/lang flip; nothing else does, so a still-English screen never
// visually breaks under an RTL layout it was never translated for. A
// still-English WIDGET embedded inside a translated container (e.g. the
// retro session card inside #viewSquad) sets its own dir="ltr" on its root
// to opt back out -- see retro-facilitator.js's renderSessionCardHtml().
//
// LOCALE_EN (locales/en.js) is the source of truth for every key; LOCALE_HE
// (locales/he.js) is what a human corrects when a phrase reads wrong -- see
// that file's own header comment. t() falls back to English for any key
// missing in the active locale, so a partially-translated future language
// degrades one string at a time instead of showing a blank.
var LOCALES = { en: LOCALE_EN, he: LOCALE_HE };
var DEFAULT_LOCALE = "en";
var SUPPORTED_LOCALES = ["en", "he"];
var LANG_STORAGE_KEY = "squadpulse:lang";
var RTL_SCOPED_CONTAINERS = ["viewAdmin", "viewTribe", "viewSquad", "backdrop", "appHeader", "templatesBackdrop", "viewJoin", "joinCodeBackdrop", "dimBackdrop", "aboutDialog", "importJsonBackdrop", "confirmBackdrop"];

function t(key, vars){
  var loc = (state && state.ui && state.ui.locale) || DEFAULT_LOCALE;
  var table = LOCALES[loc] || LOCALE_EN;
  var str = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : LOCALE_EN[key];
  if(str === undefined) return key; // missing from every locale -- surface the key, not a blank
  if(vars){
    Object.keys(vars).forEach(function(k){
      // Wrap each substituted value in Unicode bidi isolate marks (U+2066
      // LEFT-TO-RIGHT ISOLATE / U+2069 POP DIRECTIONAL ISOLATE) so its own
      // directionality -- an untranslated English unit name embedded in a
      // Hebrew sentence, a squad name of unknown script, a number -- never
      // leaks out to reorder the surrounding translated text's word order.
      // Real, observed bug otherwise (see STATUS.md): "{count} {unit}
      // tracked" rendered with {count} and {unit} visually swapped once
      // the Hebrew sentence around them took over the paragraph's bidi
      // resolution, even though .textContent (the logical string) was
      // always correct -- only the on-screen rendering was scrambled.
      // These are plain Unicode characters, not markup, so this is safe
      // for a plain .textContent assignment, not just innerHTML.
      str = str.split("{"+k+"}").join("⁦"+vars[k]+"⁩");
    });
  }
  return str;
}

// Applies every [data-i18n] element's textContent, every
// [data-i18n-placeholder] element's placeholder, and every
// [data-i18n-title] element's title attribute from the active locale --
// called once at boot and again on every setLocale(). Static markup only;
// strings built in JS (dynamic rows, confirm dialogs, aria-labels) call
// t() directly instead, since their own render function already re-runs on
// every relevant change.
function applyStaticTranslations(){
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el){
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(function(el){
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}

// Localized counterparts of helpers.js's colorWord()/trendWord() -- kept
// separate rather than making those two i18n-aware directly, since they're
// also called from retro-facilitator.js/retro-join.js, which aren't
// i18n-supported yet (Stories 9-10); making them locale-aware would leak
// Hebrew into an otherwise-English retro screen the moment someone switches
// languages, ahead of the story that's actually supposed to translate it.
// Used only from render.js/squads.js's Tribe- and Squad-view code.
function colorWordLocalized(color){
  return color==="good" ? t("common.color.good") : color==="warn" ? t("common.color.warn") : color==="crit" ? t("common.color.crit") : t("common.color.unscored");
}
function trendWordLocalized(trend, suffix){
  if(suffix) return trend==="up" ? t("common.trend.upSuffix") : trend==="down" ? t("common.trend.downSuffix") : "";
  return trend==="up" ? t("common.trend.up") : trend==="down" ? t("common.trend.down") : "";
}

function updateLangSwitchUi(){
  document.querySelectorAll(".lang-btn").forEach(function(btn){
    btn.classList.toggle("active", btn.getAttribute("data-lang") === (state.ui.locale || DEFAULT_LOCALE));
  });
}

function applyScopedDirLang(loc){
  RTL_SCOPED_CONTAINERS.forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    el.setAttribute("dir", loc === "he" ? "rtl" : "ltr");
    el.setAttribute("lang", loc);
  });
}

function setLocale(loc){
  if(SUPPORTED_LOCALES.indexOf(loc) === -1) return;
  state.ui.locale = loc;
  try{ localStorage.setItem(LANG_STORAGE_KEY, loc); }catch(e){ /* per-viewer convenience only */ }
  applyScopedDirLang(loc);
  applyStaticTranslations();
  updateLangSwitchUi();
  if(typeof renderAll === "function") renderAll(); // re-render strings built in JS (squad list, grid, entries, ...)
  if(typeof renderTeamSyncStatus === "function") renderTeamSyncStatus(); // not part of renderAll() -- only re-rendered on connect/disconnect otherwise
}

if (typeof document !== "undefined" && document.querySelectorAll){
  applyStaticTranslations();
  updateLangSwitchUi();
  document.querySelectorAll(".lang-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ setLocale(btn.getAttribute("data-lang")); });
  });
  if(state && state.ui && state.ui.locale === "he") applyScopedDirLang("he");
}

// See helpers.js's matching block for why this exists and why it's safe: a
// no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { t: t, SUPPORTED_LOCALES: SUPPORTED_LOCALES, LOCALES: LOCALES };
}
