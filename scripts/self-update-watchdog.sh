#!/bin/sh
# Runs inside the `self-update-watchdog` compose service (Alpine/busybox sh
# — not bash, unlike this repo's other scripts, since it ships in the
# backend image and runs as that image's CMD).
#
# Exists because backend cannot supervise its own self-update restart: the
# final step of runSelfUpdateSequence (selfUpdate.ts) recreates the very
# container running that code, as a detached, unref'd `docker compose up -d
# backend` — nothing survives to notice if that gets killed mid-swap. It has,
# three times live under real memory pressure (plan.md §295, §297, §298),
# each time leaving a stale `Created`-but-never-started container and the
# dashboard down until someone ran `docker rm -f` + `docker compose up -d
# backend` by hand. This script is that recovery, automated, running as a
# separate long-lived container so a killed backend can't also kill its own
# rescuer.
#
# Deliberately NOT the reconciler in selfUpdate.ts's
# reconcileDanglingSelfUpdateRun(): that fixes the *database row* once a new
# backend process boots and can talk to Postgres again (plan.md §296). This
# script is what gets a new backend process booting at all when the old
# `docker compose up -d backend` never even started one.
set -u

COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
POLL_INTERVAL_S=20
# ~2 minutes of continuous "not running" before acting — comfortably past
# every observed healthy restart (build already done earlier in the run,
# §298 dropped the redundant rebuild here too, so a normal swap is well
# under a minute) without being so long a real failure sits unfixed.
GRACE_CHECKS=6

down_count=0

log() {
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') [self-update-watchdog] $*"
}

log "started — watching backend via ${COMPOSE_FILE}, checking every ${POLL_INTERVAL_S}s, acting after ${GRACE_CHECKS} consecutive down checks"

while true; do
  running_id=$(docker compose -f "$COMPOSE_FILE" ps backend --status running --quiet 2>/dev/null)

  if [ -n "$running_id" ]; then
    if [ "$down_count" -gt 0 ]; then
      log "backend is running again (was down for ${down_count} check(s)) — resetting"
    fi
    down_count=0
  else
    down_count=$((down_count + 1))
    log "backend not running (check ${down_count}/${GRACE_CHECKS})"

    if [ "$down_count" -ge "$GRACE_CHECKS" ]; then
      # Recheck right before acting — avoids racing a fix that landed
      # between the last poll and now (a human, or the next self-update).
      running_id=$(docker compose -f "$COMPOSE_FILE" ps backend --status running --quiet 2>/dev/null)
      if [ -n "$running_id" ]; then
        log "backend came back just before recovery would have started — skipping"
        down_count=0
      else
        log "backend has been down for ~$((GRACE_CHECKS * POLL_INTERVAL_S / 60)) min — attempting recovery"

        stale_ids=$(docker compose -f "$COMPOSE_FILE" ps backend --all --quiet 2>/dev/null)
        for id in $stale_ids; do
          log "removing stale backend container ${id}"
          docker rm -f "$id" >/dev/null 2>&1 || log "docker rm -f ${id} failed (non-fatal, continuing)"
        done

        # No --build: the image already on disk is whatever the last
        # `building` phase produced (plan.md §298) — this is a recreate,
        # not a rebuild.
        if docker compose -f "$COMPOSE_FILE" up -d backend; then
          log "recovery: backend recreated"
        else
          log "recovery: docker compose up -d backend failed — will retry next cycle"
        fi
        down_count=0
      fi
    fi
  fi

  sleep "$POLL_INTERVAL_S"
done
