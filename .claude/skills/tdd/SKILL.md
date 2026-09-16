---
name: tdd
description: Test-first workflow for this repo (team-pulse-survey). Use this before writing or editing any code under public/js/, public/local-store.js, or relay/ — for a bug fix, a new feature, or a refactor. Decides which of this repo's two test tiers a behavior belongs in, and enforces writing that test BEFORE the implementation. Also use when asked to add a test, when reviewing whether a Playwright test duplicates unit coverage, or when a change feels done but hasn't been proven against the full suite yet.
---

# Test-first in this repo

This skill is the detailed how-to for `docs/DefinitionOfDone.md`'s Testing
section — that doc states the standing rule (test-first, correct tier, full
suite green before calling anything done); this skill is the workflow that
satisfies it.

This is a working agreement, not general TDD advice: **write the failing
test before the implementation**, for every change to `public/js/*.js`,
`public/local-store.js`, or `relay/*.js`. That's the product owner's
explicit policy going forward — treat "I'll add tests after" as not
satisfying the request, even when the fix looks obviously correct.

The reasoning matters more than the rule: a test written to describe the
behavior you're *about* to build tends to actually verify that behavior. A
test written after, by someone who already knows what the code does, tends
to just confirm the code does what it does — which catches nothing. A real
example from this repo: `relay-client.js`'s `putDoc()` silently encrypted
every board write with the wrong key for a while. It surfaced only because
a new test tried to prove a SECOND device could actually decrypt what the
first device pushed — a weaker test (does the write not throw?) would have
stayed green through the whole bug.

## Step 1: pick the tier before writing anything

This repo has two test tiers with very different costs and reach — get
this decision right first, since it decides where the test even goes.

**`tests/unit/*.js`** (Node's built-in `node:test`, no browser, runs in
~0.1s) — for a PURE function: given these inputs, what does it return?
No DOM, no `localStorage`, no network, no `crypto.subtle`. Examples
already in this repo: `helpers.js`'s consolidation/scoring math
(`consolidateBand`, `bandForScore`, `effectiveDimResult`),
`board-export-import.js`'s JSON import plan-building and validation
(`buildSquadImportPlan`, `buildDimensionImportPlan`,
`parseBoardImportFile`), `board-sync.js`'s `parseTeamSecretInput`/`teamLinkFor`.
If what you're building is "a function that transforms data," it almost
certainly belongs here, even if the function is *called from* UI code —
see `tests/unit/README.md` for the `require()`-the-real-file +
`fake_dom.js` pattern that lets these tests import the actual
`public/js/*.js` file directly (these are plain scripts sharing one global
scope, not ES modules, so `fake_dom.js` stubs `document`/`window` enough
for `require()` to not choke on the file's own top-level DOM wiring).

**`tests/test_*.py`** (Playwright, real Chromium, seconds not
milliseconds) — for anything a unit test structurally cannot reach: real
DOM rendering and interaction, `localStorage` (including cross-tab
`storage` events), a real WebSocket against `relay/server.js`, or
`crypto.subtle`. If the question is "does clicking this button produce the
right DOM/state change," or "does this survive a real page reload," or
"does data really travel encrypted between two browser contexts," it
belongs here.

When a change touches both (a new pure function AND new UI wired to it),
write both tests — the unit test for the function's own correctness, the
Playwright test for the wiring being connected correctly. Don't let the
Playwright test re-verify the function's logic in detail; that's what the
unit test is for.

### Before adding a new Playwright test, check for existing unit coverage

If the ONLY thing a planned Playwright scenario would check is already
provable via a unit test on the same underlying function — e.g. a
scenario that uploads an import file, looks at the resulting preview text,
and clicks Cancel, never applying or rendering anything further — it
doesn't earn its slower, real-browser cost. This isn't hypothetical: a
scenario exactly like that was found and removed from a Playwright import
test once a unit test was confirmed to cover the same matching logic
directly, and the file's other scenario already proved the
preview-rendering pipeline itself works. See `tests/README.md`'s
"Performance" section for the fuller writeup and the reasoning for when a
Playwright test IS still worth it even with unit coverage underneath (e.g.
it also applies the result and verifies real state, or it exercises a
rendering branch nothing else does).

## Step 2: write the test, watch it fail for the right reason

Write the test against the behavior you're about to build, then run just
that test and read the failure. It should fail because the behavior
doesn't exist yet (an assertion mismatch, an element not found) — not
because of a typo, a missing import, or a setup mistake in the test
itself. If you can't tell why it's failing, fix the test until you can.

For a Playwright test, build the page via `tests/fixtures/build_page.py`'s
`build_page()` / `write_plain_index()` / `build_custom_page()` — never by
reading `public/index.html` directly and splicing your own script in by
hand. That bypasses a Google Fonts `<link>` strip those helpers apply, and
doing it anyway is a proven, real bug, not a theoretical one: it once cost
one test file an extra ~12 seconds on every single run before anyone
noticed (see `STATUS.md`'s session log entry on the 2026-09-12 perf pass).
`build_custom_page(extra_head_html, out_name)` exists specifically for a
test that needs its own bespoke fake store shape instead of the shared
`fake_store.html`.

## Step 3: write the minimal code to make it pass

Resist building more than the failing test demands. If you notice another
gap while you're in there, write another test for it rather than quietly
widening the implementation to cover a case nothing is checking.

## Step 4: refactor with the test as your safety net, keep it green

## Step 5: run the FULL suite before calling it done

Not just your new test — both tiers, in full:

```
node --test tests/unit/test_*.js
for f in tests/test_*.py; do python3 "$f" || echo "FAILED: $f"; done
```

This project's own established convention (see nearly every entry in
`STATUS.md`'s session log) is a full-suite, zero-regression run after
every change, however small. A change that only re-runs its own new test
has not actually confirmed it left everything else alone.
