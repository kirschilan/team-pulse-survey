"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { installFakeDom } = require("./fake_dom.js");

// state.js only touches window.location/localStorage at its own top level
// (no `document` calls, no cross-file global reads) -- fake_dom's window/
// localStorage stand-ins are enough to require() it directly here.
installFakeDom();

const {
  PLACEHOLDER_DIMENSIONS,
  SPOTIFY_TEMPLATE,
  SPOTIFY_ATTRIBUTION,
  localizedDimText,
  localizedAttribution,
  state,
} = require(path.join(__dirname, "..", "..", "public", "js", "state.js"));

function englishDim(key) {
  return PLACEHOLDER_DIMENSIONS.find((d) => d.key === key);
}

// Reset the shared `state` object's relevant fields before/after each test --
// same "mutate properties in place, never reassign the binding" rule the
// rest of this app's cross-file globals follow (see state.js's own header
// comment), since these two functions read `state.ui.locale` and
// `state.config.activeTemplateName` as bare globals exactly like any other
// public/js/*.js render code would in a real page.
function resetState() {
  state.ui.locale = "en";
  state.config.activeTemplateName = SPOTIFY_TEMPLATE.name;
}

test("localizedDimText() returns the Hebrew value when Hebrew is active, the Spotify template is active, and the field is still the untouched English default", () => {
  resetState();
  state.ui.locale = "he";
  const release = englishDim("release");
  assert.equal(localizedDimText(release, "label"), SPOTIFY_TEMPLATE.i18n.he.dimensions.release.label);
  assert.equal(localizedDimText(release, "green"), SPOTIFY_TEMPLATE.i18n.he.dimensions.release.green);
  assert.equal(localizedDimText(release, "red"), SPOTIFY_TEMPLATE.i18n.he.dimensions.release.red);
});

test("localizedDimText() returns the stored value unchanged when the active locale is English", () => {
  resetState();
  const release = englishDim("release");
  assert.equal(localizedDimText(release, "label"), release.label);
});

test("localizedDimText() returns the stored value unchanged when the active template isn't the Spotify template", () => {
  resetState();
  state.ui.locale = "he";
  state.config.activeTemplateName = "The Five Dysfunctions of a Team";
  const release = englishDim("release");
  assert.equal(localizedDimText(release, "label"), release.label);
});

test("localizedDimText() never overrides a dimension an admin has manually customized away from the English default", () => {
  resetState();
  state.ui.locale = "he";
  const customized = Object.assign({}, englishDim("release"), { label: "Ship it fast" });
  assert.equal(localizedDimText(customized, "label"), "Ship it fast");
  // green/red weren't touched -- those individual fields should still localize
  assert.equal(localizedDimText(customized, "green"), SPOTIFY_TEMPLATE.i18n.he.dimensions.release.green);
});

test("localizedDimText() falls back to the stored value for a dimension key with no Hebrew translation entry", () => {
  resetState();
  state.ui.locale = "he";
  const untranslated = { key: "not-a-real-spotify-key", label: "Something else", green: "g", red: "r" };
  assert.equal(localizedDimText(untranslated, "label"), "Something else");
});

test("localizedAttribution() returns the Hebrew attribution under the same conditions", () => {
  resetState();
  state.ui.locale = "he";
  assert.equal(localizedAttribution(SPOTIFY_ATTRIBUTION), SPOTIFY_TEMPLATE.i18n.he.attribution);
});

test("localizedAttribution() leaves a customized/blank attribution alone", () => {
  resetState();
  state.ui.locale = "he";
  assert.equal(localizedAttribution("A board admin wrote this"), "A board admin wrote this");
  assert.equal(localizedAttribution(""), "");
});

test("localizedAttribution() returns the value unchanged in English", () => {
  resetState();
  assert.equal(localizedAttribution(SPOTIFY_ATTRIBUTION), SPOTIFY_ATTRIBUTION);
});

// Mechanical half of the DOD's "every locale carries every key" rule, applied
// to template DATA instead of UI-chrome t() strings: every dimension the
// Spotify starter template actually ships must have a non-blank Hebrew
// label/green/red, so switching to Hebrew never silently shows a mix of
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
  assert.notEqual(heAttribution, SPOTIFY_ATTRIBUTION);
});
