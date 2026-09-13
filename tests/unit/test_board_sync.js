"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
// board-sync.js's autoConnectFromLink() calls getQueryParam() (a bare
// global, defined in state.js in a real browser -- see STATUS.md on why
// these are plain classic scripts sharing one window scope) at the top
// level, on load. Stubbing it to "no ?team= param" here reproduces the
// ordinary boot case without pulling in the whole of state.js.
global.getQueryParam = function(){ return null; };
// Since step 7 (default-on team sync), ensureDefaultTeamSecret() ALSO runs
// at the top level on load and calls SquadPulseCrypto.generateSecret() --
// stub it rather than pull in the real crypto.js (which needs a real
// window.crypto.subtle this Node environment doesn't have).
global.SquadPulseCrypto = { generateSecret: function(){ return "stub-secret-for-unit-tests"; } };
const boardSync = require(path.join(__dirname, "..", "..", "public", "js", "board-sync.js"));

test("parseTeamSecretInput() extracts the secret from a pasted team link", () => {
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?team=abcDEF123-_xyz"),
    "abcDEF123-_xyz"
  );
  assert.equal(
    boardSync.parseTeamSecretInput("https://example.com/app/?other=1&team=thesecret&more=2"),
    "thesecret"
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

test("teamLinkFor() builds a link carrying the secret as a ?team= param", () => {
  var link = boardSync.teamLinkFor("mySecret123");
  assert.ok(link.indexOf("?team=mySecret123") !== -1 || link.indexOf("team=mySecret123") !== -1);
  // round-trips through parseTeamSecretInput() the same way a pasted link would
  assert.equal(boardSync.parseTeamSecretInput(link), "mySecret123");
});
