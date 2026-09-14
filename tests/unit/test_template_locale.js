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

function resetState(activeTemplateName) {
  state.ui.locale = "en";
  state.config.activeTemplateName = activeTemplateName || SPOTIFY_TEMPLATE.name;
}

// Bilingual-dimensions redesign: a dimension's Hebrew translation is no
// longer a hardcoded, template-level shadow table consulted at render time
// by matching the dimension's CURRENT value against the template's own
// English default (fragile: an array field round-tripping through a
// session doc's JSON-shaped storage broke reference-equality matching, and
// editing a dimension in Admin could never show translated content without
// risking silently "locking in" that translation as the new stored value).
// It's now a plain, editable field living ON the dimension itself --
// dim.i18n.he.{label,green,red,statements,strategies} -- copied forward
// wherever the dimension itself travels (loadTemplate(), saveCurrentAsTemplate(),
// startSession()'s session snapshot), same as any other dimension field.
// localizedDimText() is now a pure, template-independent lookup: no
// activeStarterTemplate()/session-templateName distinction needed anymore,
// since the translation is never separated from the dimension that owns it.
test("localizedDimText() returns dim.i18n.he.<field> when Hebrew is active and it's set", () => {
  resetState();
  state.ui.locale = "he";
  const dim = { key: "x", label: "English", green: "g", red: "r", i18n: { he: { label: "עברית", green: "ג", red: "א" } } };
  assert.equal(localizedDimText(dim, "label"), "עברית");
  assert.equal(localizedDimText(dim, "green"), "ג");
  assert.equal(localizedDimText(dim, "red"), "א");
});

test("localizedDimText() falls back to the English value when Hebrew is active but no translation is set for that field", () => {
  resetState();
  state.ui.locale = "he";
  const dim = { key: "x", label: "English", green: "g", red: "r", i18n: { he: { label: "עברית" } } };
  assert.equal(localizedDimText(dim, "label"), "עברית");
  assert.equal(localizedDimText(dim, "green"), "g"); // untranslated field -- falls back
});

test("localizedDimText() falls back to English for a dimension with no i18n field at all", () => {
  resetState();
  state.ui.locale = "he";
  const dim = { key: "x", label: "English", green: "g", red: "r" };
  assert.equal(localizedDimText(dim, "label"), "English");
});

test("localizedDimText() falls back to English for a blank Hebrew translation, never shows an empty string", () => {
  resetState();
  state.ui.locale = "he";
  const dim = { key: "x", label: "English", i18n: { he: { label: "   " } } };
  assert.equal(localizedDimText(dim, "label"), "English");
});

test("localizedDimText() returns the English value unchanged when the active locale is English, regardless of any Hebrew translation present", () => {
  resetState();
  const dim = { key: "x", label: "English", i18n: { he: { label: "עברית" } } };
  assert.equal(localizedDimText(dim, "label"), "English");
});

test("localizedDimText() localizes array fields (statements/strategies) by returning the whole translated array", () => {
  resetState();
  state.ui.locale = "he";
  const dim = {
    key: "x", statements: ["one", "two"], strategies: ["s1"],
    i18n: { he: { statements: ["אחד", "שתיים"], strategies: ["אסטרטגיה"] } }
  };
  assert.deepEqual(localizedDimText(dim, "statements"), ["אחד", "שתיים"]);
  assert.deepEqual(localizedDimText(dim, "strategies"), ["אסטרטגיה"]);
});

test("localizedDimText() falls back to the English array when the Hebrew array is missing or empty", () => {
  resetState();
  state.ui.locale = "he";
  const noHe = { key: "x", statements: ["one", "two"] };
  assert.deepEqual(localizedDimText(noHe, "statements"), ["one", "two"]);
  const emptyHe = { key: "x", statements: ["one", "two"], i18n: { he: { statements: [] } } };
  assert.deepEqual(localizedDimText(emptyHe, "statements"), ["one", "two"]);
});

// The bilingual-dimensions editor (dimensions.js) lets an admin translate
// statements one at a time, so a real Hebrew array is very often PARTIALLY
// filled ("translated one", "", "") mid-edit -- falling back per WHOLE
// array (any non-empty Hebrew array wins outright) would show a blank
// line for every not-yet-translated statement instead of its English
// text. Must fall back per ELEMENT instead.
test("localizedDimText() falls back to the English value PER ELEMENT within a partially-translated array, not for the whole array at once", () => {
  resetState();
  state.ui.locale = "he";
  const dim = { key: "x", statements: ["one", "two", "three"], i18n: { he: { statements: ["אחד", "", "   "] } } };
  assert.deepEqual(localizedDimText(dim, "statements"), ["אחד", "two", "three"]);
});

test("localizedDimText() works identically for a plain live dimension, a retro session's frozen snapshot copy, or a starter template's own dimension entry -- it only ever looks at the dim object it's given", () => {
  resetState("Whatever the board's current template happens to be -- irrelevant now");
  state.ui.locale = "he";
  const sessionSnapshotCopy = Object.assign({}, TUCKMAN_TEMPLATE.dimensions.find((d) => d.key === "forming"));
  assert.equal(localizedDimText(sessionSnapshotCopy, "label"), TUCKMAN_TEMPLATE.dimensions.find((d) => d.key === "forming").i18n.he.label);
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

// localizedAttribution() is unchanged by this redesign -- attribution is
// board-level config, not per-dimension data, so it keeps the
// activeStarterTemplate()-matching mechanism Stories 6-9 already built.
test("localizedAttribution() works for ANY starter template that declares its own i18n table, not just Spotify", () => {
  const fakeTemplate = {
    id: "starter-test-fake", starter: true, name: "Totally Fake Test Template",
    unit: "Squad", unitPlural: "Squads", attribution: "Fake English attribution",
    dimensions: [{ key: "fakekey", label: "Fake Label", green: "Fake green", red: "Fake red", order: 1,
      i18n: { he: { label: "תווית מזויפת", green: "ירוק מזויף", red: "אדום מזויף" } } }],
    i18n: { he: { attribution: "תיוג מזויף" } }
  };
  STARTER_TEMPLATES.push(fakeTemplate);
  try {
    resetState(fakeTemplate.name);
    state.ui.locale = "he";
    assert.equal(localizedDimText(fakeTemplate.dimensions[0], "label"), "תווית מזויפת");
    assert.equal(localizedAttribution(fakeTemplate.attribution), "תיוג מזויף");
  } finally {
    STARTER_TEMPLATES.pop(); // never leak a fake template into any other test
  }
});

// Explicit per-story markers -- these are the actual "watch it fail" targets
// for Stories 7 and 8 (Tuckman/Five Dysfunctions dimension-content
// translation) before either template's own i18n data is written.
test("every TUCKMAN_TEMPLATE dimension has its own i18n.he entry (Story 7)", () => {
  TUCKMAN_TEMPLATE.dimensions.forEach((d) => assert.ok(d.i18n && d.i18n.he, "missing i18n.he for: " + d.key));
});
test("every FIVE_DYSFUNCTIONS_TEMPLATE dimension has its own i18n.he entry (Story 8)", () => {
  FIVE_DYSFUNCTIONS_TEMPLATE.dimensions.forEach((d) => assert.ok(d.i18n && d.i18n.he, "missing i18n.he for: " + d.key));
});

// Mechanical half of the DOD's "every locale carries every key" rule, applied
// to template DATA instead of UI-chrome t() strings -- run generically
// across every starter template so a new dimension added to any of them
// without its Hebrew counterpart fails loudly.
STARTER_TEMPLATES.forEach((tpl) => {
  test(`every ${tpl.name} dimension has a non-blank Hebrew translation`, () => {
    tpl.dimensions.forEach((d) => {
      const tr = d.i18n && d.i18n.he;
      assert.ok(tr, "missing i18n.he for dimension key: " + d.key + " in " + tpl.name);
      assert.ok(String(tr.label || "").trim(), "blank Hebrew label for: " + d.key);
      assert.ok(String(tr.green || "").trim(), "blank Hebrew green for: " + d.key);
      assert.ok(String(tr.red || "").trim(), "blank Hebrew red for: " + d.key);
      if (d.statements) {
        assert.ok(Array.isArray(tr.statements) && tr.statements.length === d.statements.length,
          "Hebrew statements array missing/wrong length for: " + d.key + " in " + tpl.name);
        tr.statements.forEach((s, i) => assert.ok(String(s || "").trim(), `blank Hebrew statement #${i} for: ` + d.key));
      }
      if (d.strategies) {
        assert.ok(Array.isArray(tr.strategies) && tr.strategies.length === d.strategies.length,
          "Hebrew strategies array missing/wrong length for: " + d.key + " in " + tpl.name);
        tr.strategies.forEach((s, i) => assert.ok(String(s || "").trim(), `blank Hebrew strategy #${i} for: ` + d.key));
      }
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
    assert.equal(localizedDimText(firstDim, "label"), firstDim.i18n.he.label);
    assert.equal(localizedAttribution(tpl.attribution), tpl.i18n.he.attribution);
  });
});
