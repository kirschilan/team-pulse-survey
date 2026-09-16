"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

require("./fake_dom").installFakeDom();
const helpers = require(path.join(__dirname, "..", "..", "public", "js", "helpers.js"));
global.sortedDimensions = helpers.sortedDimensions;
global.sortedSquads = helpers.sortedSquads;
global.nowIso = function(){ return new Date().toISOString(); };

const boardIO = require(path.join(__dirname, "..", "..", "public", "js", "board-export-import.js"));

function withBoard(board, fn) {
  global.state = Object.assign(
    { dimensions: [], squads: [], templates: [], config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Custom" } },
    board
  );
  fn();
}

// ---------- parseBoardImportFile() ----------

test("parseBoardImportFile() accepts a well-formed export", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [] }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.squads, []);
});

test("parseBoardImportFile() rejects text that isn't JSON at all", () => {
  const result = boardIO.parseBoardImportFile("not json { at all");
  assert.equal(result.ok, false);
  assert.equal(result.error, "not-json");
});

test("parseBoardImportFile() rejects a file with no squads array", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing-squads");
});

test("parseBoardImportFile() rejects a file with no formatVersion", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ squads: [] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "missing-version");
});

test("parseBoardImportFile() refuses a formatVersion newer than this app understands, rather than guessing", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 4, squads: [] }));
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
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [null] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() rejects a squad entry whose name isn't a string", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: 5, dimensions: {} }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() rejects a squad entry whose dimensions isn't a plain object", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: ["not", "an", "object"] }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-squad");
});

test("parseBoardImportFile() still accepts a squad entry with no dimensions field at all", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1" }] }));
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
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: "good" } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose note isn't a string", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "good", note: 123 } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose color isn't one of the app's known colors", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "not-a-real-color" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating whose trend isn't one of the app's known trends", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { trend: "sideways" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

// Third review round on the same PR: the enum check above used bracket
// lookup (VALID_RATING_COLORS[r.color]) directly on an untyped value, which
// is unsafe in three distinct ways a plain "is it in the enum" check misses:
// (1) a non-string coerces to a matching key string (an array [\"good\"]
// stringifies to exactly "good"); (2) a string naming an INHERITED property
// of the plain-object lookup table (e.g. "constructor") reads truthy even
// though it was never one of the four real colors; (3) an object with a
// non-callable `toString` throws TypeError converting itself into a
// property key, uncaught, the same "bypasses the friendly error UI" failure
// mode as finding #3, just reached through the rating check instead of the
// squad-shape check. Fixed by requiring `typeof value === "string"` FIRST
// (throws never reach a non-string, and non-strings can't coerce to begin
// with) before checking OWN-property membership, not bracket lookup.

test("parseBoardImportFile() rejects a rating color that isn't a string, even if it would coerce to a valid one", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: ["good"] } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating color naming an inherited Object.prototype property", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "constructor" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a non-coercible rating color without throwing", () => {
  assert.doesNotThrow(() => {
    const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: { toString: null } } } }] }));
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid-rating");
  });
});

test("parseBoardImportFile() rejects a rating trend that isn't a string, even if it would coerce to a valid one", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { trend: ["up"] } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() rejects a rating trend naming an inherited Object.prototype property", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { trend: "hasOwnProperty" } } }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-rating");
});

test("parseBoardImportFile() accepts a well-formed rating with every known-good field", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: { color: "good", trend: "up", note: "great work" } } }] }));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() accepts a rating with no fields at all (an empty object)", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [{ name: "Squad 1", dimensions: { release: {} } }] }));
  assert.equal(result.ok, true);
});

// ---------- buildSquadImportPlan() ----------

function fileWith(squads){ return { formatVersion: 1, squads: squads }; }

test("buildSquadImportPlan() matches an existing squad by name and reports its file ratings", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }]
  }, () => {
    const plan = boardIO.buildSquadImportPlan(fileWith([
      { name: "Squad 1", dimensions: { release: { color: "good" } } }
    ]), "merge");
    assert.equal(plan.ratingCount, 1);
    assert.equal(plan.patches[0].existing.id, "sq-1");
    assert.deepEqual(plan.patches[0].fileDims, { release: { color: "good" } });
    assert.equal(plan.newSquadNames.length, 0);
  });
});

// Ports forward the assurance CSV's own "Dimension Key column" existed for
// (removed along with CSV itself, Story 13 item 4): re-importing an export
// still matches a rating to the right dimension even after that dimension's
// LABEL has since been renamed or translated on the board. CSV needed a
// whole extra column as a workaround for this, since its flat-table format
// has no natural way to reference a dimension except by label; JSON never
// had that problem -- a rating's file-key is matched directly against the
// board's CURRENT dimension KEY (dimByKeyMap, the primary path in
// buildSquadImportPlan(), unconditional and unrelated to label at all), so
// nothing about a label rename can ever affect it.
test("buildSquadImportPlan() still matches a rating by key after the board's dimension label has been renamed", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Renamed / Translated Label", order: 1 }],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }]
  }, () => {
    // the file itself still carries the dimension's OLD label (as it was at
    // export time) -- irrelevant, since matching never looks at fd.label
    // when the file-key already matches a board dimension directly.
    const plan = boardIO.buildSquadImportPlan({
      formatVersion: 1,
      squads: [{ name: "Squad 1", dimensions: { release: { color: "good" } } }],
      dimensions: [{ key: "release", label: "Easy to release" }]
    }, "merge");
    assert.equal(plan.ratingCount, 1);
    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(plan.patches[0].fileDims, { release: { color: "good" } });
  });
});

test("buildSquadImportPlan() flags a file squad name not on the board as new", () => {
  withBoard({ dimensions: [], squads: [] }, () => {
    const plan = boardIO.buildSquadImportPlan(fileWith([{ name: "Squad 9", dimensions: {} }]), "merge");
    assert.deepEqual(plan.newSquadNames, ["Squad 9"]);
    assert.equal(plan.patches[0].existing, null);
  });
});

test("buildSquadImportPlan() skips a rating for a dimension key not on the current board, without guessing", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }], squads: [] }, () => {
    const plan = boardIO.buildSquadImportPlan(fileWith([
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
    const plan = boardIO.buildSquadImportPlan(fileWith([{ name: "Squad 1", dimensions: {} }]), "merge");
    assert.deepEqual(plan.squadsToRemove, []);
  });
});

test("buildSquadImportPlan() in REPLACE mode marks a board squad absent from the file for removal", () => {
  withBoard({
    dimensions: [],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }, { id: "sq-2", name: "Squad 2", dimensions: {} }]
  }, () => {
    const plan = boardIO.buildSquadImportPlan(fileWith([{ name: "Squad 1", dimensions: {} }]), "replace");
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
    const plan = boardIO.buildSquadImportPlan(fileWith([
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
    const plan = boardIO.buildSquadImportPlan(fileWith([
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
  const result = boardIO.mergeSquadDimensions(
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
  assert.equal(boardIO.planHasChanges(plan), true);
});

test("planHasChanges() is false when a plan truly changes nothing", () => {
  const plan = { ratingCount: 0, newSquadNames: [], squadsToRemove: [], clearedRatings: [] };
  assert.equal(boardIO.planHasChanges(plan), false);
});

test("mergeSquadDimensions() in REPLACE mode drops a squad's existing ratings the file doesn't mention", () => {
  const result = boardIO.mergeSquadDimensions(
    { release: { color: "good" }, speed: { color: "warn" } },
    { release: { color: "crit" } },
    "replace"
  );
  assert.deepEqual(result, { release: { color: "crit" } });
});

// ---------- PR #12 review finding (P1): combined squads+dimensions import
// dropped ratings whenever a rating's dimension key didn't literally exist
// on the destination board -- true for EVERY cross-board import once
// dimensions started matching by label instead of key (item 3b's own
// design), since two different boards/devices never share a dimension's
// random "local-dim-"+Date.now() key even for "the same" labeled
// dimension. Fixed two ways: (1) buildSquadImportPlan() now also tries a
// file-key -> label -> CURRENT-board-dimension-by-label fallback before
// giving up, covering an EXISTING same-labeled dimension whose key just
// differs from the file's; (2) an optional third argument
// (extraDimensionLabels -- buildDimensionImportPlan()'s own `added` list)
// lets a rating for a dimension that doesn't exist YET, but WILL once the
// dimension plan is applied in the same operation, resolve to a pending
// marker (pendingDimensionKey()) instead of being silently skipped --
// resolvePendingDimensionKeys() turns that marker into the dimension's
// real key once it actually exists, called right after the dimension
// import runs (see board-export-import.js's Apply-button handler). ----

test("buildSquadImportPlan() resolves a rating via label when an EXISTING board dimension has a different key than the file", () => {
  withBoard({
    dimensions: [{ key: "release", label: "Easy to release", order: 1 }],
    squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }]
  }, () => {
    const plan = boardIO.buildSquadImportPlan({
      formatVersion: 1,
      squads: [{ name: "Squad 1", dimensions: { source_board_key: { color: "warn" } } }],
      dimensions: [{ key: "source_board_key", label: "Easy to release" }]
    }, "merge");
    assert.equal(plan.ratingCount, 1);
    assert.equal(plan.skipped.length, 0);
    assert.deepEqual(plan.patches[0].fileDims, { release: { color: "warn" } });
  });
});

test("buildSquadImportPlan() still reports 'not found' when no board dimension matches by key OR by label", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }], squads: [] }, () => {
    const plan = boardIO.buildSquadImportPlan({
      formatVersion: 1,
      squads: [{ name: "Squad 1", dimensions: { source_board_key: { color: "warn" } } }],
      dimensions: [{ key: "source_board_key", label: "Something else entirely" }]
    }, "merge");
    assert.equal(plan.ratingCount, 0);
    assert.equal(plan.skipped.length, 1);
  });
});

test("buildSquadImportPlan() counts a rating for a not-yet-existing dimension as pending when its label is in extraDimensionLabels", () => {
  withBoard({ dimensions: [], squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }] }, () => {
    const plan = boardIO.buildSquadImportPlan({
      formatVersion: 1,
      squads: [{ name: "Squad 1", dimensions: { psych_key: { color: "good", note: "great" } } }],
      dimensions: [{ key: "psych_key", label: "Psychological safety" }]
    }, "merge", ["Psychological safety"]);
    assert.equal(plan.ratingCount, 1);
    assert.equal(plan.skipped.length, 0);
    const pendingKey = boardIO.pendingDimensionKey("Psychological safety");
    assert.deepEqual(plan.patches[0].fileDims, { [pendingKey]: { color: "good", note: "great" } });
  });
});

test("buildSquadImportPlan() reports 'not found' for the same file, without extraDimensionLabels (e.g. templates scope unchecked)", () => {
  withBoard({ dimensions: [], squads: [{ id: "sq-1", name: "Squad 1", dimensions: {} }] }, () => {
    const plan = boardIO.buildSquadImportPlan({
      formatVersion: 1,
      squads: [{ name: "Squad 1", dimensions: { psych_key: { color: "good" } } }],
      dimensions: [{ key: "psych_key", label: "Psychological safety" }]
    }, "merge");
    assert.equal(plan.ratingCount, 0);
    assert.equal(plan.skipped.length, 1);
  });
});

test("resolvePendingDimensionKeys() resolves a pending marker to the dimension's real key once it exists on the board", () => {
  withBoard({ dimensions: [{ key: "local-dim-999", label: "Psychological safety", order: 1 }] }, () => {
    const pendingKey = boardIO.pendingDimensionKey("Psychological safety");
    const resolved = boardIO.resolvePendingDimensionKeys({ [pendingKey]: { color: "good" }, release: { color: "warn" } });
    assert.deepEqual(resolved, { "local-dim-999": { color: "good" }, release: { color: "warn" } });
  });
});

test("resolvePendingDimensionKeys() drops a pending marker that still doesn't resolve to any board dimension", () => {
  withBoard({ dimensions: [] }, () => {
    const pendingKey = boardIO.pendingDimensionKey("Nonexistent");
    const resolved = boardIO.resolvePendingDimensionKeys({ [pendingKey]: { color: "good" } });
    assert.deepEqual(resolved, {});
  });
});

// ---------- item 3b: parseBoardImportFile() validating dimensions/templates/config ----------
// Same rationale as the squad/rating validation above: a structurally-
// malformed dimensions/templates/config section must be rejected at the
// parse boundary, not thrown from deep inside plan-building or render code.

test("parseBoardImportFile() rejects a non-array dimensions field", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], dimensions: "nope" }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-dimensions");
});

test("parseBoardImportFile() rejects a dimension entry with no label", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], dimensions: [{ key: "release" }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-dimension");
});

test("parseBoardImportFile() rejects a dimension entry whose label is blank", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], dimensions: [{ label: "   " }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-dimension");
});

test("parseBoardImportFile() rejects a dimension entry whose green field isn't a string", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], dimensions: [{ label: "Speed", green: 5 }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-dimension");
});

test("parseBoardImportFile() rejects a dimension entry whose statements isn't an array", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], dimensions: [{ label: "Speed", statements: "nope" }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-dimension");
});

test("parseBoardImportFile() accepts a well-formed dimensions section", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({
    formatVersion: 1, squads: [],
    dimensions: [{ key: "release", label: "Easy to release", green: "smooth", red: "risky", order: 1 }]
  }));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() rejects a non-array templates field", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], templates: {} }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-templates");
});

test("parseBoardImportFile() rejects a template entry with no name", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], templates: [{ dimensions: [] }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-template");
});

test("parseBoardImportFile() rejects a template entry whose own dimensions array is malformed", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({
    formatVersion: 1, squads: [],
    templates: [{ name: "Onboarding", dimensions: [{ label: "" }] }]
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-template");
});

test("parseBoardImportFile() accepts a well-formed templates section", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({
    formatVersion: 1, squads: [],
    templates: [{ name: "Onboarding", unit: "Squad", unitPlural: "Squads", attribution: "", dimensions: [{ key: "release", label: "Easy to release", order: 1 }] }]
  }));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() rejects a non-object config field", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], config: "nope" }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-config");
});

test("parseBoardImportFile() rejects a config field whose known value isn't a string", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], config: { unit: 5 } }));
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid-config");
});

test("parseBoardImportFile() accepts a config section with an unknown extra field (forward-compat, ignored not rejected)", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [], config: { unit: "Squad", someFutureField: 123 } }));
  assert.equal(result.ok, true);
});

test("parseBoardImportFile() accepts a file with no dimensions/templates/config sections at all", () => {
  const result = boardIO.parseBoardImportFile(JSON.stringify({ formatVersion: 1, squads: [] }));
  assert.equal(result.ok, true);
});

// ---------- buildDimensionImportPlan() ----------
// Matches by LABEL, not key -- see board-export-import.js's own comment on why: a custom
// dimension's key is exactly as device-local/random as a template's id, so
// key-matching would import every admin-created dimension as "new" every
// time, defeating cross-tribe reuse. Only 3a's separate rating-to-dimension
// matching (by key, against the board's own CURRENT set) is unaffected.

test("buildDimensionImportPlan() matches an existing dimension by label, case-insensitively and trimmed", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }] }, () => {
    const plan = boardIO.buildDimensionImportPlan([{ label: "  EASY TO RELEASE  ", green: "g", red: "r" }], "merge");
    assert.equal(plan.added.length, 0);
    assert.equal(plan.patches[0].existing.key, "release");
  });
});

test("buildDimensionImportPlan() flags a file dimension label not on the board as added", () => {
  withBoard({ dimensions: [] }, () => {
    const plan = boardIO.buildDimensionImportPlan([{ label: "Psychological safety" }], "merge");
    assert.deepEqual(plan.added, ["Psychological safety"]);
    assert.equal(plan.patches[0].existing, null);
  });
});

test("buildDimensionImportPlan() in MERGE mode never marks a board dimension absent from the file for removal", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }, { key: "speed", label: "Speed", order: 2 }] }, () => {
    const plan = boardIO.buildDimensionImportPlan([{ label: "Easy to release" }], "merge");
    assert.deepEqual(plan.toRemove, []);
  });
});

test("buildDimensionImportPlan() in REPLACE mode marks a board dimension absent from the file for removal", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }, { key: "speed", label: "Speed", order: 2 }] }, () => {
    const plan = boardIO.buildDimensionImportPlan([{ label: "Easy to release" }], "replace");
    assert.equal(plan.toRemove.length, 1);
    assert.equal(plan.toRemove[0].key, "speed");
  });
});

// A squads-only file (no "dimensions" key at all -- every item 3a-only
// fixture is exactly this shape, and formatVersion:1 makes the field
// genuinely optional) must never be read as "this file's dimension set is
// empty." Caught before shipping: REPLACE mode was treating `undefined` the
// same as `[]`, which meant opening a plain squads-only file in Replace
// mode silently wiped every dimension on the board.
test("buildDimensionImportPlan() with no dimensions field at all touches nothing, even in REPLACE mode", () => {
  withBoard({ dimensions: [{ key: "release", label: "Easy to release", order: 1 }, { key: "speed", label: "Speed", order: 2 }] }, () => {
    const plan = boardIO.buildDimensionImportPlan(undefined, "replace");
    assert.deepEqual(plan.toRemove, []);
    assert.deepEqual(plan.added, []);
    assert.deepEqual(plan.patches, []);
  });
});

// ---------- buildTemplateImportPlan() ----------
// Matches by NAME, not id -- same portability reasoning already applied to
// squads (a template's local id is a storage artifact, never portable
// across two different boards/devices).

test("buildTemplateImportPlan() matches an existing template by name, case-insensitively and trimmed", () => {
  withBoard({ templates: [{ id: "tpl-1", name: "Onboarding Checklist" }] }, () => {
    const plan = boardIO.buildTemplateImportPlan([{ name: "  onboarding checklist  " }], "merge");
    assert.equal(plan.added.length, 0);
    assert.equal(plan.patches[0].existing.id, "tpl-1");
  });
});

test("buildTemplateImportPlan() flags a file template name not on the board as added", () => {
  withBoard({ templates: [] }, () => {
    const plan = boardIO.buildTemplateImportPlan([{ name: "New Hire 30-60-90" }], "merge");
    assert.deepEqual(plan.added, ["New Hire 30-60-90"]);
    assert.equal(plan.patches[0].existing, null);
  });
});

test("buildTemplateImportPlan() in MERGE mode never marks a board template absent from the file for removal", () => {
  withBoard({ templates: [{ id: "tpl-1", name: "Onboarding Checklist" }, { id: "tpl-2", name: "Quarterly Deep Dive" }] }, () => {
    const plan = boardIO.buildTemplateImportPlan([{ name: "Onboarding Checklist" }], "merge");
    assert.deepEqual(plan.toRemove, []);
  });
});

test("buildTemplateImportPlan() in REPLACE mode marks a board template absent from the file for removal", () => {
  withBoard({ templates: [{ id: "tpl-1", name: "Onboarding Checklist" }, { id: "tpl-2", name: "Quarterly Deep Dive" }] }, () => {
    const plan = boardIO.buildTemplateImportPlan([{ name: "Onboarding Checklist" }], "replace");
    assert.equal(plan.toRemove.length, 1);
    assert.equal(plan.toRemove[0].id, "tpl-2");
  });
});

// Same fix as buildDimensionImportPlan() above, same reason: a squads-only
// file (no "templates" key at all) must never be read as "zero saved
// templates" and wipe the board's saved-templates list in REPLACE mode.
test("buildTemplateImportPlan() with no templates field at all touches nothing, even in REPLACE mode", () => {
  withBoard({ templates: [{ id: "tpl-1", name: "Onboarding Checklist" }] }, () => {
    const plan = boardIO.buildTemplateImportPlan(undefined, "replace");
    assert.deepEqual(plan.toRemove, []);
    assert.deepEqual(plan.added, []);
    assert.deepEqual(plan.patches, []);
  });
});

// ---------- buildConfigImportPlan() ----------
// Board settings are 4 named fields, not a collection -- no mode parameter,
// no removal concept, same in Merge or Replace (see board-export-import.js's own comment).

test("buildConfigImportPlan() reports only known fields that actually differ", () => {
  withBoard({ config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Spotify", attribution: "orig" } }, () => {
    const changes = boardIO.buildConfigImportPlan({ unit: "Squad", activeTemplateName: "Tuckman" });
    assert.deepEqual(changes, [{ field: "activeTemplateName", from: "Spotify", to: "Tuckman" }]);
  });
});

test("buildConfigImportPlan() ignores an unknown field even if it would differ", () => {
  withBoard({ config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Spotify", attribution: "orig" } }, () => {
    const changes = boardIO.buildConfigImportPlan({ someFutureField: "x" });
    assert.deepEqual(changes, []);
  });
});

test("buildConfigImportPlan() returns no changes when the file has no config section", () => {
  withBoard({ config: { unit: "Squad", unitPlural: "Squads", activeTemplateName: "Spotify", attribution: "orig" } }, () => {
    const changes = boardIO.buildConfigImportPlan(undefined);
    assert.deepEqual(changes, []);
  });
});

// ---------- entityImportPlanHasChanges() ----------
// Shared gate for the dimensions/templates Apply-button state, same shape
// as planHasChanges() above but for the {patches, added, toRemove} plans
// buildDimensionImportPlan()/buildTemplateImportPlan() return.

test("entityImportPlanHasChanges() is true when there's a new entity to add", () => {
  assert.equal(boardIO.entityImportPlanHasChanges({ patches: [], added: ["New one"], toRemove: [] }), true);
});

test("entityImportPlanHasChanges() is true when an existing entity is matched (would be updated)", () => {
  assert.equal(boardIO.entityImportPlanHasChanges({ patches: [{ existing: { key: "release" }, file: {} }], added: [], toRemove: [] }), true);
});

test("entityImportPlanHasChanges() is true when REPLACE mode would remove something", () => {
  assert.equal(boardIO.entityImportPlanHasChanges({ patches: [], added: [], toRemove: [{ key: "speed" }] }), true);
});

test("entityImportPlanHasChanges() is false when a plan truly changes nothing", () => {
  assert.equal(boardIO.entityImportPlanHasChanges({ patches: [], added: [], toRemove: [] }), false);
});
