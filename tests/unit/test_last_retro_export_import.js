"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));
global.sortedDimensions = helpers.sortedDimensions;
global.sortedSquads = helpers.sortedSquads;
global.nowIso = function(){ return new Date().toISOString(); };

// REF-4 (STATUS.md's "Code quality & refactoring backlog"): buildBoardExport()
// lives in board-export.js, parseBoardImportFile() in
// board-import-validate.js, buildSquadImportPlan()/planHasChanges() in
// board-import-plan.js -- all split out of the former
// board-export-import.js. None of the three functions this file actually
// calls need any cross-file global beyond sortedDimensions/sortedSquads/
// nowIso/state, already wired above.
const boardExport = require(path.join(__dirname, "..", "..", "public", "js", "board-export.js"));
const boardImportValidate = require(path.join(__dirname, "..", "..", "public", "js", "board-import-validate.js"));
const boardImportPlan = require(path.join(__dirname, "..", "..", "public", "js", "board-import-plan.js"));
const boardIO = Object.assign({}, boardExport, boardImportValidate, boardImportPlan);

// RETRO-1 (STATUS.md's "Facilitated retro backlog"): carry the latest
// finished retro's per-dimension result (consolidated or overridden),
// sprint experiment note, and finish timestamp through the JSON board
// export/import format -- previously only the resulting squad ratings
// were exported; the retro-specific context (which dims were overridden,
// the sprint note, when it finished) was never portable at all.

function withBoard(board, fn) {
  global.state = Object.assign(
    { dimensions: [], squads: [], templates: [], config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Custom" } },
    board
  );
  fn();
}

// ---------- buildBoardExport() carries a squad's lastRetro ----------

test("buildBoardExport() includes a squad's lastRetro snapshot when present", () => {
  withBoard({
    squads: [{
      id: "s1", name: "Squad 1", order: 1, dimensions: { release: { color: "good" } },
      lastRetro: { finishedAt: "2026-09-17T10:00:00.000Z", experimentNote: "Try pairing more", dimensions: { release: { color: "good", trend: "flat", overridden: false } } }
    }]
  }, () => {
    const out = boardIO.buildBoardExport();
    assert.deepEqual(out.squads[0].lastRetro, {
      finishedAt: "2026-09-17T10:00:00.000Z", experimentNote: "Try pairing more",
      dimensions: { release: { color: "good", trend: "flat", overridden: false } }
    });
  });
});

test("buildBoardExport() omits lastRetro entirely for a squad that never finished a retro", () => {
  withBoard({ squads: [{ id: "s1", name: "Squad 1", order: 1, dimensions: {} }] }, () => {
    const out = boardIO.buildBoardExport();
    assert.equal("lastRetro" in out.squads[0], false);
  });
});

// ---------- parseBoardImportFile() validates lastRetro's shape ----------

test("parseBoardImportFile() accepts a squad with a well-formed lastRetro", () => {
  const file = {
    formatVersion: 1,
    squads: [{ name: "Squad 1", lastRetro: {
      finishedAt: "2026-09-17T10:00:00.000Z", experimentNote: "note",
      dimensions: { release: { color: "good", trend: "up", overridden: true } }
    } }]
  };
  const result = boardIO.parseBoardImportFile(JSON.stringify(file));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() rejects a lastRetro with an invalid color enum", () => {
  const file = { formatVersion: 1, squads: [{ name: "Squad 1", lastRetro: { dimensions: { release: { color: "purple" } } } }] };
  const result = boardIO.parseBoardImportFile(JSON.stringify(file));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-last-retro");
});

test("parseBoardImportFile() rejects a non-string experimentNote", () => {
  const file = { formatVersion: 1, squads: [{ name: "Squad 1", lastRetro: { experimentNote: 123 } }] };
  const result = boardIO.parseBoardImportFile(JSON.stringify(file));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-last-retro");
});

test("parseBoardImportFile() accepts a squad with no lastRetro at all (most files)", () => {
  const file = { formatVersion: 1, squads: [{ name: "Squad 1" }] };
  const result = boardIO.parseBoardImportFile(JSON.stringify(file));
  assert.equal(result.ok, true);
});

// ---------- buildSquadImportPlan() resolves lastRetro's dimensions the
// same way a rating's dimensions already resolve, and reports (not
// silently drops) one that no longer matches the target board ----------

test("buildSquadImportPlan() carries a matched squad's lastRetro through with its dimension key resolved", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "s1", name: "Squad 1", order: 1, dimensions: {} }]
  }, () => {
    const file = {
      squads: [{ name: "Squad 1", lastRetro: {
        finishedAt: "2026-09-17T10:00:00.000Z", experimentNote: "note",
        dimensions: { release: { color: "good", trend: "flat", overridden: false } }
      } }]
    };
    const plan = boardIO.buildSquadImportPlan(file, "merge");
    assert.equal(plan.patches[0].fileLastRetro.experimentNote, "note");
    assert.deepEqual(plan.patches[0].fileLastRetro.dimensions, { release: { color: "good", trend: "flat", overridden: false } });
    assert.equal(plan.lastRetroSquadCount, 1);
  });
});

test("buildSquadImportPlan() reports (not silently drops) a lastRetro dimension no longer on the board", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "s1", name: "Squad 1", order: 1, dimensions: {} }]
  }, () => {
    const file = {
      squads: [{ name: "Squad 1", lastRetro: {
        finishedAt: "2026-09-17T10:00:00.000Z",
        dimensions: { "removed-dim": { color: "good" } }
      } }]
    };
    const plan = boardIO.buildSquadImportPlan(file, "merge");
    assert.deepEqual(plan.patches[0].fileLastRetro.dimensions, {});
    assert.equal(plan.skipped.some(s => s.squad === "Squad 1" && s.dimension === "removed-dim"), true);
  });
});

test("buildSquadImportPlan() leaves fileLastRetro undefined for a squad the file says nothing about", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "s1", name: "Squad 1", order: 1, dimensions: {} }]
  }, () => {
    const file = { squads: [{ name: "Squad 1", dimensions: { release: { color: "warn" } } }] };
    const plan = boardIO.buildSquadImportPlan(file, "merge");
    assert.equal(plan.patches[0].fileLastRetro, undefined);
    assert.equal(plan.lastRetroSquadCount, 0);
  });
});

test("planHasChanges() is true for a lastRetro-only import (no rating/squad changes otherwise)", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "s1", name: "Squad 1", order: 1, dimensions: { release: { color: "good" } } }]
  }, () => {
    const file = {
      squads: [{ name: "Squad 1", lastRetro: {
        finishedAt: "2026-09-17T10:00:00.000Z", dimensions: { release: { color: "good", trend: "flat", overridden: false } }
      } }]
    };
    const plan = boardIO.buildSquadImportPlan(file, "merge");
    assert.equal(plan.ratingCount, 0); // the file's squad entry has NO `dimensions` (ratings) key at all -- only lastRetro
    assert.equal(plan.lastRetroSquadCount, 1);
    assert.equal(boardIO.planHasChanges(plan), true);
  });
});
