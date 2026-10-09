#!/usr/bin/env bash
# SessionStart hook: prints the active .claude guard summary so it doesn't
# have to be re-derived (by prompt) at the start of every session. Replaces
# step-by-step.md's old "paste this prompt" step 0 with a fixed, deterministic
# echo of what settings.json and the hooks actually enforce.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

cat <<'EOF'
Active .claude guards for this session:
- Read/Edit denied on ./.env and ./apps/*/.env (settings.json) — .env.example templates only.
- bash-guards.sh blocks shell reads/writes of real .env contents, and a root `docker compose down` (an app's own compose file is fine).
- require-version-bump.sh blocks a commit touching non-test backend/src or frontend/src unless it also bumps both package.json versions, both lockfiles, the README version line, and adds a CHANGELOG entry — use scripts/bump-version.sh.
- No router changes, no console configuration on the host — see CLAUDE.md.
EOF

# Headlines only: the full TODO (~70 KB) plus plan tail was injected at every start and
# /clear and re-read every turn (plan.md §894). Item bodies are read on demand.
#
# Split by headline verb, because listing all ~91 headlines was still 7 KB per start:
# most open items are host verification only the user can run on home-srv-01, so the
# agent can never clear them and listing them every turn buys nothing. They become a
# count; the items an agent can actually pick up get listed, capped at 12.
host_verify='^- \[ \] \*\*(Beta-test|Prove|Verify|Confirm|Show |Look at|Check |Run |Compare|One-off|First real build)'
headlines=$(awk '/^## TODO/{f=1;next} f && /^## /{exit} f && /^- \[ \] \*\*/' README.md |
  sed -E 's/^(- \[ \] \*\*[^*]*\*\*).*/\1/')
actionable=$(grep -Ev "$host_verify" <<<"$headlines" || true)
n_act=$(grep -c . <<<"$actionable" || true)
n_ver=$(grep -Ec "$host_verify" <<<"$headlines" || true)

echo
echo "Agent-actionable open items ($n_act) — read an item's full text only when picking it up:"
head -n 12 <<<"$actionable"
[ "$n_act" -gt 12 ] && echo "...and $((n_act - 12)) more: grep -n '^- \[ \] \*\*' README.md"

echo "Host-verify queue: $n_ver items that only you can run on home-srv-01 — don't propose them."

echo
echo "git status:"
git status --short

echo
echo "plan.md: read a section with ./scripts/plan-section.sh <N>; tail is in plan-index.md."
