"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();

// Codex review on PR #14 (P1): a retro join/co-facilitate link's own secret
// used to be read only from the query string (getQueryParam("session")/
// getQueryParam("cofacilitate")) -- now that helpers.js's joinUrlFor()/
// coFacilitateUrlFor() put it in the URL FRAGMENT instead (same move SEC-4
// already made for the team secret), boot-time parsing has to check the
// fragment first, same precedence board-sync.js's parseTeamSecretInput()
// already uses for a pasted team link, falling back to the legacy query
// form so a link shared/bookmarked before this fix still works.
function freshState(hash, search){
  delete require.cache[require.resolve(path.join(__dirname, "..", "..", "public", "js", "state.js"))];
  global.window.location.hash = hash || "";
  global.window.location.search = search || "";
  return require(path.join(__dirname, "..", "..", "public", "js", "state.js"));
}

test("getFragmentParam() reads a name=value pair out of the URL fragment", () => {
  const state = freshState("#session=abc123&team=xyz");
  assert.equal(state.getFragmentParam("session"), "abc123");
  assert.equal(state.getFragmentParam("team"), "xyz");
  assert.equal(state.getFragmentParam("missing"), null);
});

test("getLinkParam() prefers the fragment over the query string", () => {
  const state = freshState("#session=fromHash", "?session=fromQuery");
  assert.equal(state.getLinkParam("session"), "fromHash");
});

test("getLinkParam() falls back to the legacy query string when the fragment has nothing", () => {
  const state = freshState("", "?session=fromQuery&cofacilitate=fromQuery2");
  assert.equal(state.getLinkParam("session"), "fromQuery");
  assert.equal(state.getLinkParam("cofacilitate"), "fromQuery2");
});

test("getLinkParam() returns null when neither the fragment nor the query string has the param", () => {
  const state = freshState("", "");
  assert.equal(state.getLinkParam("session"), null);
});

test("state.joinSessionId/coFacilitateSessionId are read via getLinkParam() at load time", () => {
  const stateA = freshState("#session=theSecret");
  assert.equal(stateA.state.joinSessionId, "theSecret");
  const stateB = freshState("", "?cofacilitate=legacySecret");
  assert.equal(stateB.state.coFacilitateSessionId, "legacySecret");
});
