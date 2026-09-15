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

// Review finding (PR #7): buildSquadImportPlan() ran directly inside
// FileReader.onload with no try/catch, so a structurally-malformed squads
// array (a null entry, a non-string name, a non-object dimensions value)
// threw an uncaught exception instead of showing the intended malformed-file
// error UI. Fixed by validating each entry's shape at the parse boundary,
// before buildSquadImportPlan() ever sees it -- consistent with this
// function already being the one place that decides ok:true/false.

test("parseBoardImportFile() rejects a null entry in the squads array", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [null] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() rejects a squad entry whose name isn't a string", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: 5, dimensions: {} }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() rejects a squad entry whose dimensions isn't a plain object", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: ["not", "an", "object"] }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() still accepts a squad entry with no dimensions field at all", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1" }] }));
  assert.equal(result.ok, true);
});

// Second review finding on the same PR: parseBoardImportFile() validated the
// squad/dimensions CONTAINERS but not individual rating objects or their
// field types -- a rating like {color:"good", note:123} passed straight
// through buildSquadImportPlan() and applySquadImportPlan() into the
// persisted store, then crashed rendering: render.js's/squads.js's
// `cell.note && cell.note.trim()` assumes note is always a string. Worse
// than just a crash: `color`/`trend` are interpolated UNESCAPED into a CSS
// class attribute in both render.js and squads.js (`'cell-btn '+color+'"'`)
// -- always safe before because every existing writer (the rating-modal UI,
// CSV's colorFromWord()) only ever produces one of a fixed enum, but a JSON
// import copied whatever string was in the file, opening real attribute-
// injection room for a color/trend value with a `"` in it. Fixing this by
// restricting color/trend to the app's actual enum (not just "must be a
// string") closes both problems with the same check.

test("parseBoardImportFile() rejects a rating value that isn't a plain object", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: "good" } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose note isn't a string", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "good", note: 123 } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose color isn't one of the app's known colors", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "not-a-real-color" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose trend isn't one of the app's known trends", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { trend: "sideways" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() accepts a well-formed rating with every known-good field", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "good", trend: "up", note: "great work" } } }] }));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() accepts a rating with no fields at all (an empty object)", () => {
  const result = csv.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: {} } }] }));
  assert.equal(result.ok, true);
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

// Review finding (PR #7): the Apply button's disabled condition checked
// ratingCount/newSquadNames/squadsToRemove but not clearedRatings, so a
// REPLACE-mode plan that only clears existing ratings (every squad already
// on the board, just with fewer/no ratings in the file) left Apply
// permanently disabled -- there was no way to actually apply that plan.
// Extracted into its own pure function, both to fix it and so this exact
// case has a real regression test that doesn't depend on rendered HTML.

test("planHasChanges() is true when a REPLACE plan only clears existing ratings", () => {
  const plan = { ratingCount: 0, newSquadNames: [], squadsToRemove: [], clearedRatings: [{ squad: "Squad 1", dimension: "Speed" }] };
  assert.equal(csv.planHasChanges(plan), true);
});

test("planHasChanges() is false when a plan truly changes nothing", () => {
  const plan = { ratingCount: 0, newSquadNames: [], squadsToRemove: [], clearedRatings: [] };
  assert.equal(csv.planHasChanges(plan), false);
});

test("mergeSquadDimensions() in REPLACE mode drops a squad's existing ratings the file doesn't mention", () => {
  const result = csv.mergeSquadDimensions(
    { release: { color: "good" }, speed: { color: "warn" } },
    { release: { color: "crit" } },
    "replace"
  );
  assert.deepEqual(result, { release: { color: "crit" } });
});
