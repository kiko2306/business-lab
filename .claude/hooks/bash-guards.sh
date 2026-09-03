#!/usr/bin/env bash
# PreToolUse/Bash guards for this repo. Permission rules in settings.json match
# per-tool, so the Read/Edit/Write denies on .env files do nothing about a shell
# `cat apps/foo/.env`. These close that gap, and the compose-teardown one.
#
# Both are deliberately narrow: a guard that cries wolf gets worked around.
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')

deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# --- Guard 1: a `docker compose down` aimed at the management stack ----------
# Tearing that down kills the dashboard, API, database and socket proxy — the
# session's own working environment — and is never how you restart one service.
if grep -qE '(^|[;&|]|[[:space:]])docker[- ]compose[[:space:]].*\bdown\b' <<<"$cmd"; then
  # A teardown aimed at a managed app's own compose file is how apps get
  # stopped. Only the root stack is protected here.
  if ! grep -q 'apps/' <<<"$cmd"; then
    deny "Refused by .claude/hooks: \`docker compose down\` in the project root tears down the management stack (frontend, backend, database, docker-socket-proxy) — including the dashboard being worked on. Restart a single service instead, e.g. \`docker compose restart backend\`. To stop a managed app, target its own compose file under apps/."
  fi
fi

# --- Guard 2: reading or writing a real .env through the shell ---------------
# Matched in two parts so ordinary work doesn't trip it:
#
#   1. a token that is genuinely a PATH ending in .env — bare `.env`, `./.env`
#      or `<dir>/.env`. This is what keeps `process.env`, `loadEnv.ts` and a
#      backslash-escaped `\.env` inside a grep pattern from matching.
#   2. a command that actually opens file CONTENTS. `ls`, `find` and
#      `git status` name .env files without revealing anything, and blocking
#      them would only make the guard annoying.
#
# .env.example and friends are templates, committed on purpose, and are not
# matched by the path pattern below (it anchors .env to end-of-token).
ENV_PATH='(^|[[:space:]=<>|;&(])(\./|[[:alnum:]_.~-]*/)*\.env([[:space:]]|$|["'"'"';|&<>)])'
CONTENT_CMD='(^|[[:space:]|;&(])(cat|bat|less|more|head|tail|tac|nl|strings|xxd|od|base64|cut|paste|column|awk|sed|grep|egrep|fgrep|rg|ag|cp|mv|scp|rsync|install|tee|dd|source)([[:space:]]|$)'
# The `.` builtin (source) only counts as a command word — otherwise the bare
# `.` in `find . -name .env` or `git add .` would look like a read.
SOURCE_DOT='(^|[;&|(][[:space:]]*)\.[[:space:]]'

if grep -qE "$ENV_PATH" <<<"$cmd" && ! grep -qE '\\\.env' <<<"$cmd"; then
  if grep -qE "$CONTENT_CMD" <<<"$cmd" \
    || grep -qE "$SOURCE_DOT" <<<"$cmd" \
    || grep -qE '>[[:space:]]*(\./|[[:alnum:]_.~-]*/)*\.env([[:space:]]|$)' <<<"$cmd"; then
    deny "Refused by .claude/hooks: that command reads or writes a real .env file. This repo is public (kiko2306/business-lab) and .env files hold JWT secrets, DB passwords and per-app credentials — settings.json already denies the Read/Edit/Write tools, and this closes the shell path. Use the matching .env.example template, or ask the user for the value."
  fi
fi

exit 0
