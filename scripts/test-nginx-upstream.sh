#!/usr/bin/env bash
# Proves frontend/nginx.conf follows the backend to a new IP. nginx resolves a
# literal `proxy_pass http://backend:3000` once at startup, so recreating the
# backend (every self-update does) left the frontend sending to the dead
# address: 502 on every /api call until the frontend was restarted (plan.md §897).
set -euo pipefail
cd "$(dirname "$0")/.."

net=nginx-upstream-test
fe=nginx-upstream-fe
cleanup() { docker rm -f "$fe" nginx-upstream-b1 nginx-upstream-b2 >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

stub_conf=$(mktemp); empty=$(mktemp)
echo 'server { listen 3000; location / { return 200 "$server_addr"; } }' >"$stub_conf"
docker network create --subnet 172.29.77.0/24 "$net" >/dev/null

stub() { docker run -d --name "$1" --network "$net" --network-alias backend --ip "$2" \
  -v "$stub_conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine >/dev/null; }

stub nginx-upstream-b1 172.29.77.10
docker run -d --name "$fe" --network "$net" \
  -v "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$empty:/etc/nginx/real-ip-from.conf:ro" nginx:1.27-alpine >/dev/null
sleep 2

get() { docker exec "$fe" wget -qO- -T 5 http://127.0.0.1/api/ping 2>&1 || echo "FAILED"; }

[ "$(get)" = 172.29.77.10 ] || { echo "FAIL: first backend not reached: $(get)"; exit 1; }
docker rm -f nginx-upstream-b1 >/dev/null
stub nginx-upstream-b2 172.29.77.11
sleep 12 # resolver valid= window
[ "$(get)" = 172.29.77.11 ] || { echo "FAIL: nginx kept the old backend IP: $(get)"; exit 1; }
echo "ok: frontend followed the backend to its new IP"
