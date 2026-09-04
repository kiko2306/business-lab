#!/usr/bin/env bash
# PostToolUse hook: regenerates plan-index.md whenever plan.md is edited, so
# it's never stale from a forgotten manual step (step-by-step.md used to list
# "regenerate plan-index.md" as a thing to remember after every append).
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

path=$(jq -r '.tool_input.file_path // empty')
[[ "$path" == *plan.md ]] || exit 0

./scripts/plan-index.sh
