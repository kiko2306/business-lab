#!/usr/bin/env bash
# Every commit that ships code under backend/src or frontend/src must bump
# both package.json versions, both package-lock.json "version" fields, add a
# CHANGELOG.md entry, and update the README version line (CLAUDE.md's
# versioning rule; enforced in part by .claude/hooks/require-version-bump.sh).
# Doing that by hand is 4-5 separate edits, every single commit, and it's easy
# to get one lockfile out of sync with the others (found package-lock.json's
# nested "packages\"\": {\"version\"}" drifted to 0.15.1 while everything else
# read 0.29.0 — nothing had been keeping it honest). This script does all of
# it atomically from the one place versions actually change.
#
# Usage:
#   scripts/bump-version.sh patch "Fixed" "Frontend npm run test:ci now runs against a real headless Chrome"
#   scripts/bump-version.sh minor "Added" "Per-app backup/restore"
#
# $1 = patch|minor  (pre-1.0: patch = fix/small internal change, minor = user-facing feature or breaking change)
# $2 = Changed|Added|Fixed|Removed  (Keep a Changelog category)
# $3 = the changelog bullet text (no leading "- ")
set -euo pipefail

cd "$(dirname "$0")/.."

bump="${1:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"
category="${2:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"
bullet="${3:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"

old_version=$(grep -m1 '"version"' backend/package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
front_version=$(grep -m1 '"version"' frontend/package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
if [ "$old_version" != "$front_version" ]; then
  echo "backend/frontend package.json versions already disagree ($old_version vs $front_version) — fix by hand first" >&2
  exit 1
fi

new_version=$(python3 - "$old_version" "$bump" <<'PY'
import sys
version, bump = sys.argv[1], sys.argv[2]
major, minor, patch = (int(x) for x in version.split("."))
if bump == "patch":
    patch += 1
elif bump == "minor":
    minor += 1
    patch = 0
else:
    sys.exit(f"unknown bump type: {bump!r} (want patch|minor)")
print(f"{major}.{minor}.{patch}")
PY
)

echo "Bumping $old_version -> $new_version"

python3 - "$old_version" "$new_version" <<'PY'
import re, sys
old, new = sys.argv[1], sys.argv[2]

def sub_first(path, pattern):
    text = open(path).read()
    text, n = re.subn(pattern, lambda m: m.group(1) + new + m.group(2), text, count=1)
    if n != 1:
        sys.exit(f"{path}: expected exactly one match for {pattern!r}, got {n}")
    open(path, "w").write(text)

def sub_all(path, pattern, expected):
    text = open(path).read()
    text, n = re.subn(pattern, lambda m: m.group(1) + new + m.group(2), text)
    if n != expected:
        sys.exit(f"{path}: expected {expected} matches for {pattern!r}, got {n}")
    open(path, "w").write(text)

ver_field = re.compile(r'("version": ")' + re.escape(old) + r'(")')

sub_first("backend/package.json", ver_field.pattern)
sub_first("frontend/package.json", ver_field.pattern)

# Both the root "version" and the nested packages[""].version need to move —
# match on the preceding "name" line so no dependency's version is touched.
# The nested one is matched loosely (any current value, not just `old`):
# it has drifted out of sync with the root before and nothing else catches
# that, so this both bumps and self-heals it.
for pkg, name in (("backend", "homelab-backend"), ("frontend", "homelab-frontend")):
    path = f"{pkg}/package-lock.json"
    pattern = r'("name": "' + name + r'",\s*\n\s*"version": ")[^"]+(")'
    sub_all(path, pattern, 2)

sub_first("README.md", r'(\*\*Version )' + re.escape(old) + r'(\*\*)')
PY

changelog_date=$(date +%Y-%m-%d)
tmp=$(mktemp)
awk -v ver="$new_version" -v date="$changelog_date" -v cat="$category" -v bullet="$bullet" '
  found == 0 && /^## \[/ {
    print "## [" ver "] — " date
    print ""
    print "### " cat
    print ""
    print "- " bullet
    print ""
    found = 1
  }
  { print }
' CHANGELOG.md > "$tmp"
mv "$tmp" CHANGELOG.md

echo "Done. Review the diff (especially CHANGELOG.md's new entry) before committing:"
echo "  git diff backend/package.json frontend/package.json backend/package-lock.json frontend/package-lock.json README.md CHANGELOG.md"
