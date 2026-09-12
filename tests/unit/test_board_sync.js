"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
const boardSync = require(path.join(__dirname, "..", "..", "public", "js", "board-sync.js"));

test("normalizeTeamCode() upper-cases, strips non-alphanumerics, and bounds length", () => {
  assert.equal(boardSync.normalizeTeamCode("my squad!"), "MYSQUAD");
  assert.equal(boardSync.normalizeTeamCode("  Tribe-42  "), "TRIBE42");
  assert.equal(boardSync.normalizeTeamCode(""), "");
  assert.equal(boardSync.normalizeTeamCode(null), "");
  assert.equal(boardSync.normalizeTeamCode("a".repeat(50)).length, 40, "bounded to the same 40-char cap the field enforces");
});
