"use strict";

const js = require("@eslint/js");

// See STATUS.md's "ESLint" note for why the three file groups below get
// different `sourceType`/globals treatment: public/js/**/*.js (including
// public/js/locales/*.js -- a PR #42 review finding: a plain public/js/*.js
// glob doesn't cross the locales/ subdirectory boundary, so en.js/he.js were
// silently never linted at all) are classic <script> files sharing one
// global scope on purpose (see STATUS.md's "The app's file layout" --
// Chromium blocks cross-file `import` over `file://`, which both the
// Playwright suite and the "open index.html directly" workflow depend on),
// so ESLint -- which lints one file at a time -- can't see a sibling file's
// function/var declarations. relay/, scripts/, and tests/unit/ are ordinary
// Node CommonJS files with no such split, so they keep the full `no-undef`
// check.

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
    // public/_test_* matches .gitignore's own pattern for tests/fixtures/build_page.py's
    // generated Playwright pages (written straight into public/ so relative asset links
    // resolve over file://, per STATUS.md's "app's file layout") -- present locally after
    // a test run, never committed, and not code to lint.
    ignores: [
      "public/vendor/**",
      "node_modules/**",
      "relay/node_modules/**",
      "public/relay-config.js",
      "public/_test_*",
      // Makefile's `make setup` creates this project-local Python venv,
      // which vendors Playwright's own JS driver -- discovered without
      // this ignore because ESLint (confirmed via `--print-config`) still
      // parses a file that matches no `files` pattern above, applying an
      // empty ruleset plus its default `reportUnusedDisableDirectives`,
      // which then errors on that vendored file's own inline
      // `@typescript-eslint/...` disable comments (a plugin this config
      // never loads).
      ".venv/**",
    ],
  },
  {
    files: ["public/*.js", "public/js/**/*.js"],
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
