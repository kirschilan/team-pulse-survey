"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// db.js has no top-level DOM wiring (every document/window access lives
// inside a function body), so it's directly require()-able without
// fake_dom -- unlike board-export.js/board-import-ui.js, which bind
// listeners at load time.
const DEFAULT_CONFIG = { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Spotify Squad Health Check", attribution: "Spotify" };
global.DEFAULT_CONFIG = DEFAULT_CONFIG;
// plainClone() lives in board-sync.js (a bare global in the browser, same
// convention tests/unit/README.md already documents for the
// helpers.js/board-*.js boundary) -- reproduced here rather than
// require()-ing board-sync.js, which does real DOM/WebSocket wiring this
// test has no need for.
global.plainClone = function(value){ return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); };

const db = require(path.join(__dirname, "..", "..", "public", "js", "db.js"));

function fakeDoc(id, data) {
  return { id: id, data: function(){ return data; } };
}

test("normalizeSessionDoc() merges the doc id with its data verbatim", () => {
  const out = db.normalizeSessionDoc(fakeDoc("s1", { squadId: "sq1", status: "active" }));
  assert.deepEqual(out, { id: "s1", squadId: "sq1", status: "active" });
});

test("normalizeSquadDoc() clones dimensions into plain, extensible objects", () => {
  const frozenDims = Object.freeze({ trust: Object.freeze({ color: "green", trend: "up", note: "" }) });
  const out = db.normalizeSquadDoc(fakeDoc("sq1", { name: "Falcons", order: 2, dimensions: frozenDims }));
  assert.equal(out.id, "sq1");
  assert.equal(out.name, "Falcons");
  assert.equal(out.order, 2);
  assert.deepEqual(out.dimensions, { trust: { color: "green", trend: "up", note: "" } });
  assert.doesNotThrow(() => { out.dimensions.trust.note = "edited"; });
});

test("normalizeSquadDoc() defaults name/order/dimensions when missing", () => {
  const out = db.normalizeSquadDoc(fakeDoc("sq2", {}));
  assert.equal(out.name, "Untitled squad");
  assert.equal(out.order, 0);
  assert.deepEqual(out.dimensions, {});
  assert.equal(out.lastRetro, undefined);
});

test("normalizeSquadDoc() clones lastRetro (RETRO-1) rather than handing out the frozen reference", () => {
  const frozenLastRetro = Object.freeze({ finishedAt: "2026-09-17T00:00:00.000Z", experimentNote: "", dimensions: {} });
  const out = db.normalizeSquadDoc(fakeDoc("sq3", { lastRetro: frozenLastRetro }));
  assert.deepEqual(out.lastRetro, { finishedAt: "2026-09-17T00:00:00.000Z", experimentNote: "", dimensions: {} });
  assert.notEqual(out.lastRetro, frozenLastRetro);
  assert.doesNotThrow(() => { out.lastRetro.experimentNote = "edited"; });
});

test("normalizeDimensionDoc() carries statements/scoreBands/strategies/i18n only when present", () => {
  const bare = db.normalizeDimensionDoc(fakeDoc("trust", { label: "Trust", green: "High trust", red: "Low trust", order: 1 }));
  assert.deepEqual(bare, { key: "trust", label: "Trust", green: "High trust", red: "Low trust", order: 1 });

  const scored = db.normalizeDimensionDoc(fakeDoc("comm", {
    label: "Communication",
    statements: ["We talk openly"],
    scoreBands: { low: 0, high: 5 },
    strategies: ["Retro more"],
    i18n: Object.freeze({ he: { label: "תקשורת" } })
  }));
  assert.deepEqual(scored.statements, ["We talk openly"]);
  assert.deepEqual(scored.scoreBands, { low: 0, high: 5 });
  assert.deepEqual(scored.strategies, ["Retro more"]);
  assert.deepEqual(scored.i18n, { he: { label: "תקשורת" } });
  assert.doesNotThrow(() => { scored.i18n.he.label = "edited"; });
});

test("normalizeTemplateDoc() normalizes every dimension entry the same way normalizeDimensionDoc() does", () => {
  const out = db.normalizeTemplateDoc(fakeDoc("tpl1", {
    name: "Custom",
    unit: "Squad",
    unitPlural: "Squads",
    attribution: "Acme",
    dimensions: [
      { key: "trust", label: "Trust", green: "High", red: "Low", order: 1 },
      { key: "comm", label: "Comm", statements: ["S1"], i18n: Object.freeze({ he: { label: "x" } }) }
    ]
  }));
  assert.equal(out.id, "tpl1");
  assert.equal(out.name, "Custom");
  assert.equal(out.dimensions.length, 2);
  assert.equal(out.dimensions[0].key, "trust");
  assert.deepEqual(out.dimensions[1].statements, ["S1"]);
  assert.deepEqual(out.dimensions[1].i18n, { he: { label: "x" } });
});

test("normalizeTemplateDoc() defaults name/unit/attribution when missing", () => {
  const out = db.normalizeTemplateDoc(fakeDoc("tpl2", {}));
  assert.equal(out.name, "Untitled template");
  assert.equal(out.unit, "");
  assert.equal(out.unitPlural, "");
  assert.equal(out.attribution, "");
  assert.deepEqual(out.dimensions, []);
});

test("normalizeConfigSnapshot() returns null when meta/config doesn't exist yet", () => {
  assert.equal(db.normalizeConfigSnapshot({ exists: false }), null);
});

test("normalizeConfigSnapshot() falls back to DEFAULT_CONFIG's unit/unitPlural, but not activeTemplateName/attribution", () => {
  const out = db.normalizeConfigSnapshot({ exists: true, data: function(){ return {}; } });
  assert.deepEqual(out, {
    unit: DEFAULT_CONFIG.unit,
    unitPlural: DEFAULT_CONFIG.unitPlural,
    activeTemplateName: "",
    attribution: ""
  });
});

test("normalizeConfigSnapshot() carries real values through unchanged", () => {
  const out = db.normalizeConfigSnapshot({ exists: true, data: function(){ return { unit: "Team", unitPlural: "Teams", activeTemplateName: "Tuckman", attribution: "Tuckman" }; } });
  assert.deepEqual(out, { unit: "Team", unitPlural: "Teams", activeTemplateName: "Tuckman", attribution: "Tuckman" });
});
