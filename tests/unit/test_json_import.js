"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));
global.sortedDimensions = helpers.sortedDimensions;
global.sortedSquads = helpers.sortedSquads;
global.nowIso = function(){ return new Date().toISOString(); };

const csv = require(path.join(__dirname, "..", "..", "public", "js", "csv.js"));

function withBoard(board, fn) {
  global.state = Object.assign(
    { dimensions: [], squads: [], templates: [], config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Custom" } },
    board
  );
  fn();
}

// ---------- parseBoardImportFile() ----------

test("parseBoardImportFile() accepts a well-formed export", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.squads, []);
});

test("parseBoardImportFile() rejects text that isn't JSON at all", () => {
  const result = csv.parseBoardImportFile("not json { at all");
  assert.equal(result.ok, false);
  assert.equal(result.error, "not-json");
});

test("parseBoardImportFile() rejects a file with no squads array", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing-squads");
});

test("parseBoardImportFile() rejects a file with no formatVersion", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ squads: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing-version");
});

test("parseBoardImportFile() refuses a formatVersion newer than this app understands, rather than guessing", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 4, squads: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported-version");
  assert.equal(result.fileVersion, 4);
});

// ---------- buildSquadImportPlan() ----------

function fileWith(squads){ return { formatVersion: 1, squads: squads }; }

test("buildSquadImportPlan() matches an existing squad by name and reports its file ratings", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }]
  }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([
      { name: "Squad 1", dimensions: { release: { color: "good" } } }
    ]), "merge");
    assert.equal(plan.ratingCount, 1);
    assert.equal(plan.patches[0].existing.id, "sq-1");
    assert.deepEqual(plan.patches[0].fileDims, { release: { color: "good" } });
    assert.equal(plan.newSquadNames.length, 0);
  });
});

test("buildSquadImportPlan() flags a file squad name not on the board as new", () => {
  withBoard({ dimensions: [], squads: [] }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([{ name: "Squad 9", dimensions: {} }]), "merge");
    assert.deepEqual(plan.newSquadNames, ["Squad 9"]);
    assert.equal(plan.patches[0].existing, null);
  });
});

test("buildSquadImportPlan() skips a rating for a dimension key not on the current board, without guessing", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }], squads: [] }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([
      { name: "Squad 1", dimensions: { "not-a-real-dim": { color: "good" } } }
    ]), "merge");
    assert.equal(plan.ratingCount, 0);
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].dimension, "not-a-real-dim");
    assert.equal(plan.skipped[0].squad, "Squad 1");
  });
});

test("buildSquadImportPlan() in MERGE mode never marks a board squad absent from the file for removal", () => {
  withBoard({
    dimensions: [],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }, { id: "sq-2", name: "Squad 2", dimensions: {} }]
  }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([{ name: "Squad 1", dimensions: {} }]), "merge");
    assert.deepEqual(plan.squadsToRemove, []);
  });
});

test("buildSquadImportPlan() in REPLACE mode marks a board squad absent from the file for removal", () => {
  withBoard({
    dimensions: [],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }, { id: "sq-2", name: "Squad 2", dimensions: {} }]
  }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([{ name: "Squad 1", dimensions: {} }]), "replace");
    assert.equal(plan.squadsToRemove.length, 1);
    assert.equal(plan.squadsToRemove[0].id, "sq-2");
  });
});

test("buildSquadImportPlan() in REPLACE mode reports a matched squad's own ratings that the file doesn't mention", () => {
  withBoard({
    dimensions: [
      { key: "release", label: "Easy to release", order: 1 },
      { key: "speed", label: "Speed", order: 2 }
    ],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: { release: { color: "good" }, speed: { color: "warn" } } }]
  }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([
      { name: "Squad 1", dimensions: { release: { color: "crit" } } }
    ]), "replace");
    assert.equal(plan.clearedRatings.length, 1);
    assert.equal(plan.clearedRatings[0].squad, "Squad 1");
    assert.equal(plan.clearedRatings[0].dimension, "Speed");
  });
});

test("buildSquadImportPlan() in MERGE mode reports no cleared ratings even when the file omits some", () => {
  withBoard({
    dimensions: [
      { key: "release", label: "Easy to release", order: 1 },
      { key: "speed", label: "Speed", order: 2 }
    ],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: { release: { color: "good" }, speed: { color: "warn" } } }]
  }, () => {
    const plan = csv.buildSquadImportPlan(fileWith([
      { name: "Squad 1", dimensions: { release: { color: "crit" } } }
    ]), "merge");
    assert.deepEqual(plan.clearedRatings, []);
  });
});

// ---------- applySquadImportPlan()'s pure per-squad merge math ----------
// applySquadImportPlan() itself also performs state.db/live writes (Playwright-
// covered, see test_json_import.py); mergeSquadDimensions() is the pure part of
// its logic and is fully unit-testable on its own.

test("mergeSquadDimensions() in MERGE mode keeps a squad's existing ratings the file doesn't mention", () => {
  const result = csv.mergeSquadDimensions(
    { release: { color: "good" }, speed: { color: "warn" } },
    { release: { color: "crit" } },
    "merge"
  );
  assert.deepEqual(result, { release: { color: "crit" }, speed: { color: "warn" } });
});

test("mergeSquadDimensions() in REPLACE mode drops a squad's existing ratings the file doesn't mention", () => {
  const result = csv.mergeSquadDimensions(
    { release: { color: "good" }, speed: { color: "warn" } },
    { release: { color: "crit" } },
    "replace"
  );
  assert.deepEqual(result, { release: { color: "crit" } });
});
