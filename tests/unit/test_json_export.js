"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
// buildBoardExport()/toJSON() call sortedDimensions()/sortedSquads() as
// bare globals, exactly like every other public/js/*.js file does sharing
// one window scope in a real browser.
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));
global.sortedDimensions = helpers.sortedDimensions;
global.sortedSquads = helpers.sortedSquads;
// nowIso() isn't in helpers.js's own module.exports (nothing needed it from
// a unit test until now) -- reproducing its one-line real definition here
// rather than widening that exports list for a single caller.
global.nowIso = function(){ return new Date().toISOString(); };

const boardIO = require(path.join(__dirname, "..", "..", "public", "js", "board-export-import.js"));

function withBoard(board, fn) {
  global.state = Object.assign(
    { dimensions: [], squads: [], templates: [], config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Custom", attribution: "" } },
    board
  );
  fn();
}

test("buildBoardExport() carries formatVersion and exportedAt", () => {
  withBoard({}, () => {
    const out = boardIO.buildBoardExport();
    assert.equal(out.formatVersion, 1);
    assert.equal(typeof out.exportedAt, "string");
  });
});

test("buildBoardExport() carries config verbatim", () => {
  withBoard({ config: { unit: "Team", unitPlural: "Teams", activeTemplateName: "Tuckman", attribution: "Some credit" } }, () => {
    const out = boardIO.buildBoardExport();
    assert.deepEqual(out.config, { unit: "Team", unitPlural: "Teams", activeTemplateName: "Tuckman", attribution: "Some credit" });
  });
});

test("buildBoardExport() carries every dimension field, including a bilingual i18n override", () => {
  withBoard({
    dimensions: [{
      key: "trust", label: "Trust", order: 1, green: "g", red: "r",
      statements: ["s1", "s2"], scoreBands: { good: 8, warn: 6 }, strategies: ["do X"],
      i18n: { he: { label: "אמון", green: "ג", red: "א", statements: ["ש1", "ש2"], strategies: ["עשה X"] } }
    }]
  }, () => {
    const out = boardIO.buildBoardExport();
    assert.equal(out.dimensions.length, 1);
    const d = out.dimensions[0];
    assert.equal(d.key, "trust");
    assert.equal(d.label, "Trust");
    assert.deepEqual(d.statements, ["s1", "s2"]);
    assert.deepEqual(d.scoreBands, { good: 8, warn: 6 });
    assert.deepEqual(d.strategies, ["do X"]);
    assert.deepEqual(d.i18n, { he: { label: "אמון", green: "ג", red: "א", statements: ["ש1", "ש2"], strategies: ["עשה X"] } });
  });
});

test("buildBoardExport() carries custom templates (not starter templates), including their i18n block", () => {
  withBoard({
    templates: [{ id: "local-tpl-1", name: "My Template", unit: "Squad", unitPlural: "Squads", attribution: "", dimensions: [{ key: "x", label: "X", green: "", red: "", order: 1 }], i18n: { he: { attribution: "זכויות" } } }]
  }, () => {
    const out = boardIO.buildBoardExport();
    assert.equal(out.templates.length, 1);
    assert.equal(out.templates[0].name, "My Template");
    assert.deepEqual(out.templates[0].i18n, { he: { attribution: "זכויות" } });
  });
});

test("buildBoardExport() carries squads matched by name, with their ratings, and no local storage id", () => {
  withBoard({
    squads: [{ id: "local-12345", name: "Squad 1", order: 1, dimensions: { trust: { color: "good", trend: "up", note: "great" } } }]
  }, () => {
    const out = boardIO.buildBoardExport();
    assert.deepEqual(out.squads, [{ name: "Squad 1", order: 1, dimensions: { trust: { color: "good", trend: "up", note: "great" } } }]);
  });
});

test("buildBoardExport() excludes sessions and any team-sync secret -- never present in the output at all", () => {
  withBoard({ sessions: [{ id: "sess-1" }], teamSecret: "should-never-leak" }, () => {
    const out = boardIO.buildBoardExport();
    assert.equal(Object.prototype.hasOwnProperty.call(out, "sessions"), false);
    assert.equal(JSON.stringify(out).indexOf("should-never-leak"), -1);
  });
});

test("toJSON() produces pretty-printed, parseable JSON matching buildBoardExport()'s shape", () => {
  withBoard({ dimensions: [{ key: "trust", label: "Trust", order: 1, green: "", red: "" }] }, () => {
    const text = boardIO.toJSON();
    assert.match(text, /\n/, "pretty-printed, not minified");
    const parsed = JSON.parse(text);
    const fresh = boardIO.buildBoardExport();
    // toJSON() and this second buildBoardExport() call each capture their own
    // nowIso() independently -- comparing exportedAt directly would be a real
    // (if rare) flake if the two calls straddle a millisecond boundary.
    // Checked separately below; excluded from the structural comparison.
    assert.match(parsed.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "a real ISO timestamp");
    delete parsed.exportedAt;
    delete fresh.exportedAt;
    assert.deepEqual(parsed, fresh);
  });
});
