#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILES=(-f "${ROOT_DIR}/docker-compose.yml" -f "${ROOT_DIR}/docker-compose.test.yml")

cleanup() {
  docker compose "${COMPOSE_FILES[@]}" down -v --remove-orphans || true
}
trap cleanup EXIT

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts=60
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

echo "Building and starting dockerized stack"
docker compose "${COMPOSE_FILES[@]}" up -d --build

wait_for_http "http://localhost:13000/health" "backend"
wait_for_http "http://localhost:18080" "frontend"

echo "Checking database readiness"
docker compose "${COMPOSE_FILES[@]}" exec -T database pg_isready -U homelab -d homelab_test

echo "Running API smoke tests"
API_BASE_URL="http://localhost:13000" \
SMOKE_USER="admin" \
SMOKE_PASSWORD="AdminPassword-123" \
"${ROOT_DIR}/scripts/smoke-tests.sh"

echo "Validating local-only recovery mode flow from backend container"
docker compose "${COMPOSE_FILES[@]}" exec -T backend node -e "
(async () => {
  const base = 'http://localhost:3000/api/recovery';
  let res = await fetch(base + '/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'ENABLE_RECOVERY_MODE' }),
  });
  if (res.status !== 200) { throw new Error('enable failed: ' + res.status); }

  res = await fetch(base + '/status');
  const status = await res.json();
  if (!status.enabled) { throw new Error('recovery mode did not enable'); }

  res = await fetch(base + '/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.status !== 200) { throw new Error('disable failed: ' + res.status); }

  process.stdout.write('recovery flow ok\\n');
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
"

echo "✅ Docker E2E deployment test passed"
