# REF-10 (STATUS.md's "Code quality & refactoring backlog"): one obvious
# command per task, instead of reconstructing it from tests/README.md/
# relay/README.md each time. Deliberately thin -- every target just calls
# the same commands those READMEs already document, so this is a command
# surface, not a second place those instructions have to stay in sync
# with. Not wired into .github/workflows/tests.yml yet (see REF-10's own
# acceptance criteria in STATUS.md: ship this first, wire CI to it once
# proven locally, as a separate follow-up).
.PHONY: help setup check unit relay browser test

# Codex review on PR #33: `python3 -m pip install` straight into whatever
# python3 happens to be on PATH fails with `externally-managed-environment`
# on a PEP 668 system (confirmed in the reviewer's own shell) -- the same
# failure tests/README.md's own bare `pip install -r tests/requirements.txt`
# instructions would hit there too, just not surfaced until someone actually
# ran it on such a system. `make setup` now creates (idempotently -- safe to
# re-run) a project-local virtualenv and installs into THAT, so it works
# regardless of the host's Python packaging policy. `make check`/`make
# browser`/`make test` below all use this same venv's python, consistently,
# rather than whatever's on PATH -- `make browser` does this by putting
# $(VENV_BIN) first on PATH, so tests/run_all.sh's own `python3` calls (and
# every individual test_*.py file's, via tests/_run_one.sh) resolve to it
# without either of those scripts needing to know a venv exists.
VENV := .venv
VENV_BIN := $(VENV)/bin

help:
	@echo "Targets:"
	@echo "  make setup    - create a project virtualenv ($(VENV)) and install everything needed (Python/Playwright + relay deps)"
	@echo "  make check    - fast sanity check that setup actually worked, no tests run"
	@echo "  make unit     - frontend unit tests (tests/unit/*.js)"
	@echo "  make relay    - the relay's own protocol tests"
	@echo "  make browser  - the full Playwright suite (tests/run_all.sh), using the venv's python"
	@echo "  make test     - everything above: unit + relay + browser"

# Otherwise matches tests/README.md's own "Setup" section -- the pinned
# tests/requirements.txt is what keeps every environment on the same
# Chromium build (see that file's own header comment for why this
# mattered as a real, not hypothetical, incident).
setup:
	python3 -m venv $(VENV)
	$(VENV_BIN)/python3 -m pip install -r tests/requirements.txt
	$(VENV_BIN)/python3 -m playwright install --with-deps chromium
	cd relay && npm ci

# Fast (no network, no browser launch) verification that `make setup`
# actually left this checkout ready -- the same two guard checks
# tests/run_all.sh already runs before attempting anything, exposed here
# on their own so a contributor (or a CI cache-restore step) can confirm
# setup before spending the time on the full suite.
check:
	@test -x $(VENV_BIN)/python3 && $(VENV_BIN)/python3 -c 'import playwright' >/dev/null 2>&1 && echo "OK: playwright importable" || (echo "MISSING: playwright -- run 'make setup'" >&2; exit 1)
	@test -f relay/node_modules/ws/package.json && echo "OK: relay dependencies installed" || (echo "MISSING: relay/node_modules -- run 'make setup'" >&2; exit 1)

unit:
	node --test tests/unit/test_*.js

relay:
	cd relay && npm test

browser:
	PATH="$(VENV_BIN):$$PATH" tests/run_all.sh

test: unit relay browser
