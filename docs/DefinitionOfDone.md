# Definition of Done

This is the standing quality bar every change in this repo clears before it's
called done — regardless of which feature or story it belongs to. It's
deliberately short and current, not a growing log; update it in place via a
normal PR when a working agreement changes.

How this relates to the repo's other reference docs, so nothing here gets
duplicated or contradicted elsewhere:

- **`STATUS.md`'s "Decisions locked in"** is *what* has been decided
  (architecture, product behavior) — e.g. self-hosted relay, no persistent
  database. This document is the bar *every* change clears, whatever it's
  building.
- **`.claude/skills/tdd/SKILL.md`** is the detailed *how* for this doc's
  Testing section — which of the two test tiers a behavior belongs in, how
  to build a Playwright test page, etc. This document states the rule; that
  skill is the workflow for satisfying it.
- **`docs/facilitated-retro-spec.md`** is a feature-specific behavior spec
  (the retro-session flow) with its own history — not a "done" policy.

## 1. Testing

- Every change to `public/js/*.js`, `public/local-store.js`, or `relay/*.js`
  gets a **failing test written before the implementation** — see the `tdd`
  skill for which tier it belongs in and how to write it. The one narrow
  exception, and the discipline that replaces "write it first" there: a
  structure-only refactor (a rename, a file split/move) that changes no
  observable behavior — see the `tdd` skill's own "behavior change vs.
  structure-only refactor" section for exactly what qualifies and what's
  required instead (confirm existing coverage first, write a
  characterization test if it's missing, never mix in a discovered bug
  fix). This bullet is the rule for everything else — a bug fix, a new
  feature, any change to what the code does. (Cross-reference added
  2026-09-17 after a Codex review pointed out the `tdd` skill's refactor
  exception, added the same day, wasn't reflected here at all — a reader
  of this document alone would have concluded no exception exists.)
- Before calling any change done, run the **full suite**
  (`node --test tests/unit/test_*.js` and `tests/run_all.sh`), not just
  whatever test you added or touched — zero regressions, zero JavaScript
  errors.
- **Before opening a PR, re-read your own diff adversarially against the
  checklist below and address what it finds** (fix a real one; for a
  finding you disagree with, say why in the PR rather than silently
  dropping it). This is a self-review pass, not a replacement for external
  review — its job is to catch what a second pass over your own diff would
  catch before an external reviewer has to. Stated as a checklist, not a
  named tool, because this rule binds every contributor to this repo —
  Copilot, Codex, Claude Code, or a human — and only some of those have a
  built-in "code review" capability to invoke by name (a Claude Code
  session does: its own `code-review` skill runs this same class of check
  and is the fastest way to satisfy this bullet when it's available, but
  it is a convenience, not the requirement itself — anyone without it
  still clears this bullet by walking the checklist directly):
  - Does every `Promise.all(...)` in the diff need to be
    `Promise.allSettled(...)` instead — would one rejection hide another
    still-pending write?
  - Does every new/changed Playwright wait use a real, causally-correct
    condition, per this section's own fixed-timer rule below — not a
    `wait_for_timeout()` standing in for one?
  - Does every factual claim the diff adds to a doc or comment ("X returns
    Y," "Z is forwarded to W") have a test that actually proves it, not
    just a reading of the source?
  - Does the diff match what its own PR description/commit message claims
    it does — no leftover debug code, no silently wider scope than
    described?
  (Adopted 2026-09-17, revised same day after a Codex review of the first
  version pointed out it named a Claude-Code-specific skill as a repo-wide
  requirement with no equivalent for a contributor who can't invoke it —
  see STATUS.md's session log. Originally motivated by a run of PRs each
  drawing at least one real finding from external review that this same
  checklist would plausibly have caught first.)
- **When the full suite's total serial wall-clock time is measured and has
  moved meaningfully since the last figure recorded in STATUS.md, log the
  new number there.** This isn't a gate — no change is blocked on it — but
  a rising trend is the signal to suggest a dedicated performance pass, the
  same way the 2026-09-15 wait-condition pass above got started: Copilot's
  own serial timing (146.910s, then corrected after a stale-checkout
  re-run) is what named the slowest files worth looking at, not a hunch.
- **That signal needed a real trigger, not just a note to log — this
  is the growth-budget agreement.** The bullet above stayed passive too
  long: `run_all.sh` grew from ~102.5s to over 5 minutes, one
  individually-defensible `wait_for_timeout()` at a time, added to one
  new test after another, before anyone stopped to treat the trend
  itself as a problem — the eventual fix (the 2026-09-15 wait-condition
  pass, run in two sessions) cost far more than catching each file would
  have at the time it was written. `tests/run_all.sh` now times itself
  and checks the result against `tests/.timing_baseline`, printing a loud
  warning if the full suite runs more than 15% over that number — so the
  signal shows up on every run, for every contributor, without anyone
  having to remember to time it by hand. If you see that warning: grep
  `tests/test_*.py` for new `wait_for_timeout()` calls added since the
  baseline was last set and fix the ones lacking the justification the
  next bullet requires, before adding more Playwright files in the same
  pattern. If the growth is legitimate (a real increase in file count,
  not slop), update `tests/.timing_baseline` to the new number and say so
  in STATUS.md. **This applies equally to every contributor working in
  this repo — Copilot, Codex, Claude Code, or a human writing a test by
  hand** — none of them can be expected to notice a compounding trend
  from their own one new test in isolation, so the check has to live
  where the suite itself runs, not in any one tool's own habits.
- A Playwright test earns its slower cost only when it covers something a
  unit test structurally can't (real DOM, `localStorage`, a real WebSocket,
  `crypto.subtle`) — see `tests/README.md`'s "Performance" section before
  adding one that would only re-check already-unit-tested logic.
- Build any Playwright test page via `tests/fixtures/build_page.py`'s
  `build_page()` / `write_plain_index()` / `build_custom_page()` — never by
  hand-splicing `public/index.html`.
- **A Playwright wait uses a real, causally-correct condition —
  `wait_for_selector`, `wait_for_function`, or Playwright's own auto-wait on
  `click()`/`fill()` — never a fixed `wait_for_timeout()`, unless no
  positive signal can exist** (proving an absence — a rainy-day check that
  something never arrives — or a genuinely undocumented async gap with no
  better option). Any wait that stays fixed carries a comment explaining
  why, not just what. (Adopted 2026-09-15 after a pass converting roughly
  130 fixed sleeps across 13 test files caught two real bugs a
  passing-but-sleep-padded test had been silently hiding: a
  `wait_for_selector`'s default `state="visible"` failing on a hidden
  duplicate element, and a busy-overlay transition that completes within
  the same JS turn as the click triggering it — invisible to any external
  CDP-based poll. Neither would have surfaced without actually removing the
  sleep and asking what condition it was standing in for. See STATUS.md's
  session log for both.)
- **Changing a test's wait/timing logic (not just adding a new assertion)
  gets stress-tested at least 10x clean (15x for relay-backed or
  multi-device tests) before it's considered done.** This is a check on the
  file you're changing, during that change's own dev cycle — it does not
  lengthen the standing full-suite regression run. A single clean pass is
  not evidence a timing change is correct: both bugs in the rule above
  passed clean on their first run and only surfaced under repetition.

## 2. Multi-language support

The Admin panel (Story 2) and Tribe view/Squad view/the rating modal
(Story 4, 2026-09-13) are this app's i18n-supported screens so far; the
same rules apply to every screen a future story brings under translation,
and to every one already covered:

- **English (`public/js/locales/en.js`) is the source of truth.** Every
  user-facing string on an i18n-supported screen goes through `t(key, vars)`
  — `data-i18n`/`data-i18n-placeholder` for static markup, a direct `t()`
  call for anything built in JS (aria-labels, confirm dialogs,
  unit-interpolated strings). No new hardcoded English string ships on an
  i18n-supported screen.
- **Every supported locale carries every key.** Adding, removing, or
  changing a translatable string updates `en.js` AND every other locale
  file (`he.js` today; more as they're added) in the same change.
  `tests/unit/test_i18n.js`'s key-parity check enforces this mechanically —
  a change that adds an English string without its counterpart in every
  other locale fails that test. The check catches *missing or blank*, never
  *wrong*: translation quality is still a human read-through (see
  `locales/he.js`'s own header comment) — this rule guarantees nothing
  ships half-translated, not that the wording is right.
- **English fallback must keep working for any locale**, not just Hebrew
  specifically — `t()`'s fallback-to-English behavior, and the
  `SUPPORTED_LOCALES` list it's driven by, stay generic so a future
  third language mid-rollout degrades the same way Hebrew does today.
- **User-entered data keeps `dir="auto"`, scoped to ONLY that content** —
  never on a container shared with a hardcoded label. (The exact bug Story
  1 found and fixed: `render.js`'s Tribe legend and `retro-join.js`'s
  direct-rating anchors both had a hardcoded English "Green:" prefix
  sharing a `dir="auto"` `<p>` with the translated content behind it,
  which forced the whole line `ltr` regardless of what that content was.
  Fix: wrap the label and the content in separate elements; put
  `dir="auto"` only on the one holding user-entered or translated content.)
- **No hardcoded directional CSS** (`margin-left`/`margin-right`/
  `padding-left`/`padding-right`) **near text, anywhere in the app** — not
  only on i18n-supported screens. Use `gap`/flexbox/grid layout, or logical
  properties (`margin-inline-start`, etc.), so spacing stays correct the
  moment a screen is later flipped to `rtl`. (Found and fixed once already:
  the Admin panel's own "Language / Beta" heading badge.) Applied
  repo-wide rather than screen-by-screen because the cost of doing it right
  from the start is close to zero, and the alternative is re-discovering
  the same bug on every future screen that gets translated.
- A newly i18n-supported screen's `dir`/`lang` attributes are scoped to
  that screen's own container (e.g. `#viewAdmin`), not the document root,
  until every screen is translated — a page-wide RTL flip before then would
  visibly break whatever's still English-only. A still-English WIDGET
  embedded inside a translated container (e.g. the retro session card
  embedded in `#viewSquad`, Story 4) sets its own `dir="ltr"` on its root to
  opt back out, rather than rendering mirrored English text.
- **Interpolated values in a translated string must not leak their own
  directionality into the surrounding sentence.** `t(key, vars)` wraps
  every substituted value in Unicode bidi isolate marks (U+2066 LRI /
  U+2069 PDI) for exactly this reason — found as a real bug in Story 4:
  `"{count} {unit} tracked"` rendered with `{count}` and `{unit}` visually
  swapped once the Hebrew sentence around them took over the paragraph's
  bidi resolution, even though `.textContent` (the logical string) was
  correct throughout — only the on-screen rendering was scrambled. Two
  corollaries, both learned the same way: (1) isolating two adjacent
  placeholders SEPARATELY doesn't help if nothing but neutral punctuation
  (a space, a `/`) sits between them — e.g. a `"{scored}/{total}"`
  fraction needs the whole fraction built as ONE value and isolated once,
  not built from two independently-isolated numbers; (2) a value with NO
  strong-direction character at all (a bare numeric ratio like `"2.0 / 3"`,
  no isolate involved) still gets visually reversed by an RTL ancestor and
  needs its own explicit `dir="ltr"`, the same fix as `#statAssessed`'s.
  Any future code that builds translated strings without going through
  `t()`'s interpolation must reproduce this, not silently drop it.
- Existing tests asserting exact `.textContent` on a string that now flows
  through `t()` need their assertions updated for the (invisible, harmless)
  isolate marks above — strip them before comparing (see
  `test_tribe_hotspots.py`'s `strip_bidi()` helper) rather than asserting
  against plain ASCII that no longer matches.

## 3. Delivery workflow

- **`claude/optimistic-keller-holuql` is the shared PREVIEW branch, not any
  one session's individual workspace.** Do a unit of work on your own
  short-lived branch, branched from the current tip of
  `claude/optimistic-keller-holuql` — do not commit directly to it while
  work is in progress. When the work is done and validated (full suite
  green per the Testing section above), fetch the latest
  `claude/optimistic-keller-holuql`, merge it into your branch (resolving
  anything that needs it, re-validating afterward), then merge your branch
  into `claude/optimistic-keller-holuql` and push that. Delete your branch
  once it's merged. (Adopted 2026-09-13 after several real collisions —
  two concurrent sessions and a local checkout all committing straight to
  `claude/optimistic-keller-holuql` at once, needing repeated manual merges
  to untangle. See STATUS.md's session log for the incident.)
- **A branch isn't "landed" until its PR is open (or it's merged) — never
  push a branch with a complete, tested fix and end the session there.**
  A branch that only exists on origin, with no PR, is indistinguishable
  from a lost branch to every other session, tool, or person working in
  this repo — nothing surfaces it, nothing links it to the backlog item it
  closes, and a parallel effort can complete the same work again without
  ever knowing it already existed. Before ending a session that pushed one
  or more branches, confirm each one has an open PR or has already
  merged — `gh pr list --head <branch> --state all` (or the equivalent
  GitHub MCP `list_pull_requests` call with `state: "all"`), not the bare
  `--head <branch>` form: it defaults to open PRs only, so it silently
  reports `[]` for a branch whose PR already merged — confirmed against
  `ref-3-board-sync-state-machine` (PR #23, merged): the bare form returns
  nothing, `--state all` returns it. Once found with `--state all`, confirm
  it's genuinely MERGED, not just closed unmerged — `gh pr list`'s own
  STATE column (and the GitHub MCP `list_pull_requests` tool's own
  `merged` field) can't always be trusted for this distinction; the
  single-PR `gh pr view <number>` (or the MCP `pull_request_read` tool's
  `get` method) reports the real `merged` boolean reliably. If a session
  genuinely runs out of room to open the PR itself, say so explicitly in
  `STATUS.md`'s session log (branch name,
  what it contains, why the PR wasn't opened) rather than leaving it
  silent. (Adopted 2026-09-17 after a full branch audit — prompted by the
  PO reporting that this session, another Claude Code session, Codex, and
  VSCode each had a different view of what was done — found three
  branches, `sec-1-relay-abuse-bounds`, `perf-1-idle-tab-sync-loop`,
  `sec-2-crypto-session-codes`, pushed to origin with complete, tested
  fixes and no PR ever opened; they sat invisible while a parallel effort
  merged as PR #14 without them. See STATUS.md's session log for the full
  incident and how it was ported back in.) Run this same check — every
  remote branch has an open PR or is merged — as a normal part of any
  session that's about to do a broad status review or backlog cleanup,
  not only after confusion has already been reported; it's cheap (one
  branch listing, one PR listing, diffed against each other) and it's the
  only thing standing between a real fix and it quietly disappearing.
- **Before acting on another agent's or tool's analysis of "current" repo
  state — a bot-generated performance ranking, a static-analysis report,
  anything claiming to describe what's slow/broken/present right now —
  confirm it was generated against the current tip of the shared branch,
  not a stale checkout.** (Adopted 2026-09-15 after Copilot handed back a
  "top 10 slowest tests" ranking computed before syncing to a pull, with
  timings and file names that no longer matched what had already shipped —
  harmless here since it self-corrected on its own re-check, but exactly
  the kind of stale read that could otherwise send real effort at an
  already-solved problem.)
- **When a test-timing report from another machine can't be reproduced,
  check both environments' Playwright/Chromium versions (`pip show
  playwright`, or `playwright --version`) before concluding it's a real
  bug, a flake, or a harness artifact.** `tests/requirements.txt` pins the
  version this repo expects, precisely so that question has a fast answer
  instead of staying an open guess. (Adopted 2026-09-15 after two
  same-day cross-machine disputes over `test_retro_experiment_note_and_
  finish.py` -- one environment's own request for a fully-instrumented
  reproduction, wrapping the actual `db.collection().doc().update()` call
  chain, still couldn't reproduce the reported failure after 26 clean
  runs, which pointed at a silently unpinned Playwright/Chromium version
  as the more likely explanation than a real code bug.)
- **`main` only moves when the product owner explicitly says so** — never
  push to `main` on your own judgment. This is unchanged by the branching
  model above: `claude/optimistic-keller-holuql` is a PREVIEW branch, not a
  path around that gate.
- A real, non-trivial change gets a session-log entry in `STATUS.md` (see
  nearly every existing entry for the expected level of detail: what
  changed, why, what it fixed, and what was verified).
- **A genuine architecture or UX decision — something the product owner
  would want to see and react to before engineering time goes into it, not
  a call you can make yourself — gets a working mockup, not a text
  description, before implementation starts.** Build it as a real HTML
  page/Artifact that reuses the app's actual design tokens (`styles.css`'s
  CSS variables, its real fonts) and, wherever the proposal is interactive
  (a toggle, an expand/collapse, a tab), make that interaction actually
  work in the mockup rather than describing it in prose — a mockup the
  product owner can click is a much shorter round-trip than a written
  description they have to imagine and then correct. Ground it in the
  app's own real content (an existing template's real dimension, real
  copy) rather than lorem ipsum or a generic example. Call out open
  questions the mockup itself doesn't resolve directly in the mockup, not
  buried in a chat message. (Adopted 2026-09-14, after the bilingual-
  dimensions proposal below — see STATUS.md's session log — got a clear
  "go ahead" specifically because it was reviewed as a working page, not a
  paragraph.)
- **A change that introduces a new data shape (a new field, a new nesting,
  a moved value) explicitly decides whether existing stored data needs a
  migration path, and says so out loud — in the STATUS.md entry, or in the
  PR/change description — rather than leaving it implicit.** Before this
  product is out in real use, "no migration needed, nothing real depends
  on the old shape yet" is a perfectly good answer — but it must be a
  stated decision, not an oversight discovered later. Once real boards
  exist, the same question needs a real answer, not the same default.
