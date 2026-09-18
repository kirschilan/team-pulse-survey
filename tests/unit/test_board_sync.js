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

// ---------- boardContentSignature() ----------
// PERF-1 (STATUS.md's "Runtime performance backlog"): pushBoardSnapshotIfConnected()
// used to push unconditionally on every call, always stamping a fresh
// nowIso() updatedAt -- so a no-op call (nothing about the board actually
// changed) still produced a "newer" remote snapshot, which every live
// subscriber (including tabs sharing this device's own localStorage) then
// re-applied, re-triggering the exact listeners that call
// pushBoardSnapshotIfConnected() again, forever. boardContentSignature()
// is the pure piece that makes deduping possible: a string that only
// changes when the board's MEANINGFUL content (squads/dimensions/config)
// does, deliberately excluding boardSnapshotPayload()'s own updatedAt
// field, which always differs by construction and would defeat the whole
// point of comparing two payloads for sameness.

test("boardContentSignature() is identical for two payloads that differ only in updatedAt", () => {
  var a = { squads: [{ name: "Squad 1", order: 1, dimensions: {} }], dimensions: [], config: { unit: "Squad" }, updatedAt: "2026-01-01T00:00:00.000Z" };
  var b = Object.assign({}, a, { updatedAt: "2026-01-02T00:00:00.000Z" });
  assert.equal(boardSync.boardContentSignature(a), boardSync.boardContentSignature(b));
});

test("boardContentSignature() differs when a squad's rating genuinely changes", () => {
  var a = { squads: [{ name: "Squad 1", order: 1, dimensions: { release: { color: "good" } } }], dimensions: [], config: {}, updatedAt: "t1" };
  var b = { squads: [{ name: "Squad 1", order: 1, dimensions: { release: { color: "crit" } } }], dimensions: [], config: {}, updatedAt: "t1" };
  assert.notEqual(boardSync.boardContentSignature(a), boardSync.boardContentSignature(b));
});

test("boardContentSignature() differs when a dimension or config field genuinely changes", () => {
  var base = { squads: [], dimensions: [{ key: "release", label: "Easy to release" }], config: { unit: "Squad" }, updatedAt: "t1" };
  var dimChanged = Object.assign({}, base, { dimensions: [{ key: "release", label: "Renamed" }] });
  var cfgChanged = Object.assign({}, base, { config: { unit: "Team" } });
  assert.notEqual(boardSync.boardContentSignature(base), boardSync.boardContentSignature(dimChanged));
  assert.notEqual(boardSync.boardContentSignature(base), boardSync.boardContentSignature(cfgChanged));
});
