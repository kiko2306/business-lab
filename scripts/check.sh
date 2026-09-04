#!/usr/bin/env bash
# Run a workspace check in Docker without retyping the long `docker run`
# invocation from CLAUDE.md each time.
#
#   ./scripts/check.sh backend test
#   ./scripts/check.sh backend typecheck
#   ./scripts/check.sh frontend build
#   ./scripts/check.sh frontend test        # builds homelab-frontend-test if missing
#
# Resolves the repo root via BASH_SOURCE rather than $PWD: mounting "$PWD" as
# /repo silently breaks once the shell's cwd has drifted into backend/ or
# frontend/ (a real, previously-hit mistake — some backend tests resolve
# paths up to the repo root, not just their own workspace).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

workspace="${1:-}"
task="${2:-}"

case "$workspace/$task" in
  backend/test)      docker run --rm -v "$ROOT":/repo -w /repo/backend node:20 npm test ;;
  backend/typecheck)  docker run --rm -v "$ROOT":/repo -w /repo/backend node:20 npm run typecheck ;;
  frontend/build)     docker run --rm -v "$ROOT":/repo -w /repo/frontend node:20 npm run build ;;
  frontend/test)
    docker image inspect homelab-frontend-test >/dev/null 2>&1 \
      || docker build -t homelab-frontend-test -f "$ROOT/frontend/Dockerfile.test" "$ROOT/frontend"
    docker run --rm -v "$ROOT":/repo -w /repo/frontend homelab-frontend-test npm run test:ci
    ;;
  *)
    echo "Usage: $0 {backend test|backend typecheck|frontend build|frontend test}" >&2
    exit 1
    ;;
esac
