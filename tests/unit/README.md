# Unit tests

See `docs/DefinitionOfDone.md` for the standing testing policy; this file is
the mechanics of this one tier.

Plain Node tests (`node:test` + `node:assert/strict` -- ships with Node,
nothing to install) for the app's pure logic: consolidation/scoring math
(`helpers.js`), CSV parsing/column-matching/import-planning (`csv.js`), and
`i18n.js`'s `t()` lookup/fallback/interpolation plus the English/Hebrew
key-parity check (`test_i18n.js`) that mechanically enforces the product
owner's "every future change supports every supported language" DOD (see
STATUS.md) -- it catches a missing or blank translation, not a wrong one;
translation quality is still a human read-through, per `locales/he.js`'s own
header comment. No browser, no DOM, no Playwright -- these run in
milliseconds, not seconds, and a failure points straight at the function and
input that broke, rather than at a UI assertion three layers away from the
actual bug.

## Why these exist alongside the Playwright suite

`public/js/*.js` are plain classic scripts sharing one global scope, not ES
modules (see `STATUS.md` -- Chromium blocks cross-file `import` over
`file://`, which the Playwright suite and the "open index.html directly"
workflow both depend on). Before this, the ONLY way to exercise
`consolidateBand()`'s tie-breaking rule, or `buildImportPlan()`'s
Dimension-Key-before-label fallback, was to load a full page, click
through several screens of UI, and read the result back out of the DOM --
correct, but slow and indirect. These pure functions have no DOM
dependency at all, so they don't need a browser to test.

`helpers.js` and `csv.js` each end with a small, guarded block:

```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ...the pure functions... };
}
```

`module` doesn't exist in a browser, so this is a complete no-op there --
nothing about how the real app loads or runs these files changes. It just
lets a Node test `require()` them directly.

Some of these functions (`sortedDimensions`, `buildImportPlan`, ...) read
a global `state` object or call another file's function as a bare
identifier -- exactly how they'd resolve in a browser sharing one `window`
scope. `fake_dom.js` provides a minimal, deliberately permissive
`document`/`window` stand-in (every element access returns a harmless fake
that accepts any call) so `require()`-ing a file that also does real DOM
wiring at its top level (e.g. `csv.js`'s `document.getElementById(...)
.addEventListener(...)` calls) doesn't crash on load; each test file sets
`global.state` itself for whatever board shape that test needs.

This layer covers computation. Real DOM rendering, user interaction, and
anything touching a real WebSocket or `crypto.subtle` stay covered by the
Playwright suite one level up (`tests/test_*.py`) -- that's still the
right tool for those, and isn't going away.

## Running

```
node --test tests/unit/test_*.js
```
