#!/usr/bin/env bash
# Browser E2E: bring up the throwaway test stack (docker-compose.test.yml) and
# drive the real dashboard with Playwright — login, navigation, the invite-
# gated Users page, and the full TOTP second-factor journey (plan.md §131.5).
#
# Everything runs in containers: the frontend build in node:20, Playwright in
# the official image. There is no host Node dependency, matching the rest of
# the project's commands. CI runs this same script as its own job.
#
#   scripts/e2e-tests.sh            # build, test, tear down
#   KEEP_STACK=1 scripts/e2e-tests.sh   # leave the stack up afterwards
#
# The specs also run against a live deployment: point E2E_BASE_URL at it and
# run `npx playwright test` from e2e/ directly (the stack steps here are only
# for the disposable CI stack).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.test.yml")

# Keep this tag in step with @playwright/test in e2e/package.json — the image
# ships the matching browsers.
PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.48.0-jammy"
NODE_IMAGE="node:20"

KEEP_STACK="${KEEP_STACK:-0}"

cleanup() {
  [[ "$KEEP_STACK" == "1" ]] && { echo "KEEP_STACK=1 — leaving the test stack up"; return; }
  docker compose "${COMPOSE_FILES[@]}" down -v --remove-orphans || true
}
trap cleanup EXIT

wait_for_http() {
  local url="$1" label="$2" attempts=60
  while ((attempts > 0)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✅ ${label} is ready"
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "❌ Timed out waiting for ${label} (${url})"
  return 1
}

echo "==> Building the frontend bundle (node:20)"
docker run --rm -v "${ROOT_DIR}":/repo -w /repo/frontend "${NODE_IMAGE}" \
  sh -c "npm ci && npm run build"

echo "==> Starting the test stack"
docker compose "${COMPOSE_FILES[@]}" up -d --build

wait_for_http "http://localhost:13000/health" "backend"
wait_for_http "http://localhost:18080" "frontend"

echo "==> Running the Playwright suite"
docker run --rm --network host \
  -v "${ROOT_DIR}":/repo -w /repo/e2e \
  -e CI="${CI:-}" \
  -e HOME=/tmp \
  -e E2E_BASE_URL="http://localhost:18080" \
  "${PLAYWRIGHT_IMAGE}" \
  sh -c "npm ci && npx playwright test"

echo "✅ Browser E2E suite passed"
