#!/usr/bin/env bash
# One-command bootstrap: installs Docker if missing, generates .env with
# safe defaults/secrets if needed, then builds and starts the full stack.
# Everything past this point (the first admin account, per-app secrets,
# exposure settings) is configured from the dashboard itself — see the
# printed URL at the end.
#
# Must be run with sudo (or as root): it installs system packages, manages
# the docker system service, and adds the invoking user to the docker group.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

log() { printf '==> %s\n' "$1"; }
warn() { printf 'warning: %s\n' "$1" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  echo "error: this script installs system packages and manages services — run it with sudo:" >&2
  echo "  sudo ./start.sh" >&2
  exit 1
fi

# The real, non-root user who ran `sudo ./start.sh` — added to the docker
# group at the end so they don't need sudo for docker/compose afterwards.
# Falls back to "root" if invoked directly as root (e.g. a root login shell),
# in which case there is no separate user to add to the group.
TARGET_USER="${SUDO_USER:-root}"

# Whether systemd is actually running as PID 1 — not merely whether the
# systemctl binary exists. WSL ships systemctl but does not boot systemd unless
# it is explicitly turned on, and everything to do with the Cloudflare Tunnel
# connector below depends on it. /run/systemd/system is the canonical marker.
HAS_SYSTEMD=0
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
  HAS_SYSTEMD=1
fi

IS_WSL=0
if grep -qi 'microsoft\|WSL' /proc/version 2>/dev/null; then
  IS_WSL=1
fi

# Warn up front rather than letting this be discovered later. Without systemd
# the tunnel connector is never installed or started, yet everything else here
# still succeeds — so the run looks fine while the one piece that publishes
# this host to the internet is missing.
if [ "$HAS_SYSTEMD" -eq 0 ]; then
  echo >&2
  echo "=============================================================" >&2
  echo " WARNING: systemd is not running as PID 1." >&2
  echo >&2
  echo " The Cloudflare Tunnel connector cannot be installed or" >&2
  echo " started without it, so nothing on this host will be" >&2
  echo " reachable from the internet. Everything else — Docker, the" >&2
  echo " dashboard, the generated config — will still come up, so" >&2
  echo " this is easy to miss." >&2
  if [ "$IS_WSL" -eq 1 ]; then
    echo >&2
    echo " Detected WSL, which does not enable systemd by default." >&2
    echo " To fix, add to /etc/wsl.conf:" >&2
    echo >&2
    echo "     [boot]" >&2
    echo "     systemd=true" >&2
    echo >&2
    echo " then from Windows run 'wsl --shutdown', reopen the distro," >&2
    echo " and re-run this script. Verify with:" >&2
    echo "     test -d /run/systemd/system && echo systemd-ok" >&2
  fi
  echo "=============================================================" >&2
  echo >&2
fi

if command -v apt-get >/dev/null 2>&1; then
  APT_MISSING=()
  for bin_pkg in "curl:curl" "openssl:openssl" "gnupg:gnupg" "ca-certificates:ca-certificates" "python3:python3"; do
    bin="${bin_pkg%%:*}"
    pkg="${bin_pkg##*:}"
    if ! command -v "$bin" >/dev/null 2>&1; then
      APT_MISSING+=("$pkg")
    fi
  done
  if [ "${#APT_MISSING[@]}" -gt 0 ]; then
    log "Installing missing packages: ${APT_MISSING[*]}"
    apt-get update -qq
    apt-get install -y -qq "${APT_MISSING[@]}"
  fi
else
  warn "No 'apt-get' found — this script only automates dependency installation on Ubuntu/Debian."
  warn "Continuing on the assumption docker, docker compose, openssl, and curl are already installed."
fi

for bin in curl openssl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' is required but not found on PATH, and could not be installed automatically." >&2
    exit 1
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  log "Docker not found — installing via the official Docker install script (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi

if command -v systemctl >/dev/null 2>&1; then
  log "Enabling and starting the docker service"
  systemctl enable --now docker >/dev/null 2>&1 || warn "couldn't enable/start the docker service via systemctl — is it running already under a different init system?"
fi

# Every managed app is its own compose project with its own bridge network.
# Docker's default address pool only fits ~31 user networks before
# `all predefined address pools have been fully subnetted` and new apps can't
# start. Widen it — /24 networks out of a couple of /16 bases = 512 slots.
# 10.201/16 is picked to be unlikely to clash with a home LAN.
DOCKER_DAEMON_JSON="/etc/docker/daemon.json"
if [ ! -f "$DOCKER_DAEMON_JSON" ]; then
  log "Setting a wider Docker default-address-pool (per-app networks) in $DOCKER_DAEMON_JSON"
  mkdir -p /etc/docker
  cat > "$DOCKER_DAEMON_JSON" <<'JSON'
{
  "default-address-pools": [
    { "base": "10.201.0.0/16", "size": 24 },
    { "base": "172.31.0.0/16", "size": 24 }
  ]
}
JSON
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart docker >/dev/null 2>&1 && log "restarted docker to apply the address-pool change" \
      || warn "couldn't restart docker — apply $DOCKER_DAEMON_JSON and restart it manually"
  else
    warn "restart the Docker daemon to apply $DOCKER_DAEMON_JSON"
  fi
elif ! grep -q 'default-address-pools' "$DOCKER_DAEMON_JSON"; then
  warn "$DOCKER_DAEMON_JSON exists without 'default-address-pools' — add one (see the block start.sh would write) or new app networks will eventually fail with 'all predefined address pools have been fully subnetted'"
fi

# NetBird's native gRPC management API only survives the Cloudflare Tunnel if
# the connector is pinned to HTTP/2. (Signal is a separate problem the http2
# transport does NOT solve — it goes over Tailscale Funnel; see the Funnel
# phase near the end of this script and plan.md §52/§53.) cloudflared's default QUIC
# backbone silently drops HTTP/2 trailers: gRPC responses still arrive as a
# 200 with a correct body, but with no grpc-status trailer, so grpc-go reports
# "server closed the stream without sending trailers" and NetBird clients
# retry the same call forever with nothing in any log looking like an error.
# The setting lives in a systemd drop-in — host state this repo doesn't
# otherwise own — so re-assert it on every bootstrap, or a rebuilt host
# silently loses it. See plan.md §46.
#
# Deliberately written as an environment variable rather than by rewriting
# ExecStart with --protocol: cloudflared is NOT installed by this script (it's
# a separate host service), so on a fresh machine it usually doesn't exist yet
# at this point. systemd applies drop-ins whenever the unit later appears, so
# an Environment= drop-in works regardless of install order, and needs to know
# nothing about the unit's ExecStart (whose token path/flags vary per host).
# An explicit --protocol flag on the command line still wins over this, so a
# deliberate per-host choice is not overridden.
CF_DROPIN_DIR="/etc/systemd/system/cloudflared.service.d"
CF_DROPIN="$CF_DROPIN_DIR/10-grpc-http2.conf"
if [ ! -f "$CF_DROPIN" ] || ! grep -q 'TUNNEL_TRANSPORT_PROTOCOL=http2' "$CF_DROPIN" 2>/dev/null; then
  log "Pinning cloudflared to the http2 transport (gRPC trailers; see plan.md §46)"
  mkdir -p "$CF_DROPIN_DIR"
  cat > "$CF_DROPIN" <<'UNIT'
# Managed by start.sh — see plan.md §46.
# cloudflared's default QUIC backbone silently drops HTTP/2 trailers, which
# breaks every gRPC service behind the tunnel (NetBird management; signal now
# goes over Tailscale Funnel instead, see the Funnel phase below):
# responses arrive as a 200 with a correct body but no grpc-status trailer, and
# clients then retry forever with nothing that looks like an error in any log.
[Service]
Environment=TUNNEL_TRANSPORT_PROTOCOL=http2
UNIT
fi
# Apply it now only if cloudflared is actually installed here; otherwise the
# drop-in just sits waiting for whenever it gets installed.
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl is-active --quiet cloudflared 2>/dev/null; then
    systemctl restart cloudflared >/dev/null 2>&1 \
      && log "restarted cloudflared on the http2 transport" \
      || warn "wrote $CF_DROPIN but couldn't restart cloudflared — restart it manually"
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Docker Compose plugin not found — installing docker-compose-plugin"
    apt-get update -qq
    apt-get install -y -qq docker-compose-plugin
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "error: 'docker compose' (the Compose plugin) is required and could not be installed automatically." >&2
    exit 1
  fi
fi

if [ "$TARGET_USER" != "root" ] && ! id -nG "$TARGET_USER" 2>/dev/null | grep -qw docker; then
  log "Adding user '$TARGET_USER' to the docker group (log out and back in for this to take effect)"
  usermod -aG docker "$TARGET_USER"
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

# ---------------------------------------------------------------------------
# Cloudflare / base-domain bootstrap
#
# Everything below exists so a fresh server ends up with a working NetBird
# without anyone hand-editing config files. It is all idempotent: values
# already in .env are reused, an existing tunnel is looked up rather than
# recreated, and an already-installed connector is left alone.
# ---------------------------------------------------------------------------

# Same idempotent set/read as .env, against an arbitrary app's .env file.
set_app_env_var() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    if [ -f "${file}.example" ]; then cp "${file}.example" "$file"; else : >"$file"; fi
    chmod 600 "$file"
  fi
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file" && rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

app_env_value() {
  [ -f "$1" ] || return 0
  grep -E "^${2}=" "$1" | head -n1 | cut -d= -f2-
}

# Fill a placeholder secret in an app's .env, once. Never overwrites a real value.
ensure_app_secret() {
  local file="$1" key="$2" value
  value="$(app_env_value "$file" "$key")"
  case "$value" in
    "" | change-me* | change_this* )
      set_app_env_var "$file" "$key" "$(openssl rand -hex 64)"
      ;;
  esac
}

# Ask for a value once and remember it in .env. Returns non-zero (without
# prompting) when there's nothing set and no TTY to ask on, so an unattended
# re-run degrades to "skip the Cloudflare setup" instead of hanging forever.
prompt_env_var() {
  local key="$1" prompt="$2" default="${3:-}" silent="${4:-}" value
  value="$(current_value "$key")"
  case "$value" in "" | change_this* ) value="" ;; esac
  if [ -n "$value" ]; then return 0; fi
  if [ ! -t 0 ]; then return 1; fi
  while [ -z "$value" ]; do
    if [ -n "$silent" ]; then
      printf '%s: ' "$prompt" >&2; read -r -s value; printf '\n' >&2
    elif [ -n "$default" ]; then
      printf '%s [%s]: ' "$prompt" "$default" >&2; read -r value; value="${value:-$default}"
    else
      printf '%s: ' "$prompt" >&2; read -r value
    fi
  done
  set_env_var "$key" "$value"
}

# Reads a top-level field out of a Cloudflare API response. python3 rather than
# jq because jq isn't in this script's package list and python3 already is.
json_field() { python3 -c 'import json,sys;d=json.load(sys.stdin);print(eval("d"+sys.argv[1]) if d.get("success") else "")' "$1" 2>/dev/null || true; }

cf_api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H 'Content-Type: application/json' --data "$body" \
      "https://api.cloudflare.com/client/v4${path}" 2>/dev/null || true
  else
    curl -fsS -X "$method" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      "https://api.cloudflare.com/client/v4${path}" 2>/dev/null || true
  fi
}

CF_READY=0
if prompt_env_var BASE_DOMAIN "Base domain for published services (e.g. example.com)" \
  && prompt_env_var CLOUDFLARE_API_TOKEN "Cloudflare API token (Tunnel:Edit + DNS:Edit)" "" silent \
  && prompt_env_var TUNNEL_NAME "Cloudflare Tunnel name for this host" "$(hostname -s 2>/dev/null || hostname)"; then
  CF_READY=1
else
  warn "BASE_DOMAIN / CLOUDFLARE_API_TOKEN not set and no terminal to prompt on — skipping Cloudflare + NetBird auto-setup. Re-run interactively to finish it."
fi

# Tailscale is asked for here, next to Cloudflare, because it is the same kind
# of prerequisite: an account and a key that must exist before this script can
# finish. It is not optional decoration — NetBird's signal server is published
# through Tailscale Funnel and cannot work through the Cloudflare Tunnel at
# all (plan.md §52/§53), so without this NetBird has no working signalling and
# no peer ever connects.
#
# Get a key from https://login.tailscale.com/admin/settings/keys (a reusable
# auth key is easiest). Funnel additionally needs enabling once for the
# tailnet; the Funnel phase near the end of this script prints the one-click
# link if it is not.
TS_READY=0
if prompt_env_var TAILSCALE_AUTH_KEY "Tailscale auth key (tskey-auth-...; needed for NetBird signalling)" "" silent; then
  TS_READY=1
else
  warn "TAILSCALE_AUTH_KEY not set and no terminal to prompt on — NetBird signalling will not be configured."
fi

BASE_DOMAIN="$(current_value BASE_DOMAIN)"

if [ "$CF_READY" = "1" ]; then
  CLOUDFLARE_API_TOKEN="$(current_value CLOUDFLARE_API_TOKEN)"
  TUNNEL_NAME="$(current_value TUNNEL_NAME)"

  # One call yields both ids — the zone record carries its owning account.
  ZONE_JSON="$(cf_api GET "/zones?name=${BASE_DOMAIN}")"
  CF_ZONE_ID="$(printf '%s' "$ZONE_JSON" | json_field '["result"][0]["id"]')"
  CF_ACCOUNT_ID="$(printf '%s' "$ZONE_JSON" | json_field '["result"][0]["account"]["id"]')"

  if [ -z "$CF_ZONE_ID" ] || [ -z "$CF_ACCOUNT_ID" ]; then
    warn "Couldn't look up zone '${BASE_DOMAIN}' with that Cloudflare token — check the token's permissions and that the domain is in this account. Skipping tunnel setup."
    CF_READY=0
  else
    set_env_var CLOUDFLARE_ZONE_ID "$CF_ZONE_ID"
    set_env_var CLOUDFLARE_ACCOUNT_ID "$CF_ACCOUNT_ID"

    CF_TUNNEL_ID="$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false" \
      | json_field '["result"][0]["id"]')"

    if [ -z "$CF_TUNNEL_ID" ]; then
      log "Creating Cloudflare Tunnel '${TUNNEL_NAME}'"
      # config_src MUST be "cloudflare" (remotely-managed). The dashboard
      # publishes each service's ingress with
      # PUT /cfd_tunnel/{id}/configurations (see cloudflareTunnelClient.ts);
      # against a locally-configured tunnel that call is accepted but the
      # connector never reads it, so every exposure would silently 404.
      CF_TUNNEL_ID="$(cf_api POST "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
        "{\"name\":\"${TUNNEL_NAME}\",\"config_src\":\"cloudflare\"}" \
        | json_field '["result"]["id"]')"
    else
      log "Reusing existing Cloudflare Tunnel '${TUNNEL_NAME}'"
    fi

    if [ -z "$CF_TUNNEL_ID" ]; then
      warn "Couldn't create or find the tunnel — skipping connector install."
      CF_READY=0
    else
      set_env_var CLOUDFLARE_TUNNEL_ID "$CF_TUNNEL_ID"

      if ! command -v cloudflared >/dev/null 2>&1; then
        case "$(uname -m)" in
          x86_64) CF_ARCH=amd64 ;;
          aarch64|arm64) CF_ARCH=arm64 ;;
          armv7l|armhf) CF_ARCH=arm ;;
          *) CF_ARCH="" ;;
        esac
        if [ -n "$CF_ARCH" ] && command -v dpkg >/dev/null 2>&1; then
          log "Installing cloudflared (linux-${CF_ARCH})"
          if curl -fsSL -o /tmp/cloudflared.deb \
            "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"; then
            dpkg -i /tmp/cloudflared.deb >/dev/null 2>&1 || warn "cloudflared package install failed"
            rm -f /tmp/cloudflared.deb
          else
            warn "couldn't download cloudflared — install it manually"
          fi
        else
          warn "don't know how to install cloudflared on this platform — install it manually"
        fi
      fi

      # Only install the service if there isn't one already: re-running must not
      # repoint an existing connector (possibly serving a different tunnel).
      # Requires systemd — `cloudflared service install` writes a unit, so
      # without it we'd leave behind a unit that never runs and report success.
      if [ "$HAS_SYSTEMD" -eq 0 ]; then
        warn "skipping the cloudflared connector install — no systemd (see the warning at the top). The tunnel '${TUNNEL_NAME}' exists in Cloudflare but nothing on this host is serving it yet."
      elif command -v cloudflared >/dev/null 2>&1 \
        && ! systemctl list-unit-files cloudflared.service >/dev/null 2>&1; then
        CF_CONNECTOR_TOKEN="$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/token" \
          | json_field '["result"]')"
        if [ -n "$CF_CONNECTOR_TOKEN" ]; then
          log "Installing the cloudflared connector service for '${TUNNEL_NAME}'"
          cloudflared service install "$CF_CONNECTOR_TOKEN" >/dev/null 2>&1 \
            || warn "cloudflared service install failed — run it manually"
          # The http2 drop-in written earlier applies from here on; the unit was
          # created after it, so make sure it's actually picked up.
          systemctl daemon-reload >/dev/null 2>&1 || true
          systemctl restart cloudflared >/dev/null 2>&1 || true
          unset CF_CONNECTOR_TOKEN
        else
          warn "couldn't retrieve the tunnel's connector token — install the service manually"
        fi
      fi
    fi
  fi
fi

# --- Per-app config that used to be hand-edited --------------------------

if [ -n "$BASE_DOMAIN" ]; then
  # Authelia and NetBird both template every hostname from this rather than
  # hardcoding a domain (see apps/authelia/config/configuration.yml and
  # apps/netbird-vpn/docker-compose.yml).
  set_app_env_var apps/authelia/.env BASE_DOMAIN "$BASE_DOMAIN"
  set_app_env_var apps/netbird-vpn/.env BASE_DOMAIN "$BASE_DOMAIN"

  # Authelia refuses to start without these, and they have no safe defaults.
  ensure_app_secret apps/authelia/.env AUTHELIA_SESSION_SECRET
  ensure_app_secret apps/authelia/.env AUTHELIA_STORAGE_ENCRYPTION_KEY
  ensure_app_secret apps/authelia/.env AUTHELIA_JWT_SECRET
  ensure_app_secret apps/authelia/.env AUTHELIA_OIDC_HMAC_SECRET

  # Authelia's user database is gitignored (it holds the password hash for the
  # account guarding every exposed app), so a fresh clone has only the
  # template. Authelia won't start without the real file.
  if [ ! -f apps/authelia/config/users_database.yml ]; then
    log "Creating Authelia's users_database.yml from the template"
    cp apps/authelia/config/users_database.yml.example apps/authelia/config/users_database.yml
    chmod 600 apps/authelia/config/users_database.yml
    warn "apps/authelia/config/users_database.yml has a PLACEHOLDER password — set a real one before exposing anything (see the file's header, or the dashboard's Settings)"
  fi

  # Authelia's OIDC signing key can't live in the tracked config (it's a
  # private key), so it's merged in from this gitignored second file.
  if [ ! -f apps/authelia/data/oidc-secrets.yml ]; then
    log "Generating Authelia's OIDC signing key"
    mkdir -p apps/authelia/data
    {
      printf 'identity_providers:\n  oidc:\n    jwks:\n'
      printf "      - key_id: 'main'\n        algorithm: 'RS256'\n        use: 'sig'\n        key: |\n"
      openssl genrsa 4096 2>/dev/null | sed 's/^/          /'
    } > apps/authelia/data/oidc-secrets.yml
    chmod 600 apps/authelia/data/oidc-secrets.yml
  fi

  # Relay's shared HMAC secret. Lives in .env (consumed by the relay
  # container) and must be substituted identically into data/management.json
  # below, so generate it before that step.
  ensure_app_secret apps/netbird-vpn/.env NETBIRD_RELAY_AUTH_SECRET

  # NetBird's working config: the tracked template with the domain filled in
  # and a real store-encryption key generated. Never regenerated — the key
  # encrypts existing data.
  if [ ! -f apps/netbird-vpn/data/management.json ]; then
    log "Generating NetBird's management.json for ${BASE_DOMAIN}"
    mkdir -p apps/netbird-vpn/data
    # NETBIRD_SIGNAL_HOSTNAME is usually still blank here: it comes from the
    # tailscale container's Funnel name, and the tailscale app isn't running
    # yet at this point. The Funnel phase near the end of this script fills it
    # in and rewrites Signal.URI in place. A placeholder keeps the template
    # valid JSON meanwhile.
    BASE_DOMAIN="$BASE_DOMAIN" \
    NETBIRD_RELAY_AUTH_SECRET="$(app_env_value apps/netbird-vpn/.env NETBIRD_RELAY_AUTH_SECRET)" \
    NETBIRD_SIGNAL_HOSTNAME="$(app_env_value apps/netbird-vpn/.env NETBIRD_SIGNAL_HOSTNAME)" \
    python3 - <<'PY'
import base64, json, os, secrets
tpl = open('apps/netbird-vpn/config/management.json.example').read()
tpl = tpl.replace('${BASE_DOMAIN}', os.environ['BASE_DOMAIN'])
tpl = tpl.replace('${NETBIRD_RELAY_AUTH_SECRET}', os.environ['NETBIRD_RELAY_AUTH_SECRET'])
tpl = tpl.replace('${NETBIRD_SIGNAL_HOSTNAME}', os.environ.get('NETBIRD_SIGNAL_HOSTNAME') or 'signal-not-configured.invalid')
cfg = json.loads(tpl)
cfg['DataStoreEncryptionKey'] = base64.b64encode(secrets.token_bytes(32)).decode()
json.dump(cfg, open('apps/netbird-vpn/data/management.json', 'w'), indent=2)
PY
    chmod 600 apps/netbird-vpn/data/management.json
  fi
fi

if [ -S /var/run/docker.sock ]; then
  DOCKER_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock)"
  log "Setting DOCKER_GID to $DOCKER_GID (owner of /var/run/docker.sock)"
  set_env_var DOCKER_GID "$DOCKER_GID"

  # The backend writes each app's .env (and other config) from the
  # dashboard, which needs every apps/<name>/ directory to be writable by
  # DOCKER_GID inside the container. Applied per-directory, on every run
  # (not just first install), so a directory added later — e.g. a new app
  # pulled in by `git pull`, which lands owned by whichever user ran that
  # command rather than DOCKER_GID — is always picked up, and one directory
  # that can't be fixed (e.g. a container-owned data volume) doesn't stop
  # the rest from being fixed too.
  FAILED_APP_DIRS=()
  for app_dir in apps/*/; do
    [ -d "$app_dir" ] || continue
    if ! { chgrp -R "$DOCKER_GID" "$app_dir" && chmod -R g+rwX "$app_dir"; } 2>/dev/null; then
      FAILED_APP_DIRS+=("$app_dir")
    fi
  done

  if [ "${#FAILED_APP_DIRS[@]}" -eq 0 ]; then
    log "Set apps/*/ group ownership to gid $DOCKER_GID so the dashboard can write per-app config"
  else
    echo "warning: couldn't chgrp/chmod the following app directories to gid ${DOCKER_GID} — per-app config saved from the dashboard may fail for them until you run:" >&2
    for app_dir in "${FAILED_APP_DIRS[@]}"; do
      echo "  sudo chgrp -R ${DOCKER_GID} ${app_dir} && sudo chmod -R g+rwX ${app_dir}" >&2
    done
  fi
else
  echo "warning: /var/run/docker.sock not found — leaving DOCKER_GID as-is." >&2
fi

# --- App host-port allocation ---------------------------------------------
#
# Every managed app publishes a host port. Left to upstream defaults these
# collide: before this scheme, port 80 was claimed by bookstack, NPM *and*
# speedtest, 8080 by file-browser, netbird-management and pihole-web, and
# home-page defaulted to 3000 — the backend's own port. Colliding apps simply
# fail to start, one at a time, as they are enabled.
#
# So every app's default now lives at 10100+, and this block resolves what is
# left: if a port is already taken on this host (by another app here, or by
# something outside this project entirely), the next free one is assigned and
# written to that app's .env.
#
# Only ports whose compose default is >= 10000 are managed. That rule is what
# protects the deliberate exceptions — NPM's 80/443 (cloudflared's origin) and
# pihole's 53 (DNS has to be on 53) — without needing a list of them here.
#
# An existing value in an app's .env always wins: this must never move a port
# the user chose in the dashboard, or renumber a working install on upgrade.
log "Allocating host ports for managed apps"
python3 - <<'PORTALLOCPY' || warn "port allocation failed — apps keep their compose defaults, which may collide"
import glob, os, re, shutil, socket

MANAGED_FLOOR = 10000

def parse_env(path):
    vals = {}
    if os.path.exists(path):
        for line in open(path, errors='replace'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                vals[k.strip()] = v.strip()
    return vals

def port_free(p):
    # Bind-test rather than parsing ss: this is what actually decides whether
    # Docker can publish the port, and it covers IPv4 and IPv6 separately.
    for fam, addr in ((socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')):
        try:
            s = socket.socket(fam, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind((addr, p))
            s.close()
        except OSError:
            return False
        except Exception:
            pass
    return True

composes = sorted(glob.glob('apps/*/docker-compose.yml') + glob.glob('apps/*/compose.yaml'))

# Pass 1 — seed every missing .env from its .env.example, exactly as
# set_app_env_var does. This MUST happen before anything reads a port: on a
# fresh clone no app has a .env, and an example that already pins a port is
# the app's real choice. Deciding first and seeding afterwards would let the
# example silently overwrite the allocation, so the log would claim one port
# while the file held another.
for f in composes:
    env_path = os.path.join(os.path.dirname(f), '.env')
    example = env_path + '.example'
    if not os.path.exists(env_path) and os.path.exists(example):
        shutil.copyfile(example, env_path)
        os.chmod(env_path, 0o600)

# Pass 2 — every port now pinned in some app's .env is off-limits to others.
claimed = set()
for f in composes:
    for k, v in parse_env(os.path.join(os.path.dirname(f), '.env')).items():
        if k.endswith('_PORT') and v.isdigit():
            claimed.add(int(v))

# Pass 3 — allocate what is still unset.
assigned = []
for f in composes:
    app_dir = os.path.dirname(f)
    env_path = os.path.join(app_dir, '.env')
    env = parse_env(env_path)
    text = open(f, errors='replace').read()

    for m in re.finditer(r'^\s*-\s*"?\$\{([A-Z0-9_]+):-(\d+)\}:\d+', text, re.M):
        var, default = m.group(1), int(m.group(2))
        if default < MANAGED_FLOOR:
            continue                      # deliberate protocol port, leave alone
        if var in env and env[var].isdigit():
            continue                      # user's / existing choice wins

        port = default
        while (port in claimed) or (not port_free(port)):
            port += 1
        claimed.add(port)

        lines = open(env_path, errors='replace').read().splitlines(True) if os.path.exists(env_path) else []
        if lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        lines.append(f'{var}={port}\n')
        open(env_path, 'w').writelines(lines)
        env[var] = str(port)
        if port != default:
            assigned.append(f'{os.path.basename(app_dir)}: {var}={port} (default {default} was taken)')

for line in assigned:
    print('==> ' + line)
PORTALLOCPY

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

# Seed the dashboard's exposure settings from what was collected above, so the
# Cloudflare/base-domain fields are already filled in on first login instead of
# having to be retyped. Runs here because it needs the database container up.
# Only fills blanks — a value already set from the dashboard always wins.
if [ "$CF_READY" = "1" ]; then
  DB_USER="$(current_value POSTGRES_USER)"; DB_USER="${DB_USER:-homelab}"
  DB_NAME="$(current_value POSTGRES_DB)"; DB_NAME="${DB_NAME:-homelab}"
  DB_CID="$(docker compose ps -q database 2>/dev/null || true)"
  if [ -n "$DB_CID" ]; then
    seed_setting() {
      [ -n "$2" ] || return 0
      docker exec -i "$DB_CID" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
        -c "INSERT INTO settings (key, value) VALUES ('$1', '$2')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            WHERE settings.value IS NULL OR settings.value = '';" >/dev/null 2>&1 || true
    }
    log "Seeding the dashboard's exposure settings"
    seed_setting exposure_base_domain "$BASE_DOMAIN"
    seed_setting cloudflare_tunnel_token "$(current_value CLOUDFLARE_API_TOKEN)"
    seed_setting exposure_cloudflare_account_id "$(current_value CLOUDFLARE_ACCOUNT_ID)"
    seed_setting exposure_cloudflare_zone_id "$(current_value CLOUDFLARE_ZONE_ID)"
    seed_setting exposure_cloudflare_tunnel_id "$(current_value CLOUDFLARE_TUNNEL_ID)"
    # NPM's admin API, where the dashboard creates proxy hosts. Derived rather
    # than typed: the port is allocated dynamically (see the port-allocation
    # block above), so a hardcoded value goes stale the moment it moves — and
    # a stale value fails every exposure with ECONNREFUSED, which looks like a
    # Cloudflare problem rather than a wrong port. The docker bridge gateway
    # is reachable both from the backend container and from cloudflared on the
    # host, which is what getNpmGrpcOriginUrl needs.
    NPM_GW="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
    NPM_PORT="$(app_env_value apps/nginx-proxy-manager/.env NPM_ADMIN_PORT)"
    NPM_PORT="${NPM_PORT:-10270}"
    [ -n "$NPM_GW" ] && seed_setting exposure_npm_api_url "http://${NPM_GW}:${NPM_PORT}"
  else
    warn "database container not found — fill the Cloudflare fields in Settings manually"
  fi
fi

# --- Publish the dashboard itself -----------------------------------------
#
# Every managed app is published by the dashboard's own exposure system, which
# routes cloudflared -> Nginx Proxy Manager -> app. The dashboard cannot use
# that: it is not a managed app, and pointing it through NPM would make the one
# tool you would use to repair a broken NPM depend on NPM being healthy.
#
# So its ingress rule goes straight to the published frontend port on
# localhost, deliberately bypassing NPM (see plan.md §58). That keeps the
# dashboard reachable whenever cloudflared and the container are up, whatever
# state the proxy is in.
#
# The API is NOT published. The frontend proxies /api to the backend over the
# compose network (see frontend/nginx.conf), so a public API hostname adds
# attack surface without adding capability.
if [ "$CF_READY" = "1" ] && [ -n "$BASE_DOMAIN" ] && [ -n "${CF_TUNNEL_ID:-}" ]; then
  DASH_SUB="$(current_value DASHBOARD_SUBDOMAIN)"
  DASH_SUB="${DASH_SUB:-homelab}"
  DASH_HOST="${DASH_SUB}.${BASE_DOMAIN}"
  DASH_PORT="$(current_value FRONTEND_PORT)"
  DASH_PORT="${DASH_PORT:-10001}"

  # Merge into the tunnel's existing ingress rather than replacing it — the
  # dashboard writes app rules into the same config, and a blind PUT here
  # would delete every one of them.
  CF_CFG="$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/configurations")"
  DASH_MERGED="$(printf '%s' "$CF_CFG" | DASH_HOST="$DASH_HOST" DASH_PORT="$DASH_PORT" python3 -c '
import json, os, sys
host, port = os.environ["DASH_HOST"], os.environ["DASH_PORT"]
try:
    cfg = (json.load(sys.stdin).get("result") or {}).get("config") or {}
except Exception:
    sys.exit(1)
ingress = [r for r in (cfg.get("ingress") or []) if r.get("hostname")]
want = {"hostname": host, "service": f"http://localhost:{port}"}
existing = next((r for r in ingress if r.get("hostname") == host), None)
if existing and existing.get("service") == want["service"]:
    sys.exit(2)                      # already correct, nothing to write
ingress = [r for r in ingress if r.get("hostname") != host] + [want]
ingress.append({"service": "http_status:404"})   # catch-all must stay last
print(json.dumps({"config": {**cfg, "ingress": ingress}}))
' 2>/dev/null)"
  DASH_RC=$?

  if [ "$DASH_RC" = "2" ]; then
    log "Dashboard already published at https://${DASH_HOST}"
  elif [ -n "$DASH_MERGED" ]; then
    if cf_api PUT "/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${CF_TUNNEL_ID}/configurations" "$DASH_MERGED" >/dev/null; then
      log "Published the dashboard at https://${DASH_HOST} (direct to localhost:${DASH_PORT}, not via NPM)"
    else
      warn "couldn't add the dashboard's tunnel ingress rule — reach it at http://<this-host>:${DASH_PORT} meanwhile"
    fi

    # DNS record, pointed at the tunnel. Only created when absent: an existing
    # record may be deliberate, and overwriting someone's A record would be
    # destructive.
    DASH_DNS="$(cf_api GET "/zones/${CF_ZONE_ID}/dns_records?name=${DASH_HOST}" | json_field '["result"][0]["id"]')"
    if [ -z "$DASH_DNS" ]; then
      cf_api POST "/zones/${CF_ZONE_ID}/dns_records" \
        "{\"type\":\"CNAME\",\"name\":\"${DASH_HOST}\",\"content\":\"${CF_TUNNEL_ID}.cfargotunnel.com\",\"proxied\":true,\"ttl\":1}" \
        >/dev/null && log "Created the DNS record for ${DASH_HOST}" \
        || warn "couldn't create the DNS record for ${DASH_HOST}"
    fi
  else
    warn "couldn't read the tunnel configuration — skipping the dashboard's public hostname"
  fi
fi

# --- Authelia forward-auth upstream ---------------------------------------
#
# NPM's authelia-location.conf snippet hardcodes an address:port for the
# forward-auth subrequest. Both halves are host-specific: the docker gateway
# depends on this host's default-address-pool, and Authelia's published port
# is allocated by the block below. A stale value here breaks authentication on
# every protected site simultaneously, so it is re-derived on every run rather
# than trusted.
AUTHELIA_SNIPPET=apps/nginx-proxy-manager/snippets/authelia-location.conf
if [ -f "$AUTHELIA_SNIPPET" ]; then
  GW="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
  AUTH_PORT="$(app_env_value apps/authelia/.env AUTHELIA_PORT)"
  AUTH_PORT="${AUTH_PORT:-10100}"
  if [ -n "$GW" ]; then
    WANT="set \$upstream_authelia http://${GW}:${AUTH_PORT}/api/authz/auth-request;"
    if ! grep -qF "$WANT" "$AUTHELIA_SNIPPET"; then
      sed -i "s|^set \$upstream_authelia .*|${WANT}|" "$AUTHELIA_SNIPPET"
      log "Pointed Authelia forward-auth at ${GW}:${AUTH_PORT}"
      NPM_CID="$(docker ps -q -f name=nginx-proxy-manager 2>/dev/null | head -n1 || true)"
      [ -n "$NPM_CID" ] && docker exec "$NPM_CID" nginx -s reload >/dev/null 2>&1 \
        && log "reloaded nginx to apply it" \
        || true
    fi
  else
    warn "couldn't determine the docker bridge gateway — check the address in $AUTHELIA_SNIPPET by hand"
  fi
fi

# --- Web terminal (wetty) key ---------------------------------------------
#
# Browser terminal access to this host, for networks that block outbound SSH.
# Replaces the hand-made ssh:// Cloudflare Tunnel rules, which published a
# password prompt to the internet with no Access policy in front of them, and
# which CrowdSec could not defend because tunnel-proxied SSH arrives as
# 127.0.0.1. See plan.md §56.
#
# The keypair is generated HERE and never leaves this machine: wetty runs in a
# container on this same host and SSHes back to it over the docker gateway, so
# both ends of that hop are local. This is also what makes turning off host
# password authentication safe — browser access keeps working whether or not
# any particular laptop has a key installed.
if [ -d apps/wetty ]; then
  WETTY_KEY_DIR=apps/wetty/data/keys
  WETTY_KEY="$WETTY_KEY_DIR/id_ed25519"
  mkdir -p "$WETTY_KEY_DIR"

  if [ ! -f "$WETTY_KEY" ]; then
    log "Generating the web terminal's SSH key"
    ssh-keygen -t ed25519 -N '' -C "wetty@$(hostname -s 2>/dev/null || hostname)" -f "$WETTY_KEY" >/dev/null 2>&1 \
      || warn "couldn't generate the wetty SSH key — the web terminal will not be able to log in"
  fi

  if [ -f "${WETTY_KEY}.pub" ]; then
    # ssh(1) refuses a private key with group/other permissions
    # ("UNPROTECTED PRIVATE KEY FILE") and would fail to connect, so 600 is
    # required, not merely preferred. The wetty container runs as root, which
    # bypasses file-permission checks, so it can still read it whoever owns
    # the file on the host.
    chmod 600 "$WETTY_KEY" 2>/dev/null || true
    chmod 644 "${WETTY_KEY}.pub" 2>/dev/null || true

    # Install the PUBLIC half for the account the terminal logs in as. Never
    # the private half — that stays in apps/wetty/data/keys (gitignored).
    WETTY_USER="$TARGET_USER"
    WETTY_HOME="$(getent passwd "$WETTY_USER" 2>/dev/null | cut -d: -f6)"
    if [ -n "$WETTY_HOME" ] && [ -d "$WETTY_HOME" ]; then
      AUTHKEYS="$WETTY_HOME/.ssh/authorized_keys"
      mkdir -p "$WETTY_HOME/.ssh"
      touch "$AUTHKEYS"
      if ! grep -qF "$(cat "${WETTY_KEY}.pub")" "$AUTHKEYS" 2>/dev/null; then
        cat "${WETTY_KEY}.pub" >> "$AUTHKEYS"
        log "Installed the web terminal's public key for ${WETTY_USER}"
      fi
      # sshd silently ignores authorized_keys with loose permissions.
      chmod 700 "$WETTY_HOME/.ssh"; chmod 600 "$AUTHKEYS"
      chown -R "$WETTY_USER" "$WETTY_HOME/.ssh" 2>/dev/null || true

      set_app_env_var apps/wetty/.env WETTY_SSH_USER "$WETTY_USER"
      [ -n "$BASE_DOMAIN" ] && set_app_env_var apps/wetty/.env BASE_DOMAIN "$BASE_DOMAIN"
    else
      warn "couldn't resolve a home directory for '${WETTY_USER}' — install apps/wetty/data/keys/id_ed25519.pub into that user's authorized_keys by hand"
    fi
  fi
fi

# --- NetBird signal over Tailscale Funnel --------------------------------
#
# Signal cannot live behind the Cloudflare Tunnel. It registers a peer by
# replying with response HEADERS on a gRPC stream that then stays open, and
# Cloudflare never flushes headers while a stream is open — measured on both
# the http2 and quic transports, so no connector setting fixes it. Tailscale
# Funnel does flush them, so signal is published there instead. See plan.md
# §52 (the diagnosis) and §53 (the fix).
#
# This runs late because it needs the tailscale app actually running, and apps
# are started from the dashboard, not by this script. It is therefore a no-op
# on a first run and does its work on the next one — which is why it only ever
# warns, never exits.
if [ -f apps/netbird-vpn/.env ]; then
  # Bring the tailscale app up ourselves rather than waiting for someone to
  # start it from the dashboard: signalling is a hard dependency of NetBird,
  # so leaving it to a later manual step means a first run completes with a
  # NetBird that silently cannot connect any peer.
  if [ "$TS_READY" = "1" ] && [ -z "$(docker ps -q -f name=tailscale 2>/dev/null | head -n1 || true)" ]; then
    set_app_env_var apps/tailscale/.env TAILSCALE_AUTH_KEY "$(current_value TAILSCALE_AUTH_KEY)"
    log "Starting the Tailscale app (NetBird signalling depends on it)"
    docker compose -f apps/tailscale/docker-compose.yml --env-file apps/tailscale/.env \
      -p tailscale up -d >/dev/null 2>&1 \
      || warn "couldn't start the tailscale app — start it from the dashboard and re-run ./start.sh"
    # Give it a moment to authenticate and get its DNS name.
    for _ in $(seq 1 15); do
      [ -n "$(docker ps -q -f name=tailscale 2>/dev/null | head -n1 || true)" ] && sleep 2 && break
      sleep 2
    done
  fi

  TS_CID="$(docker ps -q -f name=tailscale 2>/dev/null | head -n1 || true)"
  if [ -z "$TS_CID" ]; then
    warn "tailscale isn't running, so NetBird's signal server has no public address yet. Start the Tailscale app from the dashboard, then re-run ./start.sh."
  else
    # The host, as seen from inside that container — derived from its own
    # default route rather than assuming docker0's gateway, so it is correct
    # whichever bridge network the tailscale app happens to be on.
    TS_GW="$(docker exec "$TS_CID" ip route 2>/dev/null | awk '/^default/ {print $3; exit}' || true)"
    SIGNAL_PORT="$(app_env_value apps/netbird-vpn/.env NETBIRD_SIGNAL_PORT)"
    SIGNAL_PORT="${SIGNAL_PORT:-10252}"

    if [ -z "$TS_GW" ]; then
      warn "couldn't determine the docker gateway from inside the tailscale container — skipping NetBird signal Funnel setup"
    else
      # Re-asserted on every run, not only when absent. Funnel stores the
      # target it was handed, so if signal's published port ever changes the
      # stored target silently points at a dead port: the hostname still
      # resolves, still serves TLS, and returns 502 — while NetBird reports
      # "signal receive stream stalled" and no peer can pair. Exactly that
      # happened when app ports were renumbered to 10100+ (plan.md §69).
      FUNNEL_OUT="$(docker exec "$TS_CID" tailscale funnel --bg --https=443 "http://${TS_GW}:${SIGNAL_PORT}" 2>&1 || true)"

      if printf '%s' "$FUNNEL_OUT" | grep -qi 'not enabled'; then
        # Tailscale prints a one-click URL that writes the node attribute into
        # the tailnet ACL. Nothing here can do that for the user.
        warn "Tailscale Funnel is not enabled for this tailnet, so NetBird signal has no public address. Enable it with the link below, then re-run ./start.sh:"
        printf '%s\n' "$FUNNEL_OUT" >&2
      else
        SIGNAL_HOST="$(docker exec "$TS_CID" tailscale status --json 2>/dev/null \
          | python3 -c 'import json,sys; print((json.load(sys.stdin).get("Self") or {}).get("DNSName","").rstrip("."))' 2>/dev/null || true)"

        if [ -z "$SIGNAL_HOST" ]; then
          warn "tailscale is running but reported no DNS name yet — re-run ./start.sh once it has finished coming up"
        else
          log "NetBird signal is published via Tailscale Funnel at ${SIGNAL_HOST}"
          set_app_env_var apps/netbird-vpn/.env NETBIRD_SIGNAL_HOSTNAME "$SIGNAL_HOST"

          # Patch Signal.URI in place. data/management.json is never
          # regenerated (it holds the store encryption key), so the hostname
          # has to be edited into the existing file.
          #
          # Read-compare-then-write, rather than letting the writer decide: the
          # management restart below must happen ONLY when the value actually
          # changed, or every re-run of this script needlessly bounces NetBird
          # (and with it every connected peer).
          NB_MGMT_JSON=apps/netbird-vpn/data/management.json
          if [ -f "$NB_MGMT_JSON" ]; then
            WANT_URI="${SIGNAL_HOST}:443"
            CUR_URI="$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])).get("Signal") or {}).get("URI",""))' "$NB_MGMT_JSON" 2>/dev/null || true)"

            if [ "$CUR_URI" = "$WANT_URI" ]; then
              log "NetBird Signal.URI already points at ${WANT_URI}"
            else
              if WANT_URI="$WANT_URI" NB_MGMT_JSON="$NB_MGMT_JSON" python3 - <<'NBSIGPY'
import json, os
p = os.environ['NB_MGMT_JSON']
cfg = json.load(open(p))
cfg.setdefault('Signal', {})
cfg['Signal'].update({'Proto': 'https', 'URI': os.environ['WANT_URI'], 'Username': '', 'Password': None})
json.dump(cfg, open(p, 'w'), indent=2)
NBSIGPY
              then
                log "Set NetBird Signal.URI to ${WANT_URI}"
                # Management reads management.json only at startup.
                NB_MGMT_CID="$(docker ps -q -f name=netbird-management 2>/dev/null | head -n1 || true)"
                if [ -n "$NB_MGMT_CID" ]; then
                  docker restart "$NB_MGMT_CID" >/dev/null 2>&1 \
                    && log "restarted netbird-management to pick up the signal address" \
                    || warn "couldn't restart netbird-management — restart the NetBird VPN app from the dashboard"
                fi
              else
                warn "couldn't update Signal.URI in ${NB_MGMT_JSON}"
              fi
            fi
          fi
        fi
      fi
    fi
  fi
fi

cat <<EOF

Homelab Management is up.

  Dashboard: http://localhost:${FRONTEND_PORT}

First run: open the dashboard and complete /setup to create the first admin
account. Per-app secrets and public exposure are configured from the
dashboard's Settings — no further manual .env editing is required.

Cloudflare / NetBird: the tunnel, its connector service, Authelia's OIDC keys
and NetBird's management.json were all set up for ${BASE_DOMAIN:-<no domain set>}.
To publish a service, enable "Publicly expose this service" for it in the
dashboard — that creates its Nginx Proxy Manager host, tunnel route and DNS
record. NetBird works out of the box once its exposure is enabled: point a
client at https://netbird-vpn-api.${BASE_DOMAIN:-<domain>} and sign in
through Authelia.
EOF

# Repeat the systemd warning last, where it won't have scrolled away — the
# tunnel is the whole point of the Cloudflare setup above.
if [ "$HAS_SYSTEMD" -eq 0 ] && [ "$CF_READY" = "1" ]; then
  cat >&2 <<EOF

!! The Cloudflare Tunnel connector was NOT installed: systemd is not running.
!! Nothing here is reachable from the internet until that is fixed.
!! See the warning at the top of this run for how.
EOF
fi
