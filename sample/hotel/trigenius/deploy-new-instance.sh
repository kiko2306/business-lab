#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

ROOT_DIR="."
PARENT_DIR=".."
DEFAULT_TUNNEL_NAME="pi-srv-live-01"
AUTO_START=1
LOCK_FILE="$ROOT_DIR/.deploy-new-instance.lock"
CLOUDFLARE_STATUS="not-configured"
SECRETS_FILE="$ROOT_DIR/.cloudflare.env"
STORAGE_LINK_STATUS="not-run"

usage() {
  cat <<'EOF'
Usage:
  ./deploy-new-instance.sh [--no-start]

Options:
  --no-start   Do not run docker compose up -d --build automatically
  -h, --help   Show this help

Optional Cloudflare env vars (for auto provisioning):
  CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID, BASE_DOMAIN
Optional hostname overrides:
  APP_HOSTNAME, PHPMYADMIN_HOSTNAME, MAILPIT_HOSTNAME
Optional local secrets file:
  ./.cloudflare.env (auto-loaded if present)
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

install_jq_if_missing() {
  if command -v jq >/dev/null 2>&1; then
    return 0
  fi

  echo "Cloudflare: jq not found, attempting automatic install..."

  run_with_privilege() {
    if [[ "$(id -u)" -eq 0 ]]; then
      "$@"
      return $?
    fi
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      sudo -n "$@"
      return $?
    fi
    return 1
  }

  if command -v apt-get >/dev/null 2>&1; then
    run_with_privilege apt-get update -y >/dev/null 2>&1 || true
    run_with_privilege apt-get install -y jq >/dev/null 2>&1 || true
  elif command -v dnf >/dev/null 2>&1; then
    run_with_privilege dnf install -y jq >/dev/null 2>&1 || true
  elif command -v yum >/dev/null 2>&1; then
    run_with_privilege yum install -y jq >/dev/null 2>&1 || true
  elif command -v apk >/dev/null 2>&1; then
    run_with_privilege apk add --no-cache jq >/dev/null 2>&1 || true
  elif command -v brew >/dev/null 2>&1; then
    brew install jq >/dev/null 2>&1 || true
  fi

  if command -v jq >/dev/null 2>&1; then
    echo "Cloudflare: jq installed successfully."
    return 0
  fi

  return 1
}

is_port_available() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
      return 1
    fi
    return 0
  fi

  if command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${port}$"; then
      return 1
    fi
    return 0
  fi

  echo "Error: neither ss nor netstat is available to check open ports."
  exit 1
}

find_first_sequential_port_block() {
  local first_port=1100
  local block_size=3

  while true; do
    local all_available=1
    local offset=0

    while [[ "$offset" -lt "$block_size" ]]; do
      local candidate_port=$((first_port + offset))
      if ! is_port_available "$candidate_port"; then
        all_available=0
        break
      fi
      offset=$((offset + 1))
    done

    if [[ "$all_available" -eq 1 ]]; then
      echo "$first_port"
      return 0
    fi

    first_port=$((first_port + 1))
  done
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

generate_laravel_app_key() {
  if command -v php >/dev/null 2>&1; then
    php -r 'echo "base64:" . base64_encode(random_bytes(32));'
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    printf 'base64:%s' "$(openssl rand -base64 32 | tr -d '\n')"
    return 0
  fi

  printf 'base64:%s' "$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
}

is_valid_laravel_app_key() {
  local key_value="$1"
  local payload decoded_len

  [[ "$key_value" == base64:* ]] || return 1
  payload="${key_value#base64:}"
  decoded_len="$(printf '%s' "$payload" | base64 --decode 2>/dev/null | wc -c | tr -d '[:space:]')"

  [[ "$decoded_len" == "32" ]]
}

link_storage_for_instance() {
  local target_dir="$1"

  if ! command -v docker >/dev/null 2>&1; then
    STORAGE_LINK_STATUS="skipped (docker not installed)"
    return 0
  fi

  if (
    cd "$target_dir"
    docker compose exec -T app php artisan storage:link --force
  ); then
    STORAGE_LINK_STATUS="linked"
  else
    STORAGE_LINK_STATUS="failed (run: cd ${target_dir} && docker compose exec -T app php artisan storage:link --force)"
  fi

  return 0
}

configure_cloudflare() {
  local client_name="$1"
  local app_port="$2"
  local pma_port="$3"
  local mailpit_ui_port="$4"

  if [[ -z "${CF_API_TOKEN:-}" || -z "${CF_ACCOUNT_ID:-}" || -z "${CF_ZONE_ID:-}" || -z "${BASE_DOMAIN:-}" ]]; then
    CLOUDFLARE_STATUS="skipped (set CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID, BASE_DOMAIN)"
    return 0
  fi

  if ! require_cmd curl; then
    CLOUDFLARE_STATUS="skipped (curl not installed)"
    return 0
  fi

  if ! install_jq_if_missing; then
    CLOUDFLARE_STATUS="skipped (jq not installed and auto-install failed)"
    return 0
  fi

  local app_hostname="${APP_HOSTNAME_RESOLVED:-${APP_HOSTNAME:-whotutils-${client_name}.${BASE_DOMAIN}}}"
  local pma_hostname="${PHPMYADMIN_HOSTNAME_RESOLVED:-${PHPMYADMIN_HOSTNAME:-phpmyadmin-${client_name}.${BASE_DOMAIN}}}"
  local mail_hostname="${MAILPIT_HOSTNAME_RESOLVED:-${MAILPIT_HOSTNAME:-mail-${client_name}.${BASE_DOMAIN}}}"

  echo "Cloudflare: ensuring tunnel ${DEFAULT_TUNNEL_NAME} and routes for:"
  echo "  - ${app_hostname}"
  echo "  - ${pma_hostname}"
  echo "  - ${mail_hostname}"

  local tunnel_lookup tunnel_id create_tunnel_response current_config_json current_ingress desired_ingress merged_ingress payload

  tunnel_lookup=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${DEFAULT_TUNNEL_NAME}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

  tunnel_id=$(echo "$tunnel_lookup" | jq -r '.result[0].id // empty')

  if [[ -z "$tunnel_id" ]]; then
    create_tunnel_response=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "{\"name\":\"${DEFAULT_TUNNEL_NAME}\",\"config_src\":\"cloudflare\"}")
    tunnel_id=$(echo "$create_tunnel_response" | jq -r '.result.id // empty')
  fi

  if [[ -z "$tunnel_id" ]]; then
    CLOUDFLARE_STATUS="failed (could not resolve tunnel id)"
    return 0
  fi

  current_config_json=$(curl -sS "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}/configurations" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

  current_ingress=$(echo "$current_config_json" | jq '.result.config.ingress // []')
  desired_ingress=$(jq -n \
    --arg app "$app_hostname" \
    --arg pma "$pma_hostname" \
    --arg mail "$mail_hostname" \
    --arg appService "http://localhost:${app_port}" \
    --arg pmaService "http://localhost:${pma_port}" \
    --arg mailService "http://localhost:${mailpit_ui_port}" \
    '[
      {"hostname": $app, "service": $appService},
      {"hostname": $pma, "service": $pmaService},
      {"hostname": $mail, "service": $mailService}
    ]')

  merged_ingress=$(jq -n \
    --argjson current "$current_ingress" \
    --argjson desired "$desired_ingress" \
    '
    ($current | map(select(
      .hostname != $desired[0].hostname and
      .hostname != $desired[1].hostname and
      .hostname != $desired[2].hostname and
      .service != "http_status:404"
    ))) + $desired + [{"service":"http_status:404"}]
    ')

  payload=$(jq -n --argjson ingress "$merged_ingress" '{"config": {"ingress": $ingress}}')

  curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${tunnel_id}/configurations" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$payload" >/dev/null

  upsert_cloudflare_cname() {
    local record_name="$1"
    local record_target="$2"
    local lookup existing_id

    lookup=$(curl -sS "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${record_name}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json")

    existing_id=$(echo "$lookup" | jq -r '.result[0].id // empty')

    if [[ -n "$existing_id" ]]; then
      curl -sS -X PUT "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${existing_id}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${record_target}\",\"proxied\":true}" >/dev/null
    else
      curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"CNAME\",\"name\":\"${record_name}\",\"content\":\"${record_target}\",\"proxied\":true}" >/dev/null
    fi
  }

  upsert_cloudflare_cname "$app_hostname" "${tunnel_id}.cfargotunnel.com"
  upsert_cloudflare_cname "$pma_hostname" "${tunnel_id}.cfargotunnel.com"
  upsert_cloudflare_cname "$mail_hostname" "${tunnel_id}.cfargotunnel.com"

  CLOUDFLARE_STATUS="configured (tunnel=${DEFAULT_TUNNEL_NAME}, id=${tunnel_id}, app=${app_hostname}, pma=${pma_hostname}, mail=${mail_hostname})"
}

if ! command -v rsync >/dev/null 2>&1; then
  echo "Error: rsync is required but was not found in PATH."
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-start)
      AUTO_START=0
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

if [[ -f "$SECRETS_FILE" ]]; then
  # Load local Cloudflare values without committing secrets to the repository.
  set -a
  # shellcheck disable=SC1090
  . "$SECRETS_FILE"
  set +a
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "Error: another deploy-new-instance.sh process is running."
    exit 1
  fi
else
  LOCK_DIR="$ROOT_DIR/.deploy-new-instance.lockdir"
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Error: another deploy-new-instance.sh process is running."
    exit 1
  fi
  trap 'rmdir "$LOCK_DIR" >/dev/null 2>&1 || true' EXIT
fi

read -r -p "Client name: " CLIENT_NAME_RAW

CLIENT_NAME="$(echo "$CLIENT_NAME_RAW" | tr '[:upper:]' '[:lower:]' | sed -E 's/[[:space:]]+/-/g; s/[^a-z0-9._-]//g; s/^-+|-+$//g')"
CLIENT_DB_KEY="$(echo "$CLIENT_NAME" | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g; s/_+/_/g' | cut -c1-48)"

if [[ -z "$CLIENT_DB_KEY" ]]; then
  CLIENT_DB_KEY="hotel_utils_client"
fi

if [[ -z "$CLIENT_NAME" ]]; then
  echo "Error: client name cannot be empty after normalization."
  exit 1
fi

TARGET_DIR="$PARENT_DIR/$CLIENT_NAME"

if [[ -e "$TARGET_DIR" ]]; then
  echo "Error: target directory already exists: $TARGET_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR"

rsync -a \
  --exclude '.git/' \
  --exclude '.idea/' \
  --exclude '.DS_Store' \
  --exclude 'api/vendor/' \
  --exclude 'api/node_modules/' \
  --exclude 'api/storage/logs/*' \
  --exclude 'api/storage/framework/cache/*' \
  --exclude 'api/storage/framework/sessions/*' \
  --exclude 'api/storage/framework/views/*' \
  --exclude 'api/storage/debugbar/*' \
  --exclude 'api/.phpunit.result.cache' \
  --exclude 'api/error_log' \
  --exclude 'fe/error_log' \
  --exclude 'api/.env' \
  "$ROOT_DIR/" "$TARGET_DIR/"

TARGET_COMPOSE_FILE="$TARGET_DIR/compose.yaml"
APP_IMAGE_NAME="$CLIENT_NAME-app:local"

PORT_BASE="$(find_first_sequential_port_block)"
PORT_APP="$PORT_BASE"
PORT_PHPMYADMIN="$((PORT_BASE + 1))"
PORT_MAILPIT_UI="$((PORT_BASE + 2))"

APP_HOSTNAME_RESOLVED=""
PHPMYADMIN_HOSTNAME_RESOLVED=""
MAILPIT_HOSTNAME_RESOLVED=""
APP_URL_VALUE="http://localhost:${PORT_APP}"

if [[ -n "${BASE_DOMAIN:-}" ]]; then
  APP_HOSTNAME_RESOLVED="${APP_HOSTNAME:-whotutils-${CLIENT_NAME}.${BASE_DOMAIN}}"
  PHPMYADMIN_HOSTNAME_RESOLVED="${PHPMYADMIN_HOSTNAME:-phpmyadmin-${CLIENT_NAME}.${BASE_DOMAIN}}"
  MAILPIT_HOSTNAME_RESOLVED="${MAILPIT_HOSTNAME:-mail-${CLIENT_NAME}.${BASE_DOMAIN}}"
  APP_URL_VALUE="https://${APP_HOSTNAME_RESOLVED}"
fi

if [[ -f "$TARGET_COMPOSE_FILE" ]]; then
  # Unique compose project name keeps containers, networks, and volumes isolated per client.
  if grep -q '^name:' "$TARGET_COMPOSE_FILE"; then
    sed -i "s/^name:.*/name: $CLIENT_NAME/" "$TARGET_COMPOSE_FILE"
  else
    { printf 'name: %s\n\n' "$CLIENT_NAME"; cat "$TARGET_COMPOSE_FILE"; } > "$TARGET_COMPOSE_FILE.tmp"
    mv "$TARGET_COMPOSE_FILE.tmp" "$TARGET_COMPOSE_FILE"
  fi

  # Keep built image names isolated too, so instances do not overwrite each other.
  sed -i "s|image: hotel-utils-app:local|image: $APP_IMAGE_NAME|g" "$TARGET_COMPOSE_FILE"

  # Assign a unique, sequential host port block for this instance.
  sed -i \
    -e "s|\"9201:80\"|\"${PORT_APP}:80\"|g" \
    -e "s|\"9202:80\"|\"${PORT_PHPMYADMIN}:80\"|g" \
    -e "s|\"9104:8025\"|\"${PORT_MAILPIT_UI}:8025\"|g" \
    "$TARGET_COMPOSE_FILE"
fi

TARGET_CLOUDFLARE_FILE="$TARGET_DIR/how-to-cloudflre-access.md"
if [[ -f "$TARGET_CLOUDFLARE_FILE" ]]; then
  sed -i "s|export TUNNEL_NAME=\".*\"|export TUNNEL_NAME=\"${DEFAULT_TUNNEL_NAME}\"|" "$TARGET_CLOUDFLARE_FILE"
  sed -i \
    -e "s|http://localhost:9201|http://localhost:${PORT_APP}|g" \
    -e "s|http://localhost:9202|http://localhost:${PORT_PHPMYADMIN}|g" \
    -e "s|http://localhost:9104|http://localhost:${PORT_MAILPIT_UI}|g" \
    "$TARGET_CLOUDFLARE_FILE"
fi

mkdir -p "$TARGET_DIR/api"
if [[ ! -f "$TARGET_DIR/api/.env" ]]; then
  if [[ -f "$TARGET_DIR/api/.env.example" ]]; then
    cp "$TARGET_DIR/api/.env.example" "$TARGET_DIR/api/.env"
  else
    : > "$TARGET_DIR/api/.env"
  fi
fi

TARGET_ENV_FILE="$TARGET_DIR/api/.env"
if [[ -f "$TARGET_ENV_FILE" ]]; then
  APP_KEY_CURRENT="$(grep -E '^APP_KEY=' "$TARGET_ENV_FILE" | head -n1 | cut -d'=' -f2- || true)"
  if [[ -z "$APP_KEY_CURRENT" ]] || ! is_valid_laravel_app_key "$APP_KEY_CURRENT"; then
    set_env_value "$TARGET_ENV_FILE" "APP_KEY" "$(generate_laravel_app_key)"
  fi

  set_env_value "$TARGET_ENV_FILE" "APP_NAME" "\"Hotel Utils - ${CLIENT_NAME}\""
  set_env_value "$TARGET_ENV_FILE" "APP_DEBUG" "false"
  set_env_value "$TARGET_ENV_FILE" "APP_URL" "$APP_URL_VALUE"
  set_env_value "$TARGET_ENV_FILE" "DB_CONNECTION" "mysql"
  set_env_value "$TARGET_ENV_FILE" "DB_HOST" "db"
  set_env_value "$TARGET_ENV_FILE" "DB_PORT" "3306"
  set_env_value "$TARGET_ENV_FILE" "DB_DATABASE" "$CLIENT_DB_KEY"
  set_env_value "$TARGET_ENV_FILE" "DB_USERNAME" "$CLIENT_DB_KEY"
  set_env_value "$TARGET_ENV_FILE" "DB_PASSWORD" "${CLIENT_NAME}@HotelUtils"
  set_env_value "$TARGET_ENV_FILE" "MAIL_MAILER" "smtp"
  set_env_value "$TARGET_ENV_FILE" "MAIL_HOST" "mailpit"
  set_env_value "$TARGET_ENV_FILE" "MAIL_PORT" "1025"
fi

configure_cloudflare "$CLIENT_NAME" "$PORT_APP" "$PORT_PHPMYADMIN" "$PORT_MAILPIT_UI" || {
  CLOUDFLARE_STATUS="failed (unexpected runtime error)"
}

if [[ "$AUTO_START" -eq 1 ]]; then
  echo "Starting containers for new instance..."
  (
    cd "$TARGET_DIR"
    docker compose up -d --build
  )
  link_storage_for_instance "$TARGET_DIR"
  CONTAINER_STATUS="started"
else
  CONTAINER_STATUS="not-started (--no-start)"
  STORAGE_LINK_STATUS="pending (run after start: cd ${TARGET_DIR} && docker compose exec -T app php artisan storage:link --force)"
fi

echo "Instance created: $TARGET_DIR"
echo "Ports: app=$PORT_APP, phpmyadmin=$PORT_PHPMYADMIN, mailpit-ui=$PORT_MAILPIT_UI"
echo "Env: DB_DATABASE=$CLIENT_DB_KEY DB_USERNAME=$CLIENT_DB_KEY DB_PASSWORD=${CLIENT_NAME}@HotelUtils"
echo "Env: APP_URL=$APP_URL_VALUE"
echo "Cloudflare: $CLOUDFLARE_STATUS"
echo "Containers: $CONTAINER_STATUS"
echo "Storage link: $STORAGE_LINK_STATUS"
