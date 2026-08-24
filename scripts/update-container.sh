#!/usr/bin/env bash
# update-container.sh — Pull latest image and restart a homelab service.
# Usage: ./update-container.sh <service-name>
set -euo pipefail

SERVICE="${1:?Usage: $0 <service-name>}"
APPS_DIR="$(cd "$(dirname "$0")/../apps" && pwd)"
SERVICE_DIR="${APPS_DIR}/${SERVICE}"

if [[ ! -d "${SERVICE_DIR}" ]]; then
  echo "ERROR: Unknown service '${SERVICE}'" >&2
  exit 1
fi

cd "${SERVICE_DIR}"
echo "Updating ${SERVICE}…"
docker compose pull
docker compose up -d --remove-orphans
echo "Done."
