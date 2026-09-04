#!/bin/sh
set -eu

# The backups-data named volume is created fresh by Docker on first mount,
# which overrides the image's baked-in `chown -R appuser:appgroup /app`
# (Dockerfile) with root ownership. Fix it here, as root, before dropping
# to appuser, so manual/scheduled backups can actually write to it.
chown -R appuser:appgroup /app/backups

# The dashboard writes each app's .env (services/appEnv.ts) and touches a few
# config files directly under apps/<name>/. Those directories can be created
# by whoever ran `git pull` or by a container, so they aren't necessarily
# owned by this (non-root) process. Take ownership of each apps/<name>/ dir
# and its .env / .env.example here, as root — but NOT recursively: the data/
# subdirs belong to the individual app containers (and Postgres is strict
# about its data-dir mode), so only the app dir shell and its env files.
if [ -n "${APPS_DIR:-}" ] && [ -d "$APPS_DIR" ]; then
  for d in "$APPS_DIR"/*/; do
    [ -d "$d" ] || continue
    chown appuser:appgroup "$d" 2>/dev/null || true
    find "$d" -maxdepth 1 -type f \( -name '.env' -o -name '.env.example' \) \
      -exec chown appuser:appgroup {} + 2>/dev/null || true
  done
fi

# git refuses to operate in a repo whose owning uid doesn't match the
# running user ("dubious ownership") even when it's group-writable — the
# self-update panel (§131.4) needs this exemption for its `git pull`
# against the REPO_ROOT mount, which start.sh keeps group-writable for
# DOCKER_GID the same way it does for APPS_DIR.
if [ -n "${REPO_ROOT:-}" ] && [ -d "$REPO_ROOT/.git" ]; then
  su-exec appuser git config --global --add safe.directory "$REPO_ROOT" 2>/dev/null || true
fi

exec su-exec appuser "$@"
