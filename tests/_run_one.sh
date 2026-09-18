#!/usr/bin/env bash
# Runs exactly one Playwright test file and reports ok/FAILED, preserving
# its real exit code. Split out of run_all.sh into its own file so that
# script (see run_all.sh's own comment) never needs to hand xargs an
# inline, multi-line command to reconstruct per invocation -- xargs just
# calls THIS file with one argument.
set -u
f="$1"
out=$(python3 "$f" 2>&1)
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAILED: $f"
  echo "$out" | tail -30
  echo "-----"
else
  echo "ok: $f"
fi
exit "$status"
