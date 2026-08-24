# Deployment Guide

## Standard deployment

```bash
docker compose up -d --build
```

## Production considerations

- Set strict `CORS_ORIGIN` allowlist (comma-separated if multiple origins).
- Keep backend/database on private network segments.
- Rotate JWT secrets periodically.
- Use external backups for DB volume.
- Restrict host script execution paths and file permissions.

## Dockerized E2E deployment validation

```bash
./scripts/docker-e2e-test.sh
```

This validates:
- Frontend startup/static serving
- Backend startup + DB connectivity
- Auth flows (setup/login/refresh/logout)
- Settings, audit, health, and SSE flow
- Recovery mode enable/disable from localhost context
