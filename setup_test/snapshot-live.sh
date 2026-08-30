#!/usr/bin/env bash
# Read-only snapshot of the things a setup_test run must NOT change.
#
# Run it once before the test and again after; `diff` the two files. Anything
# that differs is collateral damage from the test and needs investigating.
#
# Deliberately touches nothing and needs no credentials — it reads local
# container/systemd state only, so it is safe to run at any time.
set -uo pipefail

OUT="${1:-}"
if [ -z "$OUT" ]; then
  echo "usage: $0 <output-file>" >&2
  exit 1
fi

{
  echo "# live-state snapshot"
  echo

  echo "## cloudflared unit"
  # The tunnel this host's connector actually serves, and the transport it uses.
  systemctl show cloudflared.service -p ExecStart --value 2>/dev/null \
    | sed -n 's/.*argv\[\]=\(.*\) ; ignore_errors.*/\1/p' \
    | sed 's/--token [^ ]*/--token <redacted>/'
  echo "active=$(systemctl is-active cloudflared 2>/dev/null)"
  echo "protocol=$(journalctl -u cloudflared --no-pager 2>/dev/null \
    | grep -o 'Initial protocol [a-z0-9]*' | tail -1)"
  echo

  echo "## cloudflared drop-ins"
  for f in /etc/systemd/system/cloudflared.service.d/*.conf; do
    [ -e "$f" ] || continue
    echo "--- $f"
    grep -vE '^\s*#' "$f" | grep -vE '^\s*$'
  done
  echo

  echo "## running containers (name -> image)"
  docker ps --format '{{.Names}} -> {{.Image}}' 2>/dev/null | sort
  echo

  echo "## published host ports"
  docker ps --format '{{.Ports}}' 2>/dev/null \
    | tr ',' '\n' | grep -oE '0\.0\.0\.0:[0-9]+' | sort -u
  echo

  echo "## NPM proxy hosts (server_name per config)"
  docker exec nginx-proxy-manager-nginx-proxy-manager-1 \
    sh -c 'grep -h "server_name" /data/nginx/proxy_host/*.conf 2>/dev/null' 2>/dev/null \
    | tr -d ' ;' | sed 's/server_name//' | sort
  echo

  echo "## netbird peers"
  docker exec netbird-vpn-netbird-management-1 \
    sh -c 'ls -la /var/lib/netbird/store.db' 2>/dev/null | awk '{print "store.db size:", $5}'
  echo

  echo "## homelab images (id, so a rebuild is visible)"
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null \
    | grep -E '^homelab-(backend|frontend)' | sort
} > "$OUT" 2>&1

echo "snapshot written to $OUT"
