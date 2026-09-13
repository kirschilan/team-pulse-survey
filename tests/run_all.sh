#!/usr/bin/env bash
# Runs the full tests/test_*.py Playwright suite in parallel across
# processes. Each file is a fully independent script -- its own
# build_page()/write_plain_index() output file (every out_name in the
# suite is unique), its own relay subprocess on its own hardcoded port
# (every RELAY_PORT in the relay-backed files is unique), and its own
# browser instance. Verified before this script was added: no shared
# ports, no shared output filenames, so plain process-level parallelism
# is safe with zero changes to any test's own logic.
#
# Concurrency defaults to 2, not `nproc`: each worker runs a full headless
# Chromium, which is CPU-heavy, and measuring on a 4-core machine found
# that -P equal to the core count (leaving no headroom) produced a real,
# reproducible flake in a timing-sensitive relay test under load -- an
# element read right after a genuine WebSocket round trip occasionally
# hadn't rendered yet, purely from CPU contention, despite passing
# standalone every time. -P 2 on that same machine ran the full suite with
# zero failures, in well under half the serial time. Override with
# TEST_JOBS=N if your machine has more (or less) headroom -- e.g. a
# beefier CI runner, or a shared/loaded box that needs to drop to 1.
#
# Dispatches to tests/_run_one.sh via `xargs -n 1 -P`, NOT `xargs -I{} sh
# -c '<inline script>'` (an earlier version of this file did the latter).
# `-I` combined with `-P` is a known-broken combination on BSD/macOS's
# xargs: it fails with "xargs: command line cannot be assembled, too
# long" even for a single, short input line -- the message blames argument
# length, but the real trigger is `-I` + `-P` together on that
# implementation, not the actual size of anything being passed (confirmed:
# the old construction worked fine on Linux/GNU findutils, which doesn't
# share this limitation, and failed on macOS on the very first, shortest
# possible input). `-n 1` (one argument per invocation, no {} substitution
# to reconstruct) plus `-P` is the standard, documented macOS-safe
# parallel-xargs idiom, and works identically on GNU findutils too.
#
# Usage: tests/run_all.sh                    (default: every test_*.py file, 2 workers)
#        TEST_JOBS=4 tests/run_all.sh
#        tests/run_all.sh tests/test_a.py tests/test_b.py   (run only these -- CI's
#                                                             per-shard matrix job uses this)
set -uo pipefail
cd "$(dirname "$0")/.."

JOBS="${TEST_JOBS:-2}"

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=(tests/test_*.py)
fi

printf '%s\n' "${files[@]}" | xargs -n 1 -P "$JOBS" tests/_run_one.sh
status=$?

if [ "$status" -eq 0 ]; then
  echo "All Playwright tests passed (TEST_JOBS=$JOBS)."
else
  echo "One or more Playwright tests FAILED (TEST_JOBS=$JOBS) -- see above."
fi
exit "$status"
