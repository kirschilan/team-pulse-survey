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
  skill for which tier it belongs in and how to write it.
- Before calling any change done, run the **full suite**
  (`node --test tests/unit/test_*.js` and `tests/run_all.sh`), not just
  whatever test you added or touched — zero regressions, zero JavaScript
  errors.
- A Playwright test earns its slower cost only when it covers something a
  unit test structurally can't (real DOM, `localStorage`, a real WebSocket,
  `crypto.subtle`) — see `tests/README.md`'s "Performance" section before
  adding one that would only re-check already-unit-tested logic.
- Build any Playwright test page via `tests/fixtures/build_page.py`'s
  `build_page()` / `write_plain_index()` / `build_custom_page()` — never by
  hand-splicing `public/index.html`.

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
- **`main` only moves when the product owner explicitly says so** — never
  push to `main` on your own judgment. This is unchanged by the branching
  model above: `claude/optimistic-keller-holuql` is a PREVIEW branch, not a
  path around that gate.
- A real, non-trivial change gets a session-log entry in `STATUS.md` (see
  nearly every existing entry for the expected level of detail: what
  changed, why, what it fixed, and what was verified).
