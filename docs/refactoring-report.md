# Squad Pulse — refactoring report

Scope: `public/app.js`, `public/local-store.js`, all of `public/js/*.js`,
`public/js/crypto.js`, `relay/server.js`. Written 2026-09-12, against the
codebase as it stands after this session's bug-fix and test-infrastructure
work — nothing here is new breakage, it's accumulated shape from the app
growing feature-by-feature (Claude Artifact prototype → standalone site →
live retro sessions) without a cleanup pass in between.

**How to use this**: nothing here is urgent — the app works, and the
21-file Playwright suite + `tests/unit/` give real cover for changing any
of it safely. Treat this as a backlog, not a fire. The "Suggested order"
section at the end ranks by risk/reward, not by section order above it.

**Status, 2026-09-12**: items 1-5 of the suggested order below are done —
see `STATUS.md`'s session log for that date. Left in this document
unmarked below (rather than edited out) so the reasoning stays visible;
the items themselves are complete. Still open: `state.editing`'s hidden
dual shape, splitting `dimensions-templates.js`, naming/abbreviation
consistency, and the `esc()` safety audit.

## Executive summary

The app's single biggest structural cost is **`retro.js` at 808 lines**,
carrying two genuinely different device roles (facilitator dashboard,
participant join screen) and at least six distinct responsibilities in one
file with no internal boundary. Its two largest functions
(`renderSessionCardHtml`, `renderJoinScreen`) are also the suite's two
highest cyclomatic-complexity hotspots. Splitting this file along the
facilitator/participant seam would fix the SRP gap, the file-size problem,
and make the complexity easier to see and reduce, all in one move.

The second biggest cost is a **repeated "write live, else write local,
then re-render" branch** copy-pasted 12+ times across `squads.js`,
`dimensions-templates.js`, and `retro.js`. This is the Open/Closed
violation with the best effort-to-payoff ratio to fix: one small helper
function removes a whole class of copy-paste risk.

Everything else below is real but lower-stakes: some duplicated
color/trend-word mappings, a few silently-swallowed errors, some
inconsistent naming, and the deliberate (documented, accepted)
global-scope architecture that makes the app untestable-in-isolation
without the `fake_dom.js` workaround `tests/unit/` already had to build.

## SOLID gaps

This app has no classes, so "SOLID" here means the practical translations:
one file/function doing one job, extension without editing every call
site, consistent behavior across interchangeable implementations, and
depending on the smallest interface actually needed.

### Single Responsibility

- **`public/js/retro.js` (808 lines)** is the standout offender. It owns:
  session start/close (`startSession`, `closeSession`), session-card
  rendering (`renderSessionCardHtml`, 94-214), ALL session-card event
  binding across seven unrelated actions in one function
  (`bindSessionCardEvents`, 227-338), reveal-mode/override/experiment-note
  logic (344-419), finish-and-apply business logic (425-436), the live
  facilitator response tally (445-463), QR rendering (468-478), and the
  **entire participant-facing join screen** — rendering, the interleaved
  survey, form binding, submission (480-808, roughly half the file). The
  facilitator and participant halves never run on the same device and
  share almost no code; they're two features that happen to both be about
  "a retro session."
- **`renderSessionCardHtml`** (retro.js:94-214) alone renders six visually
  and logically distinct pieces (empty state, live/hold toggle, live
  consolidated results, per-response table, sprint-note form, QR/link
  disclosure) in one 120-line function returning one giant string.
- **`bindSessionCardEvents`** (retro.js:227-338) binds start, close, copy,
  reveal-toggle, override, save-note, and finish handlers — seven
  independent concerns — in one function. None of these share state or
  logic with each other; they're only grouped because they all attach to
  the same rendered card.
- **`initDb()`** (`public/js/db.js:10-104`) sets up five independent
  snapshot listeners (sessions, squads, dimensions, templates, config),
  each inlining its own doc-normalization logic. Each listener's mapping
  function (e.g. the squad-doc-to-plain-object conversion at db.js:36-47)
  is a separable, independently nameable, independently testable unit
  currently trapped inside one 95-line async function.
- **`public/local-store.js`** (211 lines, one IIFE) bundles storage
  seeding, persistence, the pub/sub snapshot mechanism, doc/collection ref
  construction, relay-vs-local routing, cross-tab sync, and the CSV
  download shim, with no internal seams at all.
- **`public/js/dimensions-templates.js`** combines two features — the
  dimension manager (7-118) and the template library (120-286) — that this
  project's own convention elsewhere treats as separate files (compare
  `squads.js` vs `retro.js`, which are already split along exactly this
  kind of feature boundary).

### Open/Closed

- **The "write live, else write local + render" branch is duplicated
  12+ times**, near-verbatim, across `squads.js` (renameSquad:5-13,
  removeSquad:15-21, addSquad:23-36), `dimensions-templates.js`
  (updateDimensionField:66-78, moveDimension:80-93, addDimension:95-108,
  removeDimension:111-118, saveCurrentAsTemplate:189-214,
  deleteTemplate:216-222), and `retro.js` (startSession:22-54,
  closeSession:75-92, setRevealMode:344-354, setSessionOverride:361-375,
  saveExperimentNote:410-419). Adding a new persistence backend, or
  changing what "local fallback" means, requires editing every one of
  these individually. A single `persistOrLocal(liveAction, localAction)`
  helper would collapse all of them.
- **Dimension "shape" (statement-based vs. direct-rating) is an implicit
  type discriminated by `dim.statements && dim.statements.length`**,
  checked independently in at least six places: `helpers.js:100`
  (bandForResponse), `helpers.js:141/147` (statementDimensions/
  directRatingDimensions), `retro.js:107` (activeDims.length check),
  `retro.js:632/643` (statementListHtml/directListHtml), and
  `dimensions-templates.js:33`. A third dimension shape (e.g. a numeric
  slider) would mean finding and updating all six sites rather than one.
  Centralizing behind a single named predicate (`isStatementDimension(d)`)
  now would make that future extension mechanical instead of
  archaeological.

### Liskov Substitution

- This is actually a **strength** worth naming: `local-store.js`'s
  `localDocRef`/`localCollRef` and `relay-client.js`'s `docRef`/`collRef`
  are deliberately built to the same Firestore-shaped contract as the real
  Claude Artifact `db` capability, and the whole app is proof it works —
  three interchangeable backends, verified by the same upstream code
  (`db.js`, `retro.js`) needing zero changes across all three.
- One asymmetry worth flagging: `relay-client.js`'s snapshot objects carry
  an extra `unavailable` boolean (added this session — see
  `relay-client.js:213-230`) that `local-store.js`'s snapshots never set.
  Every current caller treats it as optional and this works fine today,
  but it's a place where the three "interchangeable" implementations have
  quietly drifted from perfect parity — worth a comment at the contract's
  definition site (there isn't one written down anywhere as a single
  source of truth) so a future fourth backend doesn't have to
  reverse-engineer which fields are actually part of the contract.

### Interface Segregation / Dependency Inversion

- Every feature file depends on the single, undifferentiated global
  `state` object and the concrete `document`/`window` globals directly —
  there is no seam between "the logic that needs squads" and "the logic
  that needs sessions," for example. **This is a deliberate, documented
  trade-off** (`STATUS.md`, `README.md`: plain classic scripts sharing one
  scope, chosen specifically to avoid the `file://` ES-module CORS
  problem), not an oversight — but it's the direct cause of the
  `tests/unit/fake_dom.js` workaround this session had to build just to
  `require()` two files in Node, and it means every mutation function
  "knows" which render functions to call afterward (see next point) rather
  than that being inverted into a single reactive update path.
- Concretely: `renameSquad` (squads.js:5) calls `renderAll()` itself;
  `updateDimensionField` (dimensions-templates.js:66) calls
  `renderAll(); renderDimList();` itself; `setSessionOverride` doesn't
  render at all in its live branch (relies on the snapshot listener) but
  does in its local branch. Which views to refresh after which mutation is
  decided ad hoc, per call site, rather than by one consistent rule — this
  is exactly the class of bug the `setView()`/`renderAll()` fix from
  earlier this session was patching (state changed while nobody was
  listening to refresh the right view).

## Cyclomatic complexity

Rough branch counts (if/else, ternaries, `&&`/`||` short-circuits used as
control flow, loop bodies with their own branching) for the highest-signal
functions:

| Function | Location | Est. complexity | Why |
|---|---|---|---|
| `renderSessionCardHtml` | `retro.js:94-214` | ~18-20 | Empty-state branch, live-vs-hold branch, per-dimension ternary chain (×3 sub-branches) inside a `.map()`, response-table conditional, finish-button ternary, all fused into one returned string |
| `renderJoinScreen` | `retro.js:574-673` | ~15-17 | Five sequential early-return states (connecting / closed / can't-connect / not-open / already-submitted) plus nested statement/direct rendering with their own per-item ternaries |
| `bindStatementForm` | `retro.js:685-791` | ~10-12 | Two parallel completion-tracking paths (statement drafts vs. direct-rating drafts) merged into one `refreshSubmitEnabled`, each with its own iteration and validity check |
| `buildImportPlan` | `csv.js:141-188` | ~10-12 | Per-row validation chain (squad/dim presence → key-then-label fallback → not-found reporting → new-vs-existing squad tracking → template-name collection), all in one `forEach` body |
| `loadTemplate` | `dimensions-templates.js:224-286` | ~10 (mostly async-chain complexity, not raw branching) | Three chained `.then()`s each doing structurally different work (delete stale dims → write new dims → write config), live/local top-level branch, set-difference calc for what to delete |
| `bindSessionCardEvents` | `retro.js:227-338` | Low per-branch, high *fan-out* (7 independent handlers in one function) | Not "complex" in the branching sense — complex in the sense that reading it requires holding 7 unrelated features in your head to find the one you need |
| `connectRoom`/`getRoom` | `relay-client.js:81-177` | ~10-12, but *appropriately* so | A real retry/backoff/give-up state machine — this is legitimate complexity for what it does, already well-commented, not flagged as a smell |

**A repeated pattern that inflates several of the above artificially**:
color/trend-to-word ternary chains like
`color==="good"?"Green":color==="warn"?"Yellow":color==="crit"?"Red":"Not yet scored"`
appear near-verbatim in `render.js:140`, `squads.js:117`, and
`retro.js:143` (a slightly shorter variant), plus the trend equivalents
alongside each. `csv.js` already has the *inverse* mapping cleanly
centralized (`colorFromWord`/`trendFromWord`, csv.js:95-108) — the forward
direction never got the same treatment. Extracting `colorWord(color)` /
`trendWord(trend)` into `helpers.js` would cut real complexity out of
`render.js`, `squads.js`, and `retro.js` simultaneously, not just tidy
them.

## Naming gaps

- **`state.editing` is overloaded** to mean two different things — a
  squad-cell edit and a session-override edit — discriminated by an easy
  -to-miss `mode: "session"` flag (set at `retro.js:387`, checked once at
  `modals.js:88`). A reader looking at `openEditor` (modals.js:32) has no
  way to know `state.editing`'s shape secretly varies elsewhere in the app
  unless they've already found `openSessionOverrideEditor`. Either two
  separate state slots (`state.editingCell` / `state.editingOverride`) or
  a more prominent shared name (`state.activeEditor`) would surface this.
- **No consistent verb convention for "persist" vs "domain action."** Some
  mutators are named after the user-facing action (`renameSquad`,
  `addDimension`, `closeSession`) while the ones that specifically write
  through to the backend are named after the mechanism
  (`persistDimensionRating`, `persistDimensionRatings`). Both patterns are
  fine individually, but they're mixed without a rule for which name style
  a new mutator should follow.
- **`local-store.js`'s name undersells what it does.** Its own header
  comment is honest and thorough about this (it's really a `window.claude`
  shim that routes some paths to `localStorage` and others to the relay),
  but the filename alone reads as "just a localStorage wrapper" — someone
  navigating by filename would reasonably miss that this is also the
  app's one and only backend-routing point.
- **`renderQrInto(el, text)`** (retro.js:468) is the one rendering
  function in the codebase that takes a target element and mutates it
  directly, versus the dominant convention elsewhere of `render*Html(...)`
  functions that return a string for the caller to assign. The `Into`
  suffix is doing the work of signaling that difference, but it's the only
  place this convention exists, so it reads as a one-off rather than an
  established second pattern.
- **Abbreviation inconsistency**: `sq`/`squad`, `sess`/`session`,
  `dim`/`d`/`dimension` are all used for the same concept, sometimes
  within the same function's own parameter list vs. its body. Not
  incorrect anywhere, just adds a small amount of re-parsing cost moving
  between files.
- **Magic strings with no central definition**: session status
  (`"open"`/`"closed"`), reveal mode (`"hold"`/`"live"`), color bands
  (`"good"`/`"warn"`/`"crit"`), and view names (`"tribe"`/`"squad"`/
  `"admin"`) are all bare string literals, repeated at every comparison
  site, with nothing that would catch a typo (`"Open"` instead of
  `"open"`) at the point it's introduced rather than as a silent runtime
  bug. Not unique to this codebase, but worth a `STATUS = {OPEN:"open",
  CLOSED:"closed"}`-style constants object if this grows further.

## Other

- **Near-duplicate functions**: `persistDimensionRating` and
  `persistDimensionRatings` (`squads.js:168-212`) are ~90% identical code
  (single-key patch vs. multi-key patch, otherwise the same
  write/then/catch/fallback shape). `persistDimensionRating(sq, key)`
  could simply call `persistDimensionRatings(sq, [key])`.
- **Inconsistent error handling depth**: several mutators use a bare
  `.catch(function(){})` that silently swallows failures with no
  diagnostic trace at all — `renameSquad` (squads.js:11),
  `removeSquad` (squads.js:19), `removeDimension`
  (dimensions-templates.js:116), `deleteTemplate`
  (dimensions-templates.js:220), `moveDimension`'s two writes
  (dimensions-templates.js:90-91). This is inconsistent with the rest of
  the app, which is otherwise disciplined about routing every failure
  through `diag()` (as this session's own bug-hunting repeatedly depended
  on). A rename or delete that silently fails to persist would currently
  leave zero trace to debug from.
- **Markup-safety depends entirely on remembering `esc()`** at every
  interpolation site, since there's no templating layer enforcing it —
  a deliberate, reasonable trade-off for a no-build-step app, but it means
  a missed `esc()` call on a new interpolated field is a silent XSS
  opening, not a caught error. Worth a dedicated audit pass (grep every
  `+esc(` and every raw `+d\.`/`+sq\.`/`+sess\.` string interpolation and
  confirm each user-controlled value passes through `esc()`) rather than
  trusting it by convention going forward — this report didn't do that
  audit exhaustively and flags it as a follow-up, not a confirmed finding.
- **Module-level mutable variables living outside `state`**:
  `startingSessionFor` (retro.js:225), `sessionResponsesUnsub`/
  `sessionResponsesFor` (retro.js:443-444), `pendingImportPlan` (csv.js:49),
  `dimTooltipEl` (render.js:202) are all free-floating mutable globals
  parallel to, but not inside, the single `state` object the rest of the
  app disciplines itself to use. Arguably fine as-is (these are genuinely
  ephemeral, non-recoverable UI bookkeeping, not board data), but the rule
  for "what belongs in `state` vs. a bare module variable" is currently
  unwritten, not enforced.
- **`retro.js`'s size is itself a finding**, independent of the SRP issues
  above: even with every function inside it perfectly single-purpose, 808
  lines in one file is a real navigation cost, and it already has an
  obvious, low-risk split along the facilitator/participant device-role
  boundary that this report's SRP section describes.

## Suggested order

Ranked by risk/reward, not by section order above — all of these are
covered by the existing 21-file Playwright suite plus `tests/unit/`, so
each can be done and verified independently:

1. **Extract the shared `persistOrLocal()` helper** and apply it to the
   12+ duplicated live/local branches. Smallest, safest change; removes
   the most copy-paste risk for the least code touched.
2. **Centralize `colorWord()`/`trendWord()`** in `helpers.js`, replacing
   the duplicated ternary chains in `render.js`, `squads.js`, `retro.js`.
   Also small and safe; directly reduces the complexity numbers in the
   table above.
3. **Split `retro.js`** along the facilitator/participant seam (e.g.
   `retro-facilitator.js` for session start/close/card/overrides/tally,
   `retro-join.js` for the participant screen/survey/submission). Bigger,
   but mechanical — the two halves already share almost no state or
   functions, so this is closer to "move code" than "redesign code."
4. **Give the dimension-shape check a name** (`isStatementDimension(d)` in
   `helpers.js`) and use it everywhere `dim.statements && dim.statements.
   length` is currently inlined. Small, and directly closes the
   Open/Closed gap for any future third dimension shape.
5. **Add diagnostics to the currently-silent `.catch(function(){})`
   sites** listed under "Other" above — trivial, one line each, and
   directly useful the next time one of those actions fails in the field.
6. Everything else here (naming, `state.editing`'s overload, splitting
   `dimensions-templates.js`, the `esc()` audit) is worth doing but lower
   urgency — good candidates for "next time you're already touching that
   file" rather than a dedicated pass.
