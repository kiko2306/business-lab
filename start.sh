#!/usr/bin/env bash
# One-command bootstrap: generates .env with safe defaults/secrets if needed,
# then builds and starts the full stack. Everything past this point (the
# first admin account, per-app secrets, exposure settings) is configured
# from the dashboard itself — see the printed URL at the end.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

log() { printf '==> %s\n' "$1"; }

for bin in docker openssl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is required but not found on PATH." >&2
    exit 1
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  echo "error: 'docker compose' (the Compose plugin) is required." >&2
  exit 1
fi

ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  log "No .env found — creating one from .env.example"
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# Idempotently set KEY=VALUE in .env: replaces an existing line for KEY,
# appends if missing. Safe to re-run.
set_env_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

current_value() {
  grep -E "^${1}=" "$ENV_FILE" | head -n1 | cut -d= -f2-
}

# Generate a secret the first time only — never overwrites a value the user
# (or a previous run of this script) already set.
ensure_secret() {
  local key="$1"
  local value
  value="$(current_value "$key")"
  case "$value" in
    "" | change_this* )
      log "Generating $key"
      set_env_var "$key" "$(openssl rand -hex 32)"
      ;;
  esac
}

ensure_secret JWT_SECRET
ensure_secret JWT_REFRESH_SECRET
ensure_secret POSTGRES_PASSWORD

# Must reflect where this clone actually lives — apps/*/compose files resolve
# relative paths against this, both inside and outside the backend container.
log "Setting APPS_DIR to $(pwd)/apps"
set_env_var APPS_DIR "$(pwd)/apps"

if [ -S /var/run/docker.sock ]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock)"
  log "Setting DOCKER_GID to $DOCKER_GID (owner of /var/run/docker.sock)"
  set_env_var DOCKER_GID "$DOCKER_GID"

  # The backend writes each app's .env from the dashboard (no more manual
  # editing), which needs apps/ to be writable by DOCKER_GID inside the
  # container. Best-effort: harmless if it fails (e.g. not a member of that
  # group), just falls back to the old manual chgrp/chmod dance per app.
  if chgrp -R "$DOCKER_GID" apps/ 2>/dev/null && chmod -R g+rwX apps/ 2>/dev/null; then
    log "Set apps/ group ownership to gid $DOCKER_GID so the dashboard can write per-app config"
  else
    echo "warning: couldn't chgrp apps/ to gid ${DOCKER_GID} — per-app config saved from the dashboard may fail until you run:" >&2
    echo "  sudo chgrp -R ${DOCKER_GID} apps/" >&2
  fi
else
  echo "warning: /var/run/docker.sock not found — leaving DOCKER_GID as-is." >&2
fi

log "Building and starting the stack (this can take a few minutes on first run)"
docker compose up -d --build

FRONTEND_PORT="$(current_value FRONTEND_PORT)"
FRONTEND_PORT="${FRONTEND_PORT:-80}"

log "Waiting for the dashboard to respond on port ${FRONTEND_PORT}"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://localhost:${FRONTEND_PORT}" 2>/dev/null; then
    break
  fi
  sleep 2
done

cat <<EOF

Homelab Management is up.

  Dashboard: http://localhost:${FRONTEND_PORT}

First run: open the dashboard and complete /setup to create the first admin
account. Per-app secrets and public exposure are configured from the
dashboard's Settings — no further manual .env editing is required.
EOF
