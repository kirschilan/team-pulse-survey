"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// PERF (see index.html's own PERF comment above its script block, and
// docs/session-log.md's 2026-09-18 entry): a plain <script src> with
// neither `defer` nor `async` blocks the parser until it's fetched AND
// executed before the browser even requests the next one -- measured on
// the real deployment as ~2.5s of pure serialized round-trip latency
// across index.html's ~28 script tags. `defer` fixed it while still
// guaranteeing document-order execution before DOMContentLoaded, so every
// same-origin script tag needs to keep carrying it. Plain HTML text
// parsing, not browser-dependent behavior, so a Node unit test -- not a
// Playwright scenario -- is the right tier (per this repo's TDD skill).
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "index.html"),
  "utf8"
).replace(/<!--[\s\S]*?-->/g, ""); // strip comments -- some mention <script> literally

function scriptTags(html) {
  return html.match(/<script\b[^>]*>/g) || [];
}

test("index.html has no inline <script> tags (every one loads via src=, per SEC-3's CSP requirement)", () => {
  const inline = scriptTags(INDEX_HTML).filter((tag) => !/\bsrc=/.test(tag));
  assert.deepEqual(inline, []);
});

test("every same-origin <script src> in index.html carries defer (regression guard for the ~2.5s serialized-load bug)", () => {
  const tags = scriptTags(INDEX_HTML).filter((tag) => /\bsrc="(?!https?:)/.test(tag));
  assert.ok(tags.length > 0, "expected to find same-origin script tags to check");
  const missingDefer = tags.filter((tag) => !/\bdefer\b/.test(tag));
  assert.deepEqual(missingDefer, [], "every same-origin script tag must carry defer");
});
