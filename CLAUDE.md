# CLAUDE.md

Essential pointers for Claude Code (or any other AI agent) working in this
repo — read these before making a change, not this file's own prose:

- **`docs/DefinitionOfDone.md`** — the standing quality bar every change
  clears (testing, multi-language support, delivery workflow) before it's
  called done. When in doubt about whether something is finished, this file
  is the answer, not a judgment call.
- **`STATUS.md`** — current state, locked-in architecture/product decisions,
  what's deliberately not built yet, and a session log of past work. Read
  this before starting any non-trivial change; update its session log after
  finishing one.
- **`.claude/skills/tdd/SKILL.md`** — the test-first workflow (which of the
  two test tiers a behavior belongs in, how to build a Playwright test page)
  that satisfies the Definition of Done's Testing section.
- **`tests/README.md`** / **`tests/unit/README.md`** — how the two test
  tiers are organized, named, and run.
- **`README.md`** — project overview, running locally, deploying.
- **`ETHICS.md`** — secrets handling, attribution honesty, and other
  standing ethical/security-hygiene rules for anyone working in this repo.

This file intentionally stays a short index rather than a growing summary of
the codebase — the docs above are the source of truth, and duplicating them
here would just create a second place to keep in sync.
