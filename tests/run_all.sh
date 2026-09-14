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
# Usage: tests/run_all.sh                    (default: every test_*.py file, sharded -- see below)
#        TEST_JOBS=4 tests/run_all.sh
#        tests/run_all.sh tests/test_a.py tests/test_b.py   (run only these -- CI's
#                                                             per-shard matrix job uses this,
#                                                             and an explicit list is NEVER
#                                                             re-sharded, only default discovery is)
#
# Sharding the DEFAULT (no-args) file list, found the hard way: -P 2 was
# measured safe for the whole suite back when it had ~30 files, but that
# number was never re-measured as the suite kept growing -- by 35 files, a
# single unsharded `xargs -P 2` batch over everything started failing
# reproducibly (opaque CDP-level crashes under CPU contention on a 4-core
# box, not a code bug -- confirmed identical on pre-change code via a
# git-stash comparison). What DIDN'T fail, at any suite size tried:
# .github/workflows/tests.yml's own 3-way shard, each shard independently
# run through this same script at TEST_JOBS=2 -- 9/9 clean across all three
# shards, three runs each, right when the unsharded 35-file run was failing
# 10/10. So the default (no-args) path below now reproduces THAT exact
# split locally -- same `NR % n == i` partitioning CI uses, same shard
# count -- run one shard fully before starting the next, rather than one
# large batch. This trades some theoretical parallel speed (now closer to
# ~90s than the ~80s the old unsharded call achieved when it wasn't
# crashing) for actually finishing reliably, and means "the full suite
# passes locally" and "CI is green" are now the same claim, checked the
# same way -- not two different configurations that can silently diverge.
#
# SHARD_COUNT here is a local copy of .github/workflows/tests.yml's own
# SHARD_COUNT env var, not read from it (a bash script and a GitHub Actions
# workflow have no shared source of truth to draw from) -- if one changes,
# check whether the other still matches the suite's actual size.
SHARD_COUNT="${SHARD_COUNT:-3}"

set -uo pipefail
cd "$(dirname "$0")/.."

JOBS="${TEST_JOBS:-2}"

case "$JOBS" in
  ''|*[!0-9]*|0) echo "TEST_JOBS must be a positive integer" >&2; exit 2 ;;
esac
case "$SHARD_COUNT" in
  ''|*[!0-9]*|0) echo "SHARD_COUNT must be a positive integer" >&2; exit 2 ;;
esac

if [ "$#" -gt 0 ]; then
  printf '%s\n' "$@" | xargs -n 1 -P "$JOBS" tests/_run_one.sh
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "All Playwright tests passed (TEST_JOBS=$JOBS)."
  else
    echo "One or more Playwright tests FAILED (TEST_JOBS=$JOBS) -- see above."
  fi
  exit "$status"
fi

status=0
for shard in $(seq 0 $((SHARD_COUNT - 1))); do
  files=()
  file_index=0
  for file in tests/test_*.py; do
    [ -f "$file" ] || continue
    if [ $((file_index % SHARD_COUNT)) -eq "$shard" ]; then
      files[${#files[@]}]="$file"
    fi
    file_index=$((file_index + 1))
  done
  echo "--- shard $shard/$SHARD_COUNT: ${#files[@]} file(s) ---"
  if [ "${#files[@]}" -eq 0 ]; then
    continue
  fi
  printf '%s\n' "${files[@]}" | xargs -n 1 -P "$JOBS" tests/_run_one.sh
  shard_status=$?
  [ "$shard_status" -ne 0 ] && status="$shard_status"
done

if [ "$status" -eq 0 ]; then
  echo "All Playwright tests passed (TEST_JOBS=$JOBS, $SHARD_COUNT shards)."
else
  echo "One or more Playwright tests FAILED (TEST_JOBS=$JOBS, $SHARD_COUNT shards) -- see above."
fi
exit "$status"
