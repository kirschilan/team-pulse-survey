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

The Admin panel is this app's first i18n-supported screen (Story 2,
2026-09-13); the same rules apply to every screen a future story brings
under translation, and to every one already covered:

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
  visibly break whatever's still English-only.

## 3. Delivery workflow

- Development happens on the project's working branch; `main` only moves
  when the product owner explicitly says so — never push to `main` on your
  own judgment.
- A real, non-trivial change gets a session-log entry in `STATUS.md` (see
  nearly every existing entry for the expected level of detail: what
  changed, why, what it fixed, and what was verified).
