#!/bin/sh
# Runs inside the `host-timezone-sync` compose service (Alpine/busybox sh —
# not bash, same reasoning as self-update-watchdog.sh) as PID 1, root, with
# the host's own PID namespace (`pid: host`) and `privileged: true`.
#
# Settings > General's timezone (generalSettings.ts's `app_timezone`, stored
# in the `settings` table) only ever fed executor.ts's
# resolveTimezoneOverride() — a `TZ` env override injected into managed app
# containers, never the real host clock (plan.md §608). CLAUDE.md principle
# 2 (no console configuration) means the backend has to apply it itself, and
# the backend's own Docker access has no EXEC (docker-socket-proxy's scope),
# so there is no way to shell into the host on demand from there. This polls
# instead — same shape self-update-watchdog.sh already uses — and calls the
# host's real `timedatectl` via `nsenter` into PID 1's namespaces, the
# standard way a container reaches "do a systemd thing on the real host."
#
# Bypasses docker-entrypoint.sh (see this service's `entrypoint: []` in
# docker-compose.yml): that script's whole job is dropping to the non-root
# appuser, but nsenter-ing into another namespace needs real root even
# inside a privileged container, and there's nothing else here for the
# entrypoint's chown/git-safe.directory fixups to do anyway.
set -u

POLL_INTERVAL_S=60

log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [host-timezone-sync] $*"
}

log "started — polling app_timezone every ${POLL_INTERVAL_S}s"

while true; do
  # No row yet (a fresh install where nobody has touched Settings > General)
  # means "leave the host's own timezone alone" — DEFAULT_TIMEZONE in
  # generalSettings.ts is only a fallback for the app-container TZ override,
  # not a claim that the host itself should be forced to it.
  desired=$(psql "$DATABASE_URL" -tAc "SELECT value FROM settings WHERE key = 'app_timezone'" 2>/dev/null | tr -d '[:space:]')

  if [ -n "$desired" ]; then
    current=$(nsenter -t 1 -m -u -n -i -- timedatectl show --property=Timezone --value 2>/dev/null)
    if [ "$desired" != "$current" ]; then
      log "host is '${current:-unknown}', Settings wants '${desired}' — applying"
      if nsenter -t 1 -m -u -n -i -- timedatectl set-timezone "$desired" 2>/dev/null; then
        log "host timezone set to ${desired}"
      else
        log "failed to set host timezone to ${desired} (non-fatal, retrying next cycle)"
      fi
    fi
  fi

  sleep "$POLL_INTERVAL_S"
done
