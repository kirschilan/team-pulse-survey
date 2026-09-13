"use strict";


// ---------- multi-language support ----------
// Story 1 of the multi-language roadmap (see STATUS.md): a t()/setLocale()
// layer for the Admin panel only -- Tribe/Squad view, the retro flow, and
// every modal (Edit dimensions, Templates, CSV import) stay English-only
// until their own future stories translate them. This deliberately does NOT
// flip the whole document to rtl: only #viewAdmin's own dir/lang attributes
// change, so the rest of the still-English app doesn't visually break under
// a page-wide RTL layout it was never translated for.
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

function t(key, vars){
  var loc = (state && state.ui && state.ui.locale) || DEFAULT_LOCALE;
  var table = LOCALES[loc] || LOCALE_EN;
  var str = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : LOCALE_EN[key];
  if(str === undefined) return key; // missing from every locale -- surface the key, not a blank
  if(vars){
    Object.keys(vars).forEach(function(k){
      str = str.split("{"+k+"}").join(vars[k]);
    });
  }
  return str;
}

// Applies every [data-i18n] element's textContent and every
// [data-i18n-placeholder] element's placeholder from the active locale --
// called once at boot and again on every setLocale(). Static markup only;
// admin-panel strings built in JS (squads.js's dynamic squad rows, confirm
// dialogs) call t() directly instead, since renderAdminSquadList() already
// re-renders on every relevant change.
function applyStaticTranslations(){
  document.querySelectorAll("[data-i18n]").forEach(function(el){
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function(el){
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
}

function updateLangSwitchUi(){
  document.querySelectorAll(".lang-btn").forEach(function(btn){
    btn.classList.toggle("active", btn.getAttribute("data-lang") === (state.ui.locale || DEFAULT_LOCALE));
  });
}

function setLocale(loc){
  if(SUPPORTED_LOCALES.indexOf(loc) === -1) return;
  state.ui.locale = loc;
  try{ localStorage.setItem(LANG_STORAGE_KEY, loc); }catch(e){ /* per-viewer convenience only */ }
  var adminSection = document.getElementById("viewAdmin");
  if(adminSection){
    adminSection.setAttribute("dir", loc === "he" ? "rtl" : "ltr");
    adminSection.setAttribute("lang", loc);
  }
  applyStaticTranslations();
  updateLangSwitchUi();
  if(typeof renderAll === "function") renderAll(); // re-render admin-panel strings built in JS (squad list, add-squad button, ...)
  if(typeof renderTeamSyncStatus === "function") renderTeamSyncStatus(); // not part of renderAll() -- only re-rendered on connect/disconnect otherwise
}

if (typeof document !== "undefined" && document.querySelectorAll){
  applyStaticTranslations();
  updateLangSwitchUi();
  document.querySelectorAll(".lang-btn").forEach(function(btn){
    btn.addEventListener("click", function(){ setLocale(btn.getAttribute("data-lang")); });
  });
  var adminSectionBoot = document.getElementById("viewAdmin");
  if(adminSectionBoot && state && state.ui && state.ui.locale === "he"){
    adminSectionBoot.setAttribute("dir", "rtl");
    adminSectionBoot.setAttribute("lang", "he");
  }
}

// See helpers.js's matching block for why this exists and why it's safe: a
// no-op in the browser (`module` is undefined there), unlocking direct
// `require()` from tests/unit/*.js in plain Node.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { t: t, SUPPORTED_LOCALES: SUPPORTED_LOCALES, LOCALES: LOCALES };
}
