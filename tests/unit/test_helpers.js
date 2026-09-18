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

test("colorWord() labels a color band, defaulting to 'Not yet scored'", () => {
  assert.equal(helpers.colorWord("good"), "Green");
  assert.equal(helpers.colorWord("warn"), "Yellow");
  assert.equal(helpers.colorWord("crit"), "Red");
  assert.equal(helpers.colorWord("unscored"), "Not yet scored");
  assert.equal(helpers.colorWord(undefined), "Not yet scored");
});

test("trendWord() has a standalone form and an inline-suffix form", () => {
  assert.equal(helpers.trendWord("up"), "Improving");
  assert.equal(helpers.trendWord("down"), "Declining");
  assert.equal(helpers.trendWord("flat"), "");
  assert.equal(helpers.trendWord("up", true), ", improving");
  assert.equal(helpers.trendWord("down", true), ", declining");
  assert.equal(helpers.trendWord("flat", true), "");
});

test("isStatementDimension() distinguishes scored dimensions from direct-rating ones", () => {
  assert.equal(helpers.isStatementDimension({ key: "trust", statements: ["a"] }), true);
  assert.equal(helpers.isStatementDimension({ key: "release" }), false);
  assert.equal(helpers.isStatementDimension({ key: "release", statements: [] }), false, "an empty array still isn't statement-based");
  assert.equal(helpers.isStatementDimension(null), false);
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

test("pacingSequence() interleaves statement dimensions round-robin, then appends direct-rating dimensions", () => {
  const dims = [
    { key: "trust", order: 1, statements: ["t1", "t2"] },
    { key: "comm", order: 2, statements: ["c1"] },
    { key: "release", order: 3 },
    { key: "morale", order: 4 },
  ];
  assert.deepEqual(helpers.pacingSequence(dims), [
    { kind: "stmt", dimKey: "trust", idx: 0 },
    { kind: "stmt", dimKey: "comm", idx: 0 },
    { kind: "stmt", dimKey: "trust", idx: 1 },
    { kind: "direct", dimKey: "release" },
    { kind: "direct", dimKey: "morale" },
  ]);
});

test("pacingSequence() returns an empty array for a template with no dimensions", () => {
  assert.deepEqual(helpers.pacingSequence([]), []);
});

test("pacingSequence() with only direct-rating dimensions skips the statement phase entirely", () => {
  const dims = [{ key: "release", order: 1 }, { key: "morale", order: 2 }];
  assert.deepEqual(helpers.pacingSequence(dims), [
    { kind: "direct", dimKey: "release" },
    { kind: "direct", dimKey: "morale" },
  ]);
});

test("liveOr() runs the live branch when connected, local branch otherwise", () => {
  global.state = { live: true, db: {} };
  assert.equal(helpers.liveOr(() => "live", () => "local"), "live");
  global.state = { live: false, db: {} };
  assert.equal(helpers.liveOr(() => "live", () => "local"), "local");
  global.state = { live: true, db: null };
  assert.equal(helpers.liveOr(() => "live", () => "local"), "local", "db missing counts as not connected even if live is true");
});

test("syncLiveIfConnected() fires the write only when connected, and reports a rejection via diag()", async () => {
  global.state = { live: false, db: {} };
  var calledWhileOffline = false;
  helpers.syncLiveIfConnected(() => { calledWhileOffline = true; return Promise.resolve(); }, "test write");
  assert.equal(calledWhileOffline, false, "no write attempted when not connected");

  global.state = { live: true, db: {} };
  var calledWhileOnline = false;
  helpers.syncLiveIfConnected(() => { calledWhileOnline = true; return Promise.resolve(); }, "test write");
  assert.equal(calledWhileOnline, true);

  helpers.syncLiveIfConnected(() => Promise.reject({ code: "unavailable" }), "test write");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(helpers.DIAG_LINES.some((l) => l.indexOf("test write failed: unavailable") !== -1));
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

// SEC-4 (STATUS.md's "Security hardening backlog"): a retro join/
// co-facilitate link's piggybacked team secret (see this file's own header
// comment on why one link now carries both) moved from a query param to
// the URL fragment, same as the standalone team link (board-sync.js) --
// never sent to a server at all, unlike a query param.
test("teamHashFor() builds a #team= fragment when a team secret is connected, empty otherwise", () => {
  global.getTeamSecret = () => "the-team-secret";
  assert.equal(helpers.teamHashFor(), "#team=the-team-secret");
  global.getTeamSecret = () => "";
  assert.equal(helpers.teamHashFor(), "", "no team connected -- omit the fragment entirely, don't force one on");
});

// Codex review on PR #14 (P1): joinUrlFor()/coFacilitateUrlFor() were still
// putting the SESSION's own secret in the query string (?session=/
// ?cofacilitate=) -- only the piggybacked team secret had moved to the
// fragment. A query param is sent in the initial HTTP navigation request
// (can land in the app host's own access logs, gets echoed in a Referer
// header on the next click) exactly the exposure SEC-4 set out to close --
// so both the session/co-facilitate secret AND the team secret now ride in
// the fragment together; only the non-secret `lang` stays in the query
// string, since it's not sensitive and IS meant to be visible/bookmarkable.
test("joinUrlFor()/coFacilitateUrlFor() put lang= in the query string, and session=/cofacilitate=+team= together in the fragment -- never a secret in the query string", () => {
  global.state = { ui: { locale: "he" } };
  global.getTeamSecret = () => "the-team-secret";
  const joinUrl = helpers.joinUrlFor("abc123");
  assert.equal(joinUrl, "http://localhost/?lang=he#session=abc123&team=the-team-secret");
  assert.ok(!joinUrl.includes("?session="), "the session secret must never appear in the query string");
  const cofacUrl = helpers.coFacilitateUrlFor("abc123");
  assert.equal(cofacUrl, "http://localhost/?lang=he#cofacilitate=abc123&team=the-team-secret");
  assert.ok(!cofacUrl.includes("?cofacilitate="), "the co-facilitate secret must never appear in the query string");

  // no team connected -- just the session secret in the fragment
  global.getTeamSecret = () => "";
  assert.equal(helpers.joinUrlFor("abc123"), "http://localhost/?lang=he#session=abc123");

  // English (default) locale -- no query string at all, just the fragment
  global.state = { ui: { locale: "en" } };
  assert.equal(helpers.joinUrlFor("abc123"), "http://localhost/#session=abc123");
});

test("buildFragment() joins non-empty pairs into one '#'-prefixed fragment, in order, omitting empty values and the '#' itself when nothing qualifies", () => {
  assert.equal(helpers.buildFragment([["session", "abc"], ["team", "xyz"]]), "#session=abc&team=xyz");
  assert.equal(helpers.buildFragment([["session", "abc"], ["team", ""]]), "#session=abc");
  assert.equal(helpers.buildFragment([["session", ""], ["team", ""]]), "");
  assert.equal(helpers.buildFragment([]), "");
});
