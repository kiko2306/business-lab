#!/usr/bin/env bash
# Every commit that ships code under backend/src or frontend/src must bump the
# version and add a CHANGELOG.md entry (CLAUDE.md's versioning rule; enforced
# by .claude/hooks/require-version-bump.sh).
#
# Source of truth is the repo-root VERSION file (plan.md §343) — the backend
# reads it live from the bind-mounted checkout, so a version-only bump is a
# bare `git pull` with no rebuild. The two package.json / package-lock.json
# version fields are NOT touched any more: nothing publishes or reads them,
# and bumping the lockfile would bust the Docker build cache on every release.
#
# Usage:
#   scripts/bump-version.sh patch Fixed "Frontend test:ci runs against real headless Chrome"
#   scripts/bump-version.sh minor Added "Per-app backup/restore"
#
# $1 = patch|minor  (pre-1.0: patch = fix/small internal change, minor = user-facing feature or breaking change)
# $2 = Changed|Added|Fixed|Removed  (Keep a Changelog category)
# $3 = the changelog bullet text (no leading "- ")
set -euo pipefail

cd "$(dirname "$0")/.."

bump="${1:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"
category="${2:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"
bullet="${3:?usage: bump-version.sh <patch|minor> <Category> <bullet text>}"

[ -f VERSION ] || { echo "VERSION file missing at repo root" >&2; exit 1; }
old_version=$(tr -d '[:space:]' < VERSION)

new_version=$(python3 - "$old_version" "$bump" <<'PY'
import sys
version, bump = sys.argv[1], sys.argv[2]
try:
    major, minor, patch = (int(x) for x in version.split("."))
except ValueError:
    sys.exit(f"VERSION is not X.Y.Z: {version!r}")
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

printf '%s\n' "$new_version" > VERSION

python3 - "$old_version" "$new_version" <<'PY'
import re, sys
old, new = sys.argv[1], sys.argv[2]
text = open("README.md").read()
text, n = re.subn(r'(\*\*Version )' + re.escape(old) + r'(\*\*)', lambda m: m.group(1) + new + m.group(2), text, count=1)
if n != 1:
    sys.exit(f"README.md: expected exactly one **Version {old}** line, got {n}")
open("README.md", "w").write(text)
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

echo "Done. Review the diff before committing:"
echo "  git diff VERSION README.md CHANGELOG.md"
