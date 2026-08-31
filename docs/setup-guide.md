# Setup Guide

## System requirements

- Ubuntu/Debian Linux host with access to managed app compose directories
- **CPU architecture**: x86-64 or arm64. 32-bit ARM (`armhf`) is not
  supported — many managed apps publish arm64-only images. On a Raspberry
  Pi, install a 64-bit OS and see [/docs/raspberry-pi.md](/docs/raspberry-pi.md)
- **RAM**: 4 GB minimum, 8 GB recommended. The floor is set by the build,
  not the runtime — `start.sh` compiles the Angular frontend inside the
  container, which is the heaviest step of the install
- **Storage**: SSD strongly preferred over microSD/eMMC — the dashboard's
  Postgres and every managed app's database write continuously
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
