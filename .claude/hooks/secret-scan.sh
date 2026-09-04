#!/usr/bin/env bash
# PreToolUse/Bash guard: scans a `git commit`'s added lines for high-confidence
# secret formats. bash-guards.sh already blocks reading/writing real .env
# files; this catches a secret pasted somewhere else (a script, a fixture, a
# compose override) before it lands in a public repo (kiko2306/business-lab).
#
# Deliberately narrow, like the other hooks here: only patterns specific
# enough to a real secret format that they don't fire on ordinary code (a UUID,
# a JWT-shaped test fixture, a hex hash). A guard that cries wolf gets worked
# around rather than trusted — so this is a second net, not a replacement for
# actually looking at `git diff --cached` before committing.
#
# No `pipefail`: see require-version-bump.sh for why.
set -eu

cmd=$(jq -r '.tool_input.command // empty')

if ! grep -qE '(^|[;&|]|[[:space:]])git([[:space:]]+-[a-zA-Z]+([[:space:]]+|=)[^[:space:]]+)*[[:space:]]+commit(\b|$)' <<<"$cmd"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

added=$( { git diff --cached -U0 -- . ':!*.md'; git diff -U0 HEAD -- . ':!*.md'; } 2>/dev/null \
  | grep -E '^\+' | grep -vE '^\+\+\+' || true )
[ -n "$added" ] || exit 0

PATTERNS='(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,})'

hit=$(grep -oE "$PATTERNS" <<<"$added" | sort -u || true)
[ -n "$hit" ] || exit 0

jq -cn --arg r "Refused by .claude/hooks: this commit's added lines match a known secret format ($(tr '\n' ', ' <<<"$hit")). The repo is public — remove it, use an .env.example placeholder or ask the user for the real value, and rotate the credential if it was ever real." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
