"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// i18n.js reads `state.ui.locale` as a bare global, same as every other
// public/js/*.js file sharing one window scope in a real browser (see
// STATUS.md) -- set it directly here rather than loading the real state.js,
// since these tests only care about t()'s own lookup/fallback/interpolation
// logic, not app boot.
global.state = { ui: { locale: "en" } };

const { LOCALE_EN } = require(path.join(__dirname, "..", "..", "public", "js", "locales", "en.js"));
const { LOCALE_HE } = require(path.join(__dirname, "..", "..", "public", "js", "locales", "he.js"));
global.LOCALE_EN = LOCALE_EN;
global.LOCALE_HE = LOCALE_HE;
const { t } = require(path.join(__dirname, "..", "..", "public", "js", "i18n.js"));

test("t() returns the active locale's string for a known key", () => {
  global.state.ui.locale = "he";
  assert.equal(t("admin.squads.heading"), LOCALE_HE["admin.squads.heading"]);
  global.state.ui.locale = "en";
});

test("t() falls back to English when the key is missing from the active locale", () => {
  global.state.ui.locale = "he";
  const key = "admin.__missing_for_test__";
  LOCALE_EN[key] = "English-only fallback text"; // present in English, deliberately absent from Hebrew
  assert.equal(t(key), "English-only fallback text");
  delete LOCALE_EN[key];
  global.state.ui.locale = "en";
});

test("t() surfaces the raw key when it exists in no locale at all (never a blank)", () => {
  assert.equal(t("admin.totally.unknown.key"), "admin.totally.unknown.key");
});

test("t() interpolates {word} tokens from the vars argument, wrapped in bidi isolate marks", () => {
  // U+2066 LRI / U+2069 PDI wrap every substituted value -- see i18n.js's
  // own comment: without this, an untranslated word (or a name/number of
  // unknown script) embedded in a translated sentence can visually reorder
  // relative to the surrounding text once that sentence's language flips
  // the paragraph to rtl, even though .textContent itself is unaffected.
  const LRI = "⁦", PDI = "⁩";
  assert.equal(t("admin.squads.addButton", { unit: "Team" }), `+ Add ${LRI}Team${PDI}`);
  global.state.ui.locale = "he";
  assert.equal(
    t("admin.squads.addButton", { unit: "Team" }),
    LOCALE_HE["admin.squads.addButton"].replace("{unit}", LRI + "Team" + PDI)
  );
  global.state.ui.locale = "en";
});

test("t() defaults to English when state.ui.locale is unset", () => {
  const saved = global.state;
  global.state = { ui: {} };
  assert.equal(t("admin.squads.heading"), LOCALE_EN["admin.squads.heading"]);
  global.state = saved;
});

// This is the mechanical half of the product owner's DOD ("every future
// change supports every supported language"): every key in the English
// source-of-truth table must also exist in Hebrew, and vice versa (a Hebrew
// key with no English counterpart is dead weight nothing will ever look up
// in the language that matters for a human reviewer scanning en.js).
test("every LOCALE_EN key has a LOCALE_HE counterpart, and vice versa (translation-parity DOD check)", () => {
  const enKeys = Object.keys(LOCALE_EN).sort();
  const heKeys = Object.keys(LOCALE_HE).sort();
  const missingFromHe = enKeys.filter((k) => !heKeys.includes(k));
  const missingFromEn = heKeys.filter((k) => !enKeys.includes(k));
  assert.deepEqual(missingFromHe, [], "keys present in en.js but missing from he.js: " + missingFromHe.join(", "));
  assert.deepEqual(missingFromEn, [], "keys present in he.js but missing from en.js: " + missingFromEn.join(", "));
});

test("no LOCALE_HE value is empty/blank (an empty translation is worse than none -- it hides the English fallback)", () => {
  const blank = Object.keys(LOCALE_HE).filter((k) => !String(LOCALE_HE[k] || "").trim());
  assert.deepEqual(blank, [], "blank Hebrew translations for: " + blank.join(", "));
});
