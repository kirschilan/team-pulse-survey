"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
// board-sync.js's autoConnectFromLink() calls getQueryParam()/
// getFragmentParam() (bare globals, defined in state.js in a real browser --
// see STATUS.md on why these are plain classic scripts sharing one window
// scope) at the top level, on load. Stubbing them to "nothing in the URL"
// here reproduces the ordinary boot case without pulling in the whole of
// state.js.
global.getQueryParam = function(){ return null; };
global.getFragmentParam = function(){ return null; };
// Since step 7 (default-on team sync), ensureDefaultTeamSecret() ALSO runs
// at the top level on load and calls SquadPulseCrypto.generateSecret() --
// stub it rather than pull in the real crypto.js (which needs a real
// window.crypto.subtle this Node environment doesn't have).
global.SquadPulseCrypto = { generateSecret: function(){ return "stub-secret-for-unit-tests"; } };
const boardSync = require(path.join(__dirname, "..", "..", "public", "js", "board-sync.js"));

// SEC-4 (STATUS.md's "Security hardening backlog"): a team link's secret
// moved from the query string (?team=, sent to the server in the initial
// HTTP request -- can land in access logs, get echoed in a Referer header)
// to the URL fragment (#team=, never sent to any server at all). Old links
// already shared/bookmarked before this change must keep working, so
// parseTeamSecretInput() still accepts the legacy ?team= form too.
test("parseTeamSecretInput() extracts the secret from a pasted team link's fragment (current form)", () => {
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/#team=abcDEF123-_xyz"),
    "abcDEF123-_xyz"
  );
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?lang=he#team=thesecret"),
    "thesecret"
  );
});

test("parseTeamSecretInput() still extracts the secret from a legacy ?team= query link", () => {
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?team=abcDEF123-_xyz"),
    "abcDEF123-_xyz"
  );
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?other=1&team=thesecret&more=2"),
    "thesecret"
  );
});

test("parseTeamSecretInput() prefers the fragment over the query string when a link somehow carries both", () => {
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?team=oldQueryValue#team=newFragmentValue"),
    "newFragmentValue"
  );
});

test("parseTeamSecretInput() falls back to treating non-URL input as a bare secret", () => {
  assert.equal(boardSync.parseTeamSecretInput("  bareSecretValue  "), "bareSecretValue");
});

test("parseTeamSecretInput() returns empty for empty/missing input", () => {
  assert.equal(boardSync.parseTeamSecretInput(""), "");
  assert.equal(boardSync.parseTeamSecretInput(null), "");
  assert.equal(boardSync.parseTeamSecretInput(undefined), "");
});

test("teamLinkFor() builds a link carrying the secret in the URL FRAGMENT, not the query string", () => {
  var link = boardSync.teamLinkFor("mySecret123");
  assert.ok(link.indexOf("#team=mySecret123") !== -1, "expected #team=mySecret123 in " + link);
  assert.equal(link.indexOf("?team="), -1, "the secret must not also appear in the query string");
  // round-trips through parseTeamSecretInput() the same way a pasted link would
  assert.equal(boardSync.parseTeamSecretInput(link), "mySecret123");
});
