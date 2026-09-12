"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
// csv.js's buildImportPlan()/toCSV() call sortedDimensions()/sortedSquads()
// as bare globals, exactly like every other public/js/*.js file does in a
// real browser sharing one window scope (see STATUS.md on why these are
// plain classic scripts, not ES modules). Reproduce that here: pull the
// REAL implementations from helpers.js and hang them off Node's `global`
// so csv.js's own top-level scope resolution finds them, rather than
// re-implementing or mocking the sort/lookup logic separately.
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));
global.sortedDimensions = helpers.sortedDimensions;
global.sortedSquads = helpers.sortedSquads;

const csv = require(path.join(__dirname, "..", "..", "public", "js", "csv.js"));

test("parseCSV() splits rows/fields, honoring quoted commas and newlines", () => {
  const text = 'Squad,Dimension,Health\r\n"Squad, A",Trust,Green\r\nSquad B,"multi\nline",Red\r\n';
  const rows = csv.parseCSV(text);
  assert.deepEqual(rows, [
    ["Squad", "Dimension", "Health"],
    ["Squad, A", "Trust", "Green"],
    ["Squad B", "multi\nline", "Red"],
  ]);
});

test("parseCSV() unescapes doubled quotes inside a quoted field", () => {
  const rows = csv.parseCSV('Name,Note\nA,"she said ""hi"""\n');
  assert.deepEqual(rows[1], ["A", 'she said "hi"']);
});

test("parseCSV() drops trailing blank lines", () => {
  const rows = csv.parseCSV("A,B\n1,2\n\n\n");
  assert.deepEqual(rows, [["A", "B"], ["1", "2"]]);
});

test("colorFromWord()/trendFromWord() map the CSV's human words, case-insensitively", () => {
  assert.equal(csv.colorFromWord("Green"), "good");
  assert.equal(csv.colorFromWord("yellow"), "warn");
  assert.equal(csv.colorFromWord("RED"), "crit");
  assert.equal(csv.colorFromWord("huh"), "unscored");
  assert.equal(csv.trendFromWord("Improving"), "up");
  assert.equal(csv.trendFromWord("declining"), "down");
  assert.equal(csv.trendFromWord("Steady"), "flat");
  assert.equal(csv.trendFromWord(""), undefined);
});

test("mapImportColumns() matches header names case-insensitively regardless of order", () => {
  const idx = csv.mapImportColumns(["Squad", "Health", "Dimension", "Dimension Key"]);
  assert.equal(idx.health, 1);
  assert.equal(idx.dimension, 2);
  assert.equal(idx.dimensionKey, 3);
  assert.equal(idx.recognized, 3);
});

test("mapImportColumns() falls back to toCSV()'s fixed column order when nothing is recognized", () => {
  const idx = csv.mapImportColumns(["col1", "col2", "col3"]);
  assert.equal(idx.recognized, 0);
  assert.equal(idx.dimension, 1);
  assert.equal(idx.health, 2);
  assert.equal(idx.trend, 3);
});

test("mapImportColumns() also recognizes 'key' and 'dimensionkey' spellings for the stable-id column", () => {
  assert.equal(csv.mapImportColumns(["a", "Key"]).dimensionKey, 1);
  assert.equal(csv.mapImportColumns(["a", "DimensionKey"]).dimensionKey, 1);
});

function withBoard(dims, squads, fn) {
  global.state = { dimensions: dims, squads: squads, config: { unit: "Squad", activeTemplateName: "Custom" } };
  fn();
}

test("buildImportPlan() matches by the stable Dimension Key first, ahead of the label", () => {
  withBoard(
    [{ key: "trust", label: "Old Renamed Label", order: 1 }],
    [{ id: "sq-1", name: "Squad 1" }],
    () => {
      const rows = [
        ["Squad", "Dimension", "Health", "Trend", "Note", "Template", "Dimension Key"],
        ["Squad 1", "Whatever It Used To Be Called", "Green", "Improving", "", "Custom", "trust"],
      ];
      const plan = csv.buildImportPlan(rows);
      assert.equal(plan.ratingCount, 1);
      assert.equal(plan.skipped.length, 0);
      assert.deepEqual(plan.patches[0].dims.trust, { color: "good", trend: "up", note: "" });
    }
  );
});

test("buildImportPlan() falls back to matching by label when there's no Dimension Key column (an older export)", () => {
  withBoard(
    [{ key: "trust", label: "Trust", order: 1 }],
    [{ id: "sq-1", name: "Squad 1" }],
    () => {
      const rows = [
        ["Squad", "Dimension", "Health", "Trend", "Note"],
        ["Squad 1", "Trust", "Red", "Declining", "slipping"],
      ];
      const plan = csv.buildImportPlan(rows);
      assert.equal(plan.ratingCount, 1);
      assert.deepEqual(plan.patches[0].dims.trust, { color: "crit", trend: "down", note: "slipping" });
    }
  );
});

test("buildImportPlan() reports a row whose dimension isn't found today, without guessing", () => {
  withBoard(
    [{ key: "trust", label: "Trust", order: 1 }],
    [{ id: "sq-1", name: "Squad 1" }],
    () => {
      const rows = [
        ["Squad", "Dimension", "Health"],
        ["Squad 1", "A Dimension That No Longer Exists", "Green"],
      ];
      const plan = csv.buildImportPlan(rows);
      assert.equal(plan.ratingCount, 0);
      assert.equal(plan.skipped.length, 1);
      assert.equal(plan.skipped[0].reason, "dimension not found");
      assert.equal(plan.skipped[0].row, 2, "1-indexed, plus the header row");
    }
  );
});

test("buildImportPlan() flags a squad name not on the board yet as new, without creating a doc", () => {
  withBoard(
    [{ key: "trust", label: "Trust", order: 1 }],
    [{ id: "sq-1", name: "Squad 1" }],
    () => {
      const rows = [
        ["Squad", "Dimension", "Health"],
        ["Brand New Squad", "Trust", "Yellow"],
      ];
      const plan = csv.buildImportPlan(rows);
      assert.deepEqual(plan.newSquadNames, ["Brand New Squad"]);
      assert.equal(plan.patches[0].existing, null);
    }
  );
});

test("buildImportPlan() surfaces which template(s) the file itself was exported under", () => {
  withBoard(
    [{ key: "trust", label: "Trust", order: 1 }],
    [{ id: "sq-1", name: "Squad 1" }],
    () => {
      const rows = [
        ["Squad", "Dimension", "Health", "Trend", "Note", "Template"],
        ["Squad 1", "Trust", "Green", "", "", "Five Dysfunctions"],
      ];
      const plan = csv.buildImportPlan(rows);
      assert.deepEqual(plan.fileTemplateNames, ["Five Dysfunctions"]);
      assert.equal(plan.currentTemplateName, "Custom");
    }
  );
});

test("toCSV() round-trips through parseCSV()/buildImportPlan() with the Dimension Key intact", () => {
  withBoard(
    [{ key: "release", label: "Easy to release", order: 1 }],
    [{ id: "sq-1", name: "Squad 1", dimensions: { release: { color: "warn", trend: "flat", note: "meh" } } }],
    () => {
      const csvText = csv.toCSV();
      const rows = csv.parseCSV(csvText);
      assert.deepEqual(rows[0], ["Squad", "Dimension", "Health", "Trend", "Note", "Template", "Dimension Key"]);
      assert.deepEqual(rows[1], ["Squad 1", "Easy to release", "Yellow", "Steady", "meh", "Custom", "release"]);
      const plan = csv.buildImportPlan(rows);
      assert.equal(plan.ratingCount, 1);
      assert.equal(plan.skipped.length, 0);
    }
  );
});
