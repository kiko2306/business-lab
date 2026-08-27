#!/bin/sh
set -eu

# The backups-data named volume is created fresh by Docker on first mount,
# which overrides the image's baked-in `chown -R appuser:appgroup /app`
# (Dockerfile) with root ownership. Fix it here, as root, before dropping
# to appuser, so manual/scheduled backups can actually write to it.
chown -R appuser:appgroup /app/backups

exec su-exec appuser "$@"
