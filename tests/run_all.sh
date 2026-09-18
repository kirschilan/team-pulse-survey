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
#        tests/run_all.sh tests/test_a.py tests/test_b.py   (run only these; an
#                                                             explicit list is NEVER re-sharded,
#                                                             only default discovery is)
#        SHARD_INDEX=1 tests/run_all.sh        (run only shard 1's files, same partitioning
#                                                the no-args path uses -- .github/workflows/
#                                                tests.yml's per-shard matrix job uses THIS,
#                                                not an explicit file list, so there is exactly
#                                                one implementation of "which files are in
#                                                shard N" for both CI and local use -- see
#                                                REF-9, STATUS.md's "Code quality &
#                                                refactoring backlog")
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
# REF-9: select_shard_files() below is the one place that decides which
# files belong to shard N, called identically whether this script is
# running every shard in sequence (the default, no-args, local path) or
# just one (SHARD_INDEX=N, what CI's matrix job now passes) -- previously
# CI reimplemented the same split as a separate `ls | awk 'NR % n == i'`
# line in the workflow file itself, using 1-indexed NR against this
# script's 0-indexed loop counter, which (confirmed) picked a DIFFERENT
# physical file group for "shard 0" than this script's own shard 0 despite
# both correctly partitioning the full suite -- harmless in effect (every
# file still ran exactly once across the 3 shards either way) but exactly
# the kind of silent drift this backlog item exists to close off.
#
# Codex review on PR #32: the shard COUNT itself was still a second,
# independent hardcoded `3` here, separate from
# .github/workflows/tests.yml's own copy -- REF-9's "one obvious source of
# truth" acceptance criterion wasn't actually met by unifying the
# partitioning rule alone. Fixed by moving the count into
# tests/.shard_count (a plain checked-in file, same pattern as this
# script's own tests/.timing_baseline below) -- both this script's default
# and the workflow's `compute-shard-matrix` job now read that one file, so
# there is exactly one place to change the shard count, the same way
# select_shard_files() is exactly one place to change the partitioning
# rule. SHARD_COUNT can still be overridden via the environment (e.g. for
# a one-off local experiment) without touching the file.
set -uo pipefail
cd "$(dirname "$0")/.."

JOBS="${TEST_JOBS:-2}"
SHARD_COUNT="${SHARD_COUNT:-$(tr -d '[:space:]' < tests/.shard_count)}"

if ! python3 -c 'import playwright' >/dev/null 2>&1; then
  echo "Playwright is unavailable to python3. Activate the project environment or install it with: python3 -m pip install -r tests/requirements.txt" >&2
  exit 2
fi
if [ ! -f relay/node_modules/ws/package.json ]; then
  echo "Relay dependency ws is unavailable. Install it with: (cd relay && npm ci)" >&2
  exit 2
fi

case "$JOBS" in
  ''|*[!0-9]*|0) echo "TEST_JOBS must be a positive integer" >&2; exit 2 ;;
esac
case "$SHARD_COUNT" in
  ''|*[!0-9]*|0) echo "SHARD_COUNT must be a positive integer" >&2; exit 2 ;;
esac
if [ -n "${SHARD_INDEX:-}" ]; then
  case "$SHARD_INDEX" in
    *[!0-9]*) echo "SHARD_INDEX must be a non-negative integer" >&2; exit 2 ;;
  esac
  if [ "$SHARD_INDEX" -ge "$SHARD_COUNT" ]; then
    echo "SHARD_INDEX ($SHARD_INDEX) must be less than SHARD_COUNT ($SHARD_COUNT)" >&2
    exit 2
  fi
fi

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

# The one place that decides which files belong to shard N -- see REF-9's
# comment above SHARD_COUNT's own definition for why this used to also be
# reimplemented, slightly differently, in .github/workflows/tests.yml
# itself. Populates the global `files` array; not called with a subshell
# (no `$(...)`) specifically so that assignment is visible to the caller.
select_shard_files(){
  local shard="$1"
  files=()
  local file_index=0
  local file
  for file in tests/test_*.py; do
    [ -f "$file" ] || continue
    if [ $((file_index % SHARD_COUNT)) -eq "$shard" ]; then
      files[${#files[@]}]="$file"
    fi
    file_index=$((file_index + 1))
  done
}

if [ -n "${SHARD_INDEX:-}" ]; then
  select_shard_files "$SHARD_INDEX"
  echo "--- shard $SHARD_INDEX/$SHARD_COUNT: ${#files[@]} file(s) ---"
  printf '  %s\n' "${files[@]}"
  status=0
  if [ "${#files[@]}" -gt 0 ]; then
    printf '%s\n' "${files[@]}" | xargs -n 1 -P "$JOBS" tests/_run_one.sh
    status=$?
  fi
  if [ "$status" -eq 0 ]; then
    echo "All Playwright tests passed (TEST_JOBS=$JOBS, shard $SHARD_INDEX/$SHARD_COUNT)."
  else
    echo "One or more Playwright tests FAILED (TEST_JOBS=$JOBS, shard $SHARD_INDEX/$SHARD_COUNT) -- see above."
  fi
  exit "$status"
fi

status=0
START_TIME=$(date +%s)
for shard in $(seq 0 $((SHARD_COUNT - 1))); do
  select_shard_files "$shard"
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

# Self-reported timing against a tracked baseline (tests/.timing_baseline) --
# added 2026-09-15 after fixed wait_for_timeout() sleeps, each individually
# defensible, quietly grew this suite from ~102s to over 5 minutes before
# anyone treated the trend as worth stopping for. Nobody could see that
# trend without manually timing every run, so this makes it show up
# automatically, for every contributor (Copilot, Codex, Claude Code, or a
# human), without anyone having to remember to check. See
# docs/DefinitionOfDone.md's "growth budget" entry.
ELAPSED=$(( $(date +%s) - START_TIME ))
echo "Total wall-clock time: ${ELAPSED}s"
BASELINE_FILE="tests/.timing_baseline"
if [ -f "$BASELINE_FILE" ]; then
  BASELINE=$(tr -d '[:space:]' < "$BASELINE_FILE")
  case "$BASELINE" in
    ''|*[!0-9]*) : ;;  # malformed baseline file -- skip the comparison silently
    *)
      THRESHOLD=$((BASELINE * 115 / 100))
      if [ "$ELAPSED" -gt "$THRESHOLD" ]; then
        echo ""
        echo "*** ${ELAPSED}s is more than 15% over the ${BASELINE}s baseline in $BASELINE_FILE. ***"
        echo "*** Before adding more Playwright files in the same pattern: grep tests/test_*.py"
        echo "*** for new wait_for_timeout() calls added since the baseline was set, and fix any"
        echo "*** that lack the justification docs/DefinitionOfDone.md requires. If the growth is"
        echo "*** legitimate (a real increase in file count, not slop), update $BASELINE_FILE."
        echo ""
      fi
      ;;
  esac
fi
exit "$status"
