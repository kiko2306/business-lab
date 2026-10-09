#!/usr/bin/env bash
# Guards the SessionStart hook's size: its output is injected into context at every
# session start and /clear, then re-read every turn, so bloat there is the biggest
# usage-limit drain (plan.md §894).
set -euo pipefail
cd "$(dirname "$0")/.."
out=$(CLAUDE_PROJECT_DIR="$PWD" bash .claude/hooks/session-summary.sh)
size=${#out}
# 3 KB, not 10: the old cap let all ~91 headlines through (~7 KB). Only the
# agent-actionable ones are listed now; the host-verify queue is a count.
max=3000
fail=0
[ "$size" -le "$max" ] || { echo "FAIL: hook output $size bytes > $max"; fail=1; }
grep -q 'Active .claude guards' <<<"$out" || { echo "FAIL: guard summary missing"; fail=1; }
grep -q '^- \[ \] \*\*' <<<"$out" || { echo "FAIL: no open-item headlines"; fail=1; }
# Item body lines (indented continuation) must not leak in.
! grep -q '^      ' <<<"$out" || { echo "FAIL: item bodies leaked"; fail=1; }

# At most 12 headlines printed, however many are open.
n=$(grep -c '^- \[ \] \*\*' <<<"$out" || true)
[ "$n" -le 12 ] || { echo "FAIL: $n headlines printed, cap is 12"; fail=1; }

# Items only the user can run on the host are a count, not a list.
grep -qE 'Host-verify queue: [0-9]+' <<<"$out" ||
  { echo "FAIL: host-verify queue count missing"; fail=1; }
! grep -q '^- \[ \] \*\*Beta-test' <<<"$out" ||
  { echo "FAIL: host-verify items listed instead of counted"; fail=1; }

# Every open item lands in exactly one bucket, so none can go missing.
open=$(grep -c '^- \[ \] \*\*' README.md || true)
listed=$(grep -oE 'open items \(([0-9]+)' <<<"$out" | grep -oE '[0-9]+' || echo 0)
queued=$(grep -oE 'Host-verify queue: [0-9]+' <<<"$out" | grep -oE '[0-9]+' || echo 0)
[ "$((listed + queued))" = "$open" ] ||
  { echo "FAIL: $listed + $queued != $open open items"; fail=1; }

# CLAUDE.md is the other half of the per-turn startup cost, and it only ever grows
# by accretion. 14 KB leaves room for a real new rule and still fails a section that
# restates one already written down (plan.md §909).
claude_size=$(wc -c <CLAUDE.md)
[ "$claude_size" -le 14000 ] ||
  { echo "FAIL: CLAUDE.md $claude_size bytes > 14000 — fold a duplicate section or move detail to docs/"; fail=1; }

[ "$fail" = 0 ] && echo "ok: hook $size bytes, $n listed, $queued queued, CLAUDE.md $claude_size bytes"
exit "$fail"
