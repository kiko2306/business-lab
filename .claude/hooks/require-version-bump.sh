#!/usr/bin/env bash
# PreToolUse/Bash guard: a commit that ships code must also bump the version
# and add a CHANGELOG line (CLAUDE.md "After a change lands" + the standing
# versioning rule). The footer version is only meaningful if it moves with
# every real change, and it is easy to forget mid-loop — so this blocks the
# commit rather than trusting memory.
#
# Deliberately narrow, like bash-guards.sh: a guard that cries wolf gets
# worked around.
#   - Only fires on `git commit` invocations.
#   - Only trips when a non-test file under backend/src or frontend/src is in
#     the change. Plan/README/docs-only commits (plan: prefix) never touch
#     those paths, so they pass untouched.
#   - Passes as soon as BOTH package.json versions move and CHANGELOG.md is in
#     the same commit.
#
# No `pipefail`: `git diff | grep -q` would SIGPIPE the diff and mark the
# pipeline failed the moment grep matches, inverting the check.
set -eu

cmd=$(jq -r '.tool_input.command // empty')

# Not a git commit? Nothing to check. Matches `git commit`, `git -C x commit`,
# `git -c key=val commit`, and `... && git commit ...`.
if ! grep -qE '(^|[;&|]|[[:space:]])git([[:space:]]+-[a-zA-Z]+([[:space:]]+|=)[^[:space:]]+)*[[:space:]]+commit(\b|$)' <<<"$cmd"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --verify HEAD >/dev/null 2>&1 || exit 0

# Everything this commit would carry: staged, plus tracked-but-unstaged in case
# of `git commit -a`.
changed=$( { git diff --cached --name-only; git diff --name-only HEAD; } 2>/dev/null | sort -u )
[ -n "$changed" ] || exit 0

# Shipping code = a non-test source file. Test/spec-only changes are treated as
# internal and don't force a bump.
ships_code=$(grep -E '^(backend|frontend)/src/' <<<"$changed" | grep -vE '\.(test|spec)\.ts$' || true)
[ -n "$ships_code" ] || exit 0

version_diff=$( { git diff --cached HEAD -- backend/package.json frontend/package.json
                  git diff HEAD -- backend/package.json frontend/package.json; } 2>/dev/null || true )
version_bumped=no
grep -qE '^\+[[:space:]]*"version":' <<<"$version_diff" && version_bumped=yes || true

changelog_touched=no
grep -qxF 'CHANGELOG.md' <<<"$changed" && changelog_touched=yes || true

if [ "$version_bumped" = yes ] && [ "$changelog_touched" = yes ]; then
  exit 0
fi

missing=""
[ "$version_bumped" = no ] && missing+=$'\n  - bump "version" in backend/package.json AND frontend/package.json (and the two lines near the top of each package-lock.json)'
[ "$changelog_touched" = no ] && missing+=$'\n  - add a matching entry to CHANGELOG.md'

jq -cn --arg r "Refused by .claude/hooks: this commit changes code under backend/src or frontend/src, so it must also:$missing
  - update the **Version X.Y.Z** line under the # Business Lab title in README.md

Pre-1.0 semver: PATCH = fix / small internal change, MINOR = user-facing feature or breaking change. See the standing versioning rule. If this really ships no behaviour change, it should not be touching those source paths." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
