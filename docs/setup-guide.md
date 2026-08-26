# Setup Guide

## System requirements

- Ubuntu/Debian Linux host with access to managed app compose directories
- Ports `80` (frontend), `3000` (backend) unless overridden
- Docker Engine + Docker Compose — not a manual prerequisite: `sudo ./start.sh`
  installs both automatically if they're missing (see Quick start in the
  [README](/README.md))

## Environment variables

Use `.env.example` as the source of truth.

Security-critical values:
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `POSTGRES_PASSWORD`

Phase F hardening value:
- `REQUEST_BODY_LIMIT` (default `32kb`)

## First-time setup

1. Start stack: `sudo ./start.sh` (installs Docker/Compose if missing, then
   builds and starts the stack — see the README's Quick start)
2. Open frontend and complete the initial admin setup form.
3. Sign in and verify dashboard/API connectivity.
