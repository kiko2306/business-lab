#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

ROOT_DIR="."
PARENT_DIR=".."
ROOT_BASENAME="$(basename "$(pwd)")"
SECRETS_FILE="$ROOT_DIR/.cloudflare.env"

TARGET_CLIENT=""
UPDATE_ALL=0
DRY_RUN=0
APPLY_DELETE=0
INCLUDE_COMPOSE=0
NO_REBUILD=0

usage() {
  cat <<'EOF'
Usage:
  ./update-clients.sh --client <name>
  ./update-clients.sh --all

Options:
  --client <name>      Update one client folder in ../<name>
  --all                Update all detected client folders one level up
  --dry-run            Show what would change without writing
  --delete             Also delete files in target that no longer exist in source
  --include-compose    Also sync compose.yaml and how-to-cloudflre-access.md
  --no-rebuild         Do not run docker compose up -d --build after sync
  -h, --help           Show this help

Notes:
  - This script is intended to run from the setup folder in live env.
  - By default it preserves client-specific files:
    api/.env, compose.yaml, how-to-cloudflre-access.md
  - If BASE_DOMAIN is configured (env or .cloudflare.env), APP_URL is checked and corrected.
EOF
}

set_env_value() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local escaped_value

  escaped_value="$(printf '%s' "$value" | sed -e 's/[&|\\]/\\&/g')"

  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

resolve_expected_app_url() {
  local client="$1"
  local host

  if [[ -z "${BASE_DOMAIN:-}" ]]; then
    return 1
  fi

  if [[ -n "${APP_HOSTNAME:-}" ]]; then
    if [[ "$APP_HOSTNAME" == *"__CLIENT_NAME__"* ]]; then
      host="${APP_HOSTNAME//__CLIENT_NAME__/$client}"
    else
      host="$APP_HOSTNAME"
    fi
  else
    host="whotutils-${client}.${BASE_DOMAIN}"
  fi

  printf 'https://%s' "$host"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client)
      TARGET_CLIENT="${2:-}"
      shift 2
      ;;
    --all)
      UPDATE_ALL=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --delete)
      APPLY_DELETE=1
      shift
      ;;
    --include-compose)
      INCLUDE_COMPOSE=1
      shift
      ;;
    --no-rebuild)
      NO_REBUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but was not found in PATH."
  exit 1
fi

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
  set +a
fi

if [[ "$UPDATE_ALL" -eq 1 && -n "$TARGET_CLIENT" ]]; then
  echo "Error: use either --all or --client, not both."
  exit 1
fi

if [[ "$UPDATE_ALL" -eq 0 && -z "$TARGET_CLIENT" ]]; then
  read -r -p "Client name (or type 'all'): " ANSWER
  if [[ "$ANSWER" == "all" ]]; then
    UPDATE_ALL=1
  else
    TARGET_CLIENT="$ANSWER"
  fi
fi

declare -a CLIENTS

for dir in "$PARENT_DIR"/*; do
  [[ -d "$dir" ]] || continue
  base="$(basename "$dir")"

  [[ "$base" == "$ROOT_BASENAME" ]] && continue
  [[ "$base" == .* ]] && continue

  if [[ -f "$dir/compose.yaml" && -d "$dir/api" ]]; then
    CLIENTS+=("$base")
  fi
done

if [[ ${#CLIENTS[@]} -eq 0 ]]; then
  echo "Error: no client folders detected in $PARENT_DIR"
  exit 1
fi

declare -a TARGETS

if [[ "$UPDATE_ALL" -eq 1 ]]; then
  TARGETS=("${CLIENTS[@]}")
else
  found=0
  for c in "${CLIENTS[@]}"; do
    if [[ "$c" == "$TARGET_CLIENT" ]]; then
      found=1
      TARGETS+=("$c")
      break
    fi
  done

  if [[ "$found" -eq 0 ]]; then
    echo "Error: client '$TARGET_CLIENT' not found under $PARENT_DIR"
    echo "Detected clients: ${CLIENTS[*]}"
    exit 1
  fi
fi

declare -a RSYNC_ARGS
RSYNC_ARGS=(
  -a
  --exclude='.git/'
  --exclude='.idea/'
  --exclude='.DS_Store'
  --exclude='api/vendor/'
  --exclude='api/node_modules/'
  --exclude='api/storage/logs/*'
  --exclude='api/storage/framework/cache/*'
  --exclude='api/storage/framework/sessions/*'
  --exclude='api/storage/framework/views/*'
  --exclude='api/storage/debugbar/*'
  --exclude='api/.phpunit.result.cache'
  --exclude='api/error_log'
  --exclude='fe/error_log'
  --exclude='api/.env'
)

if [[ "$INCLUDE_COMPOSE" -eq 0 ]]; then
  RSYNC_ARGS+=(--exclude='compose.yaml' --exclude='how-to-cloudflre-access.md')
fi

if [[ "$APPLY_DELETE" -eq 1 ]]; then
  RSYNC_ARGS+=(--delete)
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi

echo "Source setup folder: $ROOT_DIR"
echo "Updating clients: ${TARGETS[*]}"

for client in "${TARGETS[@]}"; do
  target_dir="$PARENT_DIR/$client"
  echo "--- Syncing $client ---"
  rsync "${RSYNC_ARGS[@]}" "$ROOT_DIR/" "$target_dir/"

  expected_app_url="$(resolve_expected_app_url "$client" 2>/dev/null || true)"
  target_env_file="$target_dir/api/.env"

  if [[ -n "$expected_app_url" && -f "$target_env_file" ]]; then
    current_app_url="$(grep -E '^APP_URL=' "$target_env_file" | head -n1 | cut -d'=' -f2- || true)"

    if [[ "$current_app_url" != "$expected_app_url" ]]; then
      if [[ "$DRY_RUN" -eq 1 ]]; then
        echo "would update $client APP_URL: ${current_app_url:-<missing>} -> $expected_app_url"
      else
        set_env_value "$target_env_file" "APP_URL" "$expected_app_url"
        echo "updated $client APP_URL -> $expected_app_url"
      fi
    fi
  fi
done

echo "Done."

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run mode: containers were not rebuilt."
  exit 0
fi

if [[ "$NO_REBUILD" -eq 1 ]]; then
  echo "Rebuild skipped by --no-rebuild."
  exit 0
fi

echo "Rebuilding containers for updated clients..."
for client in "${TARGETS[@]}"; do
  target_dir="$PARENT_DIR/$client"
  echo "--- Rebuilding $client ---"
  (
    cd "$target_dir"
    docker compose up -d --build
  )
done

echo "Rebuild complete."
