# CLAUDE.md

Essential pointers for Claude Code (or any other AI agent) working in this
repo — read these before making a change, not this file's own prose:

- **`docs/DefinitionOfDone.md`** — the standing quality bar every change
  clears (testing, multi-language support, delivery workflow) before it's
  called done. When in doubt about whether something is finished, this file
  is the answer, not a judgment call.
- **`STATUS.md`** — current state, locked-in architecture/product decisions,
  and what's deliberately not built yet. Read this before starting any
  non-trivial change. The dated session log of past work lives in
  `docs/session-log.md` (split out 2026-09-18 to keep this file itself a
  one-page entry point) — append a dated entry there after finishing a
  change, not in `STATUS.md`.
- **`.claude/skills/tdd/SKILL.md`** — the test-first workflow (which of the
  two test tiers a behavior belongs in, how to build a Playwright test page)
  that satisfies the Definition of Done's Testing section.
- **`tests/README.md`** / **`tests/unit/README.md`** — how the two test
  tiers are organized, named, and run.
- **`README.md`** — project overview, running locally, deploying.
- **`ETHICS.md`** — secrets handling, attribution honesty, and other
  standing ethical/security-hygiene rules for anyone working in this repo.
- **`ETHICS_AGREEMENT.md`** — Dr. Agile's canonical stakeholder-priority
  agreement (Clients → Business Partners → Dr. Agile → Effectiveness),
  copied verbatim from `dr-agile-standards`. A different layer than
  `ETHICS.md`: that one is security/trust hygiene for this repo
  specifically; this one is company-wide and states whose needs take
  precedence when they conflict.

This file intentionally stays a short index rather than a growing summary of
the codebase — the docs above are the source of truth, and duplicating them
here would just create a second place to keep in sync.
