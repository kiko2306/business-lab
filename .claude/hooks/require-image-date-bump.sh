#!/usr/bin/env bash
# PreToolUse/Bash guard: a commit that changes an app's image: tag must also
# bump that file's "Last checked for a newer image" comment (plan.md §449).
# classifyDeploy (backend/src/services/selfUpdate.ts) scopes self-update's
# pull+recreate to whatever apps/<name>/** shows up in a plain git diff, so
# every machine that later pulls this commit relies on that line having
# actually moved — easy to forget mid-loop, so this blocks the commit rather
# than trusting memory. Governs only commits Claude itself makes in this
# session; it is not a real git hook and has no effect on a human's `git
# commit` or on any other machine.
#
# Deliberately narrow, like bash-guards.sh: a guard that cries wolf gets
# worked around.
#   - Only fires on `git commit` invocations.
#   - Only inspects apps/<name>/docker-compose.yml files, and only ones that
#     still exist (a deleted app's file needs no date bump).
#   - Only trips when a diff line actually adds/removes an `image:` tag —
#     editing ports/volumes/etc. in the same file doesn't require a bump.
#
# No `pipefail`: `git diff | grep -q` would SIGPIPE the diff and mark the
# pipeline failed the moment grep matches, inverting the check.
set -eu

cmd=$(jq -r '.tool_input.command // empty')

if ! grep -qE '(^|[;&|]|[[:space:]])git([[:space:]]+-[a-zA-Z]+([[:space:]]+|=)[^[:space:]]+)*[[:space:]]+commit(\b|$)' <<<"$cmd"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

changed=$( { git diff --cached --name-only; git diff --name-only HEAD; } 2>/dev/null | sort -u )
[ -n "$changed" ] || exit 0

compose_files=$(grep -E '^apps/[^/]+/docker-compose\.yml$' <<<"$changed" || true)
[ -n "$compose_files" ] || exit 0

offenders=""
while IFS= read -r file; do
  [ -f "$file" ] || continue # deleted — no date to bump
  diff=$(git diff HEAD -- "$file" 2>/dev/null || true)
  [ -n "$diff" ] || continue

  image_changed=no
  grep -qE '^[+-][[:space:]]*image:' <<<"$diff" && image_changed=yes || true
  [ "$image_changed" = yes ] || continue

  date_changed=no
  grep -qE '^[+-]#[[:space:]]*Last checked for a newer image:' <<<"$diff" && date_changed=yes || true
  [ "$date_changed" = yes ] && continue

  offenders+=$'\n  - '"$file"
done <<<"$compose_files"

[ -n "$offenders" ] || exit 0

jq -cn --arg r "Refused by .claude/hooks: this commit changes an image: tag without bumping that file's date comment, in:$offenders

self-update only re-pulls an app whose apps/<name>/** changed since the last
deploy (classifyDeploy, plan.md §343/§449) — every machine that pulls this
commit relies on the 'Last checked for a newer image' line having moved too.
Bump it, e.g.:
  sed -i \"s/Last checked for a newer image: [0-9-]*/Last checked for a newer image: \$(date +%F)/\" <file>" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
