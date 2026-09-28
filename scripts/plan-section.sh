#!/usr/bin/env bash
# Print one section of plan.md.
#
#   ./scripts/plan-section.sh 649        # §649, up to the next `## ` heading
#   ./scripts/plan-section.sh 730 732    # a run of sections, inclusive
#
# plan.md is read a section at a time, never whole (CLAUDE.md). Finding a
# section used to mean loading all 62 KB of plan-index.md to read one `sed`
# range out of it — the index is a map for a human, but a lookup of §649 does
# not need the other 656 rows. This reads plan.md's own `## N.` headings
# instead, so there is nothing to regenerate and nothing to keep in step.
#
# Sections are in file order, which is not always numeric order, so the end of
# §N is "the next heading in the file", not "the heading numbered N+1".
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ $# -ge 1 ] || { echo "Usage: $0 <section> [<last-section>]" >&2; exit 1; }
first="$1"
last="${2:-$1}"

# Checked up front, so the awk below can exit on a closed pipe (`| head`,
# `| less`) without that being mistaken for "no such section".
grep -qE "^## $first\." plan.md || { echo "No section §$first in plan.md" >&2; exit 1; }

awk -v first="$first" -v last="$last" '
  /^## / {
    n = $2 + 0                     # "730." -> 730
    if (ending) { exit }           # first heading past `last` — done
    if (n == first) { inside = 1 }
    if (inside && n == last) { ending = 1 }
  }
  inside { print }
' plan.md
