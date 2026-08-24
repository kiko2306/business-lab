# Setup Guide

## System requirements

- Docker Engine + Docker Compose
- Linux host with access to managed app compose directories
- Ports `80` (frontend), `3000` (backend) unless overridden

## Environment variables

Use `.env.example` as the source of truth.

Security-critical values:
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `POSTGRES_PASSWORD`

Phase F hardening value:
- `REQUEST_BODY_LIMIT` (default `32kb`)

## First-time setup

1. Start stack: `docker compose up -d --build`
2. Open frontend and complete the initial admin setup form.
3. Sign in and verify dashboard/API connectivity.
