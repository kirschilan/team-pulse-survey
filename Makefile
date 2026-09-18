# REF-10 (STATUS.md's "Code quality & refactoring backlog"): one obvious
# command per task, instead of reconstructing it from tests/README.md/
# relay/README.md each time. Deliberately thin -- every target just calls
# the same commands those READMEs already document, so this is a command
# surface, not a second place those instructions have to stay in sync
# with. Not wired into .github/workflows/tests.yml yet (see REF-10's own
# acceptance criteria in STATUS.md: ship this first, wire CI to it once
# proven locally, as a separate follow-up).
.PHONY: help setup check unit relay browser test

help:
	@echo "Targets:"
	@echo "  make setup    - install everything needed to run the suite (Python/Playwright + relay deps)"
	@echo "  make check    - fast sanity check that setup actually worked, no tests run"
	@echo "  make unit     - frontend unit tests (tests/unit/*.js)"
	@echo "  make relay    - the relay's own protocol tests"
	@echo "  make browser  - the full Playwright suite (tests/run_all.sh)"
	@echo "  make test     - everything above: unit + relay + browser"

# Matches tests/README.md's own "Setup" section exactly -- the pinned
# tests/requirements.txt is what keeps every environment on the same
# Chromium build (see that file's own header comment for why this
# mattered as a real, not hypothetical, incident).
setup:
	python3 -m pip install -r tests/requirements.txt
	playwright install --with-deps chromium
	cd relay && npm ci

# Fast (no network, no browser launch) verification that `make setup`
# actually left this checkout ready -- the same two guard checks
# tests/run_all.sh already runs before attempting anything, exposed here
# on their own so a contributor (or a CI cache-restore step) can confirm
# setup before spending the time on the full suite.
check:
	@python3 -c 'import playwright' >/dev/null 2>&1 && echo "OK: playwright importable" || (echo "MISSING: playwright -- run 'make setup'" >&2; exit 1)
	@test -f relay/node_modules/ws/package.json && echo "OK: relay dependencies installed" || (echo "MISSING: relay/node_modules -- run 'make setup'" >&2; exit 1)

unit:
	node --test tests/unit/test_*.js

relay:
	cd relay && npm test

browser:
	tests/run_all.sh

test: unit relay browser
