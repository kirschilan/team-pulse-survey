"use strict";

const js = require("@eslint/js");

// See STATUS.md's "ESLint" note for why the three file groups below get
// different `sourceType`/globals treatment: public/js/*.js are classic
// <script> files sharing one global scope on purpose (see STATUS.md's "The
// app's file layout" -- Chromium blocks cross-file `import` over `file://`,
// which both the Playwright suite and the "open index.html directly"
// workflow depend on), so ESLint -- which lints one file at a time -- can't
// see a sibling file's function/var declarations. relay/, scripts/, and
// tests/unit/ are ordinary Node CommonJS files with no such split, so they
// keep the full `no-undef` check.

const browserGlobals = {
  window: "writable",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  WebSocket: "readonly",
  crypto: "readonly",
  console: "readonly",
  fetch: "readonly",
  Blob: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  setTimeout: "writable",
  clearTimeout: "writable",
  setInterval: "writable",
  clearInterval: "writable",
  requestAnimationFrame: "writable",
  // Guarded `if (typeof module !== "undefined") module.exports = ...` block
  // at the bottom of each public/js/*.js file, for tests/unit/*.js to
  // `require()` -- a no-op in the browser since `module` doesn't exist
  // there. See STATUS.md's 2026-09-12 unit-test session-log entry.
  module: "readonly",
};

const nodeGlobals = {
  process: "readonly",
  require: "readonly",
  module: "writable",
  exports: "writable",
  __dirname: "readonly",
  __filename: "readonly",
  console: "readonly",
  Buffer: "readonly",
  global: "writable",
  setTimeout: "writable",
  clearTimeout: "writable",
  setInterval: "writable",
  clearInterval: "writable",
};

module.exports = [
  {
    ignores: ["public/vendor/**", "node_modules/**", "relay/node_modules/**", "public/relay-config.js"],
  },
  {
    files: ["public/*.js", "public/js/*.js"],
    languageOptions: {
      ecmaVersion: 2019,
      sourceType: "script",
      globals: browserGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      // Cross-file globals are the deliberate app architecture here (see
      // header comment) -- enabling this would be ~14 files' worth of
      // false positives, one per sibling-file symbol referenced.
      "no-undef": "off",
      // "local": a top-level function/var in one of these files is
      // routinely called from a *different* file (same cross-file-scope
      // reason no-undef is off above), so only flag genuinely-unused
      // names in a nested (function-local) scope.
      "no-unused-vars": ["warn", { vars: "local", args: "none", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["relay/**/*.js", "scripts/**/*.js", "tests/unit/**/*.js"],
    ignores: ["relay/node_modules/**"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      eqeqeq: ["error", "smart"],
    },
  },
];
