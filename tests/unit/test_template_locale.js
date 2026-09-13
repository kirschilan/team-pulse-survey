"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installFakeDom } = require("./fake_dom.js");

// state.js only touches window.location/localStorage at its own top level
// (no `document` calls, no cross-file global reads) -- fake_dom's window/
// localStorage stand-ins are enough to require() it directly here.
installFakeDom();

const { PLACEHOLDER_DIMENSIONS, SPOTIFY_TEMPLATE, localizedStarterDimensions } =
  require(path.join(__dirname, "..", "..", "public", "js", "state.js"));

function englishDim(key) {
  return PLACEHOLDER_DIMENSIONS.find((d) => d.key === key);
}

test("localizedStarterDimensions() substitutes label/green/red for every key present in the translation table", () => {
  const heTable = SPOTIFY_TEMPLATE.i18n.he.dimensions;
  const localized = localizedStarterDimensions(PLACEHOLDER_DIMENSIONS, heTable);
  localized.forEach((d) => {
    assert.notEqual(d.label, englishDim(d.key).label, "expected a translated label for " + d.key);
    assert.ok(d.green && d.red, "expected non-blank green/red for " + d.key);
  });
});

test("localizedStarterDimensions() falls back to the English field when a translation entry omits it", () => {
  const partial = { release: { label: "תווית בלבד" } }; // no green/red supplied
  const localized = localizedStarterDimensions(PLACEHOLDER_DIMENSIONS, partial);
  const release = localized.find((d) => d.key === "release");
  assert.equal(release.label, "תווית בלבד");
  assert.equal(release.green, englishDim("release").green);
  assert.equal(release.red, englishDim("release").red);
});

test("localizedStarterDimensions() leaves a dimension untouched when its key has no translation entry at all", () => {
  const localized = localizedStarterDimensions(PLACEHOLDER_DIMENSIONS, {});
  assert.deepEqual(localized, PLACEHOLDER_DIMENSIONS);
});

test("localizedStarterDimensions() returns the original dimensions when no translation table is given", () => {
  assert.equal(localizedStarterDimensions(PLACEHOLDER_DIMENSIONS, null), PLACEHOLDER_DIMENSIONS);
  assert.equal(localizedStarterDimensions(PLACEHOLDER_DIMENSIONS, undefined), PLACEHOLDER_DIMENSIONS);
});

// Mechanical half of the DOD's "every locale carries every key" rule, applied
// to template DATA instead of UI-chrome t() strings: every dimension the
// Spotify starter template actually ships must have a non-blank Hebrew
// label/green/red, so loading it under Hebrew never silently shows a mix of
// translated and English dimensions.
test("every SPOTIFY_TEMPLATE dimension has a non-blank Hebrew translation", () => {
  const heTable = SPOTIFY_TEMPLATE.i18n.he.dimensions;
  SPOTIFY_TEMPLATE.dimensions.forEach((d) => {
    const tr = heTable[d.key];
    assert.ok(tr, "missing Hebrew translation for dimension key: " + d.key);
    assert.ok(String(tr.label || "").trim(), "blank Hebrew label for: " + d.key);
    assert.ok(String(tr.green || "").trim(), "blank Hebrew green for: " + d.key);
    assert.ok(String(tr.red || "").trim(), "blank Hebrew red for: " + d.key);
  });
});

test("SPOTIFY_TEMPLATE carries a non-blank Hebrew attribution distinct from the English one", () => {
  const heAttribution = SPOTIFY_TEMPLATE.i18n.he.attribution;
  assert.ok(String(heAttribution || "").trim());
  assert.notEqual(heAttribution, SPOTIFY_TEMPLATE.attribution);
});
