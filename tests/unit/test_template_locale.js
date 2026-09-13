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
  FIVE_DYSFUNCTIONS_TEMPLATE,
  TUCKMAN_TEMPLATE,
  STARTER_TEMPLATES,
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
function resetState(activeTemplateName) {
  state.ui.locale = "en";
  state.config.activeTemplateName = activeTemplateName || SPOTIFY_TEMPLATE.name;
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

test("localizedDimText() returns the stored value unchanged when the active template name matches nothing in STARTER_TEMPLATES", () => {
  resetState("A template that doesn't exist");
  state.ui.locale = "he";
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

// Stories 6-9's Tuckman/Five Dysfunctions template translations reuse this
// SAME mechanism (localizedDimText()/localizedAttribution() were originally
// hardcoded to SPOTIFY_TEMPLATE -- generalized to look up whichever starter
// template is currently active by name and use ITS OWN .i18n table, if it
// has one). Proven here with a throwaway synthetic template rather than
// real Spotify/Tuckman/Five Dysfunctions content, so this test doesn't care
// which real templates have translations yet.
test("localizedDimText()/localizedAttribution() work for ANY starter template that declares its own i18n table, not just Spotify", () => {
  const fakeTemplate = {
    id: "starter-test-fake", starter: true, name: "Totally Fake Test Template",
    unit: "Squad", unitPlural: "Squads", attribution: "Fake English attribution",
    dimensions: [{ key: "fakekey", label: "Fake Label", green: "Fake green", red: "Fake red", order: 1 }],
    i18n: { he: { attribution: "תיוג מזויף", dimensions: {
      fakekey: { label: "תווית מזויפת", green: "ירוק מזויף", red: "אדום מזויף" }
    } } }
  };
  STARTER_TEMPLATES.push(fakeTemplate);
  try {
    resetState(fakeTemplate.name);
    state.ui.locale = "he";
    assert.equal(localizedDimText(fakeTemplate.dimensions[0], "label"), "תווית מזויפת");
    assert.equal(localizedDimText(fakeTemplate.dimensions[0], "green"), "ירוק מזויף");
    assert.equal(localizedAttribution(fakeTemplate.attribution), "תיוג מזויף");
  } finally {
    STARTER_TEMPLATES.pop(); // never leak a fake template into any other test
  }
});

// Explicit per-story markers -- these are the actual "watch it fail" targets
// for Stories 7 and 8 (Tuckman/Five Dysfunctions dimension-content
// translation) before either template's own i18n data is written.
test("TUCKMAN_TEMPLATE has its own Hebrew translation table (Story 7)", () => {
  assert.ok(TUCKMAN_TEMPLATE.i18n && TUCKMAN_TEMPLATE.i18n.he, "TUCKMAN_TEMPLATE.i18n.he is missing");
});
test("FIVE_DYSFUNCTIONS_TEMPLATE has its own Hebrew translation table (Story 8)", () => {
  assert.ok(FIVE_DYSFUNCTIONS_TEMPLATE.i18n && FIVE_DYSFUNCTIONS_TEMPLATE.i18n.he, "FIVE_DYSFUNCTIONS_TEMPLATE.i18n.he is missing");
});

// Mechanical half of the DOD's "every locale carries every key" rule, applied
// to template DATA instead of UI-chrome t() strings -- run generically
// across every starter template that HAS declared an i18n table (today:
// Spotify; Tuckman/Five Dysfunctions join automatically the moment they
// declare their own .i18n, no test code changes needed here) so a new
// dimension added to any of them without its Hebrew counterpart fails loudly.
[SPOTIFY_TEMPLATE, FIVE_DYSFUNCTIONS_TEMPLATE, TUCKMAN_TEMPLATE].filter((tpl) => tpl.i18n).forEach((tpl) => {
  test(`every ${tpl.name} dimension has a non-blank Hebrew translation`, () => {
    const heTable = tpl.i18n.he.dimensions;
    tpl.dimensions.forEach((d) => {
      const tr = heTable[d.key];
      assert.ok(tr, "missing Hebrew translation for dimension key: " + d.key + " in " + tpl.name);
      assert.ok(String(tr.label || "").trim(), "blank Hebrew label for: " + d.key);
      assert.ok(String(tr.green || "").trim(), "blank Hebrew green for: " + d.key);
      assert.ok(String(tr.red || "").trim(), "blank Hebrew red for: " + d.key);
    });
  });

  test(`${tpl.name} carries a non-blank Hebrew attribution distinct from the English one`, () => {
    const heAttribution = tpl.i18n.he.attribution;
    assert.ok(String(heAttribution || "").trim());
    assert.notEqual(heAttribution, tpl.attribution);
  });

  test(`localizedDimText()/localizedAttribution() apply ${tpl.name}'s own translations when it's the active template`, () => {
    resetState(tpl.name);
    state.ui.locale = "he";
    const firstDim = tpl.dimensions[0];
    const tr = tpl.i18n.he.dimensions[firstDim.key];
    assert.equal(localizedDimText(firstDim, "label"), tr.label);
    assert.equal(localizedAttribution(tpl.attribution), tpl.i18n.he.attribution);
  });
});
