"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// SEC-3 (STATUS.md's "Security hardening backlog"): vercel.json is the only
// place a real deployment's HTTP response headers are configured (see
// index.html's own <meta http-equiv="Content-Security-Policy"> for the one
// directive that's ALSO enforced over file:// and on a plain self-hosted
// static server -- CSP and Referrer-Policy have meta-tag equivalents,
// X-Content-Type-Options and Permissions-Policy do not, so vercel.json is
// their only source on a Vercel deployment). This is plain JSON, not
// browser-dependent logic, so a Node unit test -- not a Playwright
// scenario -- is the right tier (per this repo's TDD skill).
const VERCEL_JSON = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "vercel.json"), "utf8")
);

function headersFor(source) {
  const rule = (VERCEL_JSON.headers || []).find((r) => r.source === source);
  assert.ok(rule, `no headers rule for source ${source}`);
  const map = {};
  rule.headers.forEach((h) => { map[h.key] = h.value; });
  return map;
}

test("vercel.json applies X-Content-Type-Options: nosniff to every path", () => {
  assert.equal(headersFor("/(.*)")["X-Content-Type-Options"], "nosniff");
});

test("vercel.json applies a real Referrer-Policy to every path", () => {
  const value = headersFor("/(.*)")["Referrer-Policy"];
  assert.ok(value && value.trim(), "Referrer-Policy must not be blank");
  assert.notEqual(value, "unsafe-url", "unsafe-url leaks the full URL cross-origin -- not a real hardening choice");
});

test("vercel.json applies a Permissions-Policy that locks down unused sensitive features", () => {
  const value = headersFor("/(.*)")["Permissions-Policy"];
  ["camera", "microphone", "geolocation"].forEach((feature) => {
    assert.match(value, new RegExp(feature + "=\\(\\)"), `expected ${feature} to be disabled`);
  });
});

// The PO backlog item this file covers (SEC-3) explicitly flagged permitted
// embedding origins as an OPEN PRODUCT DECISION, not an implementer's call
// -- and README.md's own "Deploying for real" section lists embedding this
// app in an iframe on another site as one of exactly two intended
// deployment shapes. Shipping a default frame-ancestors/X-Frame-Options
// here would silently break that for every deployment until the PO
// actually answers the question STATUS.md records as still open -- so this
// asserts the ABSENCE of both, the same way a test would assert a real
// bug's fix, to catch anyone tempted to "helpfully" add one without also
// updating that decision.
test("vercel.json does NOT set X-Frame-Options (frame-ancestors is a deliberately deferred PO decision, see STATUS.md)", () => {
  const keys = Object.keys(headersFor("/(.*)"));
  assert.ok(!keys.includes("X-Frame-Options"), "X-Frame-Options would break the documented iframe-embedding deployment shape");
});
