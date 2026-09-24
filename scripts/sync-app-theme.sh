#!/usr/bin/env bash
# Copies the dashboard's theme into every managed app's frontend.
#
# plan.md §626 wanted one shared theme file with no per-app copy, because a
# copy is the drift that put 135 entries between the legacy setup/ and
# trigenius/. Docker does not allow it: an app image builds from its own
# apps/<name>/ context and cannot reach frontend/src/styles.css, and widening
# the context to the repo root would ship the whole tree to the daemon on
# every build.
#
# So: one source of truth, a generated copy, and CI diffing the two. Drift is
# caught rather than prevented — run this after changing the dashboard theme,
# and commit what it writes.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_file="$root/frontend/src/styles.css"

targets=(
  "$root/apps/tally/web/src/theme.css"
  "$root/apps/hotel/admin/src/theme.css"
  "$root/apps/hotel/checkin/src/theme.css"
)

for target in "${targets[@]}"; do
  [ -d "$(dirname "$target")" ] || { echo "skip (no such app): $target"; continue; }
  cp "$source_file" "$target"
  echo "synced: ${target#"$root"/}"
done
