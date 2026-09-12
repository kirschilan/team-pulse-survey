"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));

test("esc() escapes the five HTML-sensitive characters", () => {
  assert.equal(helpers.esc('<b>"x" & \'y\'</b>'), "&lt;b&gt;&quot;x&quot; &amp; 'y'&lt;/b&gt;");
  assert.equal(helpers.esc(null), "");
  assert.equal(helpers.esc(undefined), "");
});

test("slugify() lowercases, hyphenates, and trims to a URL-safe id", () => {
  assert.equal(helpers.slugify("Five Dysfunctions of a Team!"), "five-dysfunctions-of-a-team");
  assert.equal(helpers.slugify("  --Weird__Spacing--  "), "weird-spacing");
  assert.equal(helpers.slugify("", "fallback-id"), "fallback-id");
  assert.equal(helpers.slugify("!!!", "fallback-id"), "fallback-id", "an all-symbol string strips to nothing, same as empty");
});

test("weight() maps color bands to the health-score scale", () => {
  assert.equal(helpers.weight("crit"), 2);
  assert.equal(helpers.weight("warn"), 1);
  assert.equal(helpers.weight("good"), 0);
  assert.equal(helpers.weight("unscored"), 0);
});

test("bandForScore() maps a Likert-sum onto good/warn/crit using the dimension's own bands", () => {
  const bands = { good: 8, warn: 6 };
  assert.equal(helpers.bandForScore(9, bands), "good");
  assert.equal(helpers.bandForScore(8, bands), "good", "the boundary itself counts as the higher band");
  assert.equal(helpers.bandForScore(7, bands), "warn");
  assert.equal(helpers.bandForScore(6, bands), "warn");
  assert.equal(helpers.bandForScore(5, bands), "crit");
});

test("bandForScore() falls back to the 5DF 8/6 thresholds when a dimension has no scoreBands", () => {
  assert.equal(helpers.bandForScore(8, undefined), "good");
  assert.equal(helpers.bandForScore(6, null), "warn");
  assert.equal(helpers.bandForScore(3, undefined), "crit");
});

test("consolidateBand() picks the majority band", () => {
  assert.equal(helpers.consolidateBand(["good", "good", "crit"]), "good");
  assert.equal(helpers.consolidateBand(["crit", "crit", "warn"]), "crit");
});

test("consolidateBand() breaks a tie toward the CALMER (less severe) bucket -- locked decision", () => {
  assert.equal(helpers.consolidateBand(["good", "crit"]), "good");
  assert.equal(helpers.consolidateBand(["warn", "crit"]), "warn");
  assert.equal(helpers.consolidateBand(["good", "warn", "crit"]), "good", "a genuine 3-way tie still favors the calmest");
});

test("consolidateBand() returns null for no responses, ignores unrecognized bands", () => {
  assert.equal(helpers.consolidateBand([]), null);
  assert.equal(helpers.consolidateBand(null), null);
});

test("bandForResponse() scores a statement-based dimension by summing answers through its bands", () => {
  const dim = { key: "trust", statements: ["s1", "s2", "s3"], scoreBands: { good: 8, warn: 6 } };
  assert.equal(helpers.bandForResponse(dim, { answers: { trust: [3, 3, 3] } }), "good");
  assert.equal(helpers.bandForResponse(dim, { answers: { trust: [1, 1, 1] } }), "crit");
});

test("bandForResponse() reads a direct-rating dimension's answer as the band itself, unsummed", () => {
  const dim = { key: "release", label: "Easy to release" }; // no `statements` -- Spotify-style
  assert.equal(helpers.bandForResponse(dim, { answers: { release: "good" } }), "good");
  assert.equal(helpers.bandForResponse(dim, { answers: { release: "crit" } }), "crit");
});

test("bandForResponse() returns null when this response never covered the dimension", () => {
  const dim = { key: "trust", statements: ["s1"] };
  assert.equal(helpers.bandForResponse(dim, { answers: {} }), null);
  assert.equal(helpers.bandForResponse(dim, {}), null);
  assert.equal(helpers.bandForResponse({ key: "release" }, { answers: { release: "not-a-color" } }), null);
});

test("effectiveDimResult() prefers a facilitator override over any consolidation", () => {
  const dim = { key: "trust" };
  const sess = { overrides: { trust: { color: "warn", trend: "down" } } };
  const result = helpers.effectiveDimResult(dim, sess, [{ answers: { trust: "good" } }]);
  assert.deepEqual(result, { color: "warn", trend: "down", overridden: true });
});

test("effectiveDimResult() falls back to live consolidation with no override", () => {
  const dim = { key: "release" };
  const sess = { overrides: {} };
  const responses = [{ answers: { release: "good" } }, { answers: { release: "good" } }, { answers: { release: "crit" } }];
  const result = helpers.effectiveDimResult(dim, sess, responses);
  assert.deepEqual(result, { color: "good", trend: "flat", overridden: false });
});

test("effectiveDimResult() returns null with no override and no responses yet -- 'not scored', not a fake band", () => {
  assert.equal(helpers.effectiveDimResult({ key: "trust" }, { overrides: {} }, []), null);
});

test("retroDimensions/statementDimensions/directRatingDimensions split a session's dimensions by shape", () => {
  const dims = [
    { key: "trust", order: 2, statements: ["a", "b"] },
    { key: "release", order: 1 },
  ];
  assert.deepEqual(helpers.retroDimensions(dims).map((d) => d.key), ["release", "trust"], "sorted by order");
  assert.deepEqual(helpers.statementDimensions(dims).map((d) => d.key), ["trust"]);
  assert.deepEqual(helpers.directRatingDimensions(dims).map((d) => d.key), ["release"]);
});

test("sortedDimensions/sortedSquads/dimByKey/findSquad/squadScore read from global state", () => {
  global.state = {
    dimensions: [
      { key: "b", order: 2 },
      { key: "a", order: 1 },
    ],
    squads: [
      { id: "sq-2", order: 2 },
      { id: "sq-1", order: 1, dimensions: { a: { color: "good" }, b: { color: "crit" } } },
    ],
  };
  assert.deepEqual(helpers.sortedDimensions().map((d) => d.key), ["a", "b"]);
  assert.deepEqual(helpers.sortedSquads().map((s) => s.id), ["sq-1", "sq-2"]);
  assert.equal(helpers.dimByKey("a").order, 1);
  assert.equal(helpers.dimByKey("missing"), null);
  assert.equal(helpers.findSquad("sq-2").order, 2);
  assert.equal(helpers.findSquad("missing"), null);

  const score = helpers.squadScore(helpers.findSquad("sq-1"));
  assert.equal(score.score, 2, "good=0 + crit=2");
  assert.equal(score.scored, 2);
  assert.equal(score.total, 2);
  assert.deepEqual(score.counts, { good: 1, warn: 0, crit: 1, unscored: 0 });
});
