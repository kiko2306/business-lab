#!/usr/bin/env bash
# PreToolUse/Bash guard: refuse a `docker compose down` aimed at the management
# stack. Tearing that down kills the dashboard, API, database and socket proxy —
# including the session's own working environment — and it is never the right way
# to restart one service.
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')

# Not a compose teardown at all — nothing to say.
if ! grep -qE '(^|[;&|]|[[:space:]])docker[- ]compose[[:space:]].*\bdown\b' <<<"$cmd"; then
  exit 0
fi

# A teardown aimed at a managed app's own compose file is how apps get stopped.
# Only the root stack is protected here.
if grep -q 'apps/' <<<"$cmd"; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refused by .claude/hooks/block-stack-teardown.sh: `docker compose down` in the project root tears down the management stack (frontend, backend, database, docker-socket-proxy) — including the dashboard being worked on. Restart a single service instead, e.g. `docker compose restart backend`. To stop a managed app, target its own compose file under apps/."}}
JSON
