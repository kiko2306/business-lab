#!/usr/bin/env bash
# §364: NetBird's signal gRPC stream is published through the Tailscale
# container's Funnel. When that container is recreated — a self-update image
# re-pin, a "restart" from the dashboard app card, a crash, a plain
# `docker compose up` — tailscaled drops the Funnel data path for a moment and
# NetBird's client never retries hard enough: `netbird status` then sits in
# "rpc error ... EOF" indefinitely until the client is bounced (verified live,
# plan.md §364).
#
# The backend can't do this: the NetBird client is a host systemd service
# (/usr/bin/netbird, netbird.service), not a managed container, and the
# socket-proxy blocks the exec it would take to reach it. So this runs on the
# host — watch for the tailscale container starting and restart netbird.service
# once tailscaled has had a moment to bring Funnel back up.
#
# Installed and enabled by setup_server.sh as netbird-follows-tailscale.service.
set -uo pipefail

# tailscaled needs a few seconds after container start to re-establish the
# Funnel data path; restarting netbird before that just lands back in EOF.
SETTLE_SECONDS="${SETTLE_SECONDS:-15}"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [netbird-follows-tailscale] $*"; }

command -v docker >/dev/null 2>&1 || { log "docker not found — nothing to watch"; exit 0; }

log "watching for the tailscale container to (re)start"

# Filter on the compose labels, not the container name: --force-recreate gives
# the new container a fresh id, and a name filter can bind to the old id at
# subscribe time and then miss the replacement.
docker events \
  --filter 'type=container' \
  --filter 'event=start' \
  --filter 'label=com.docker.compose.project=tailscale' \
  --filter 'label=com.docker.compose.service=tailscale' \
  --format '{{.Actor.Attributes.name}}' |
while read -r name; do
  log "tailscale container '${name}' started — settling ${SETTLE_SECONDS}s"
  sleep "$SETTLE_SECONDS"
  if ! systemctl list-unit-files netbird.service >/dev/null 2>&1; then
    log "netbird.service not installed on this host — nothing to restart"
    continue
  fi
  if systemctl restart netbird 2>/dev/null; then
    log "restarted netbird.service"
  else
    log "systemctl restart netbird failed"
  fi
done

# The pipe ends only if `docker events` exits (daemon restart / socket gone).
# Fall through to a non-zero exit so the unit's Restart= brings us back.
log "docker events stream ended — exiting for a restart"
exit 1
