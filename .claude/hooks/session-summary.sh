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
echo
echo "README.md open TODO items (read an item's full text only when picking it up):"
awk '/^## TODO/{f=1;next} f && /^## /{exit} f && (/^### / || /^- \[ \] \*\*/)' README.md |
  sed -E 's/^(- \[ \] \*\*[^*]*\*\*).*/\1/'

echo
echo "git status:"
git status --short

echo
echo "plan.md: read a section with ./scripts/plan-section.sh <N>; tail is in plan-index.md."
