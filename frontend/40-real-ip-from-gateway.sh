#!/bin/sh
# Trust X-Forwarded-For only from this container's Docker bridge gateway.
#
# cloudflared runs on the host and dials localhost:<FRONTEND_PORT>, so tunnel
# traffic arrives from the gateway carrying Cloudflare's X-Forwarded-For (the
# real client appended last). A LAN client connects directly, and whatever
# X-Forwarded-For it sends must be ignored: passed through, it let any LAN or
# overlay peer claim to be 127.0.0.1 to the backend (plan.md §516).
#
# The subnet comes from start.sh's daemon address pools, so it differs per
# host and can't be written into nginx.conf; the nginx image runs this hook
# at every start. No gateway found → an empty file → nothing is trusted and
# every request keys on its socket address: safe, just coarser for tunnel
# traffic.
set -eu

out=/etc/nginx/real-ip-from.conf
gw=$(ip route 2>/dev/null | awk '/^default/ { print $3; exit }')

if [ -n "$gw" ]; then
  echo "set_real_ip_from $gw;" > "$out"
  echo "$0: trusting X-Forwarded-For from gateway $gw"
else
  : > "$out"
  echo "$0: no default gateway found; X-Forwarded-For will not be trusted" >&2
fi
