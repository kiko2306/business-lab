#!/usr/bin/env bash
# Guards the SessionStart hook's size: its output is injected into context at every
# session start and /clear, then re-read every turn, so bloat there is the biggest
# usage-limit drain (plan.md §894).
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(CLAUDE_PROJECT_DIR="$PWD" bash .claude/hooks/session-summary.sh)
size=${#out}
max=10000
fail=0
[ "$size" -le "$max" ] || { echo "FAIL: hook output $size bytes > $max"; fail=1; }
grep -q 'Active .claude guards' <<<"$out" || { echo "FAIL: guard summary missing"; fail=1; }
grep -q '^- \[ \] \*\*' <<<"$out" || { echo "FAIL: no open-item headlines"; fail=1; }
# Item body lines (indented continuation) must not leak in.
! grep -q '^      ' <<<"$out" || { echo "FAIL: item bodies leaked"; fail=1; }
[ "$fail" = 0 ] && echo "ok: $size bytes"
exit "$fail"
