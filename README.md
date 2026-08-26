# Homelab Management

Homelab Management is a Dockerized Angular + Node.js/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

## Documentation

- Setup guide: [/docs/setup-guide.md](/docs/setup-guide.md)
- Deployment guide: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- API reference (OpenAPI): [/docs/openapi.yaml](/docs/openapi.yaml)
- Recovery & troubleshooting: [/docs/recovery-troubleshooting.md](/docs/recovery-troubleshooting.md)
- User guide: [/docs/user-guide.md](/docs/user-guide.md)
- Development guide: [/docs/development-guide.md](/docs/development-guide.md)
- Security checklist: [/docs/security-checklist.md](/docs/security-checklist.md)

## Quick start

1. Copy `.env.example` to `.env` and set secure values (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`).
2. Set `APPS_DIR` to the **absolute** path of this repository's `apps/` directory, and `DOCKER_GID` to the host's docker group id:
   ```bash
   echo "APPS_DIR=$PWD/apps" >> .env
   echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
   ```
3. Start services:
   ```bash
   docker compose up -d --build
   ```
4. Open the frontend at `http://localhost:${FRONTEND_PORT:-80}`.
5. If first run, complete `/setup` to create the first admin account.

## Managed app stacks

Each app under `apps/<name>/` is an independent Docker Compose stack that the
backend starts and stops on your behalf.

- `APPS_DIR` is bind-mounted read-only into the backend at the *same absolute
  path* as on the host, so relative paths inside an app's compose file resolve
  identically inside and outside the container.
- The host Docker socket is mounted into the backend so it can drive the daemon.
  **This grants the backend root-equivalent control of the host** — only expose
  the API to trusted users.
- Apps with required secrets ship a `.env.example`. Copy it to `.env` in the same
  directory; Compose loads it automatically:
  ```bash
  cp apps/nginx-proxy-manager/.env.example apps/nginx-proxy-manager/.env
  # then edit the placeholder values
  ```
  The backend runs as a non-root user, so that file must be readable by the
  docker group:
  ```bash
  chgrp "$(getent group docker | cut -d: -f3)" apps/nginx-proxy-manager/.env
  chmod 640 apps/nginx-proxy-manager/.env
  ```
- Apps listed in the registry without a directory in `apps/` report as `unknown`
  and return HTTP 404 when started.

## Validation and smoke tests

- Smoke tests against a running backend:
  ```bash
  ./scripts/smoke-tests.sh
  ```
- Dockerized E2E deployment test:
  ```bash
  ./scripts/docker-e2e-test.sh
  ```

## Known issues / TODO

- [ ] **First-start exposure provisioning** — when a service is started from the
      frontend for the first time, provision the matching Nginx Proxy Manager
      host and Cloudflare Tunnel public hostname route. See
      [`plan.md`](./plan.md#16-planned-first-start-public-exposure-provisioning).
      - [ ] Fix and verify `backend/src/services/executor.js` service-start
            prerequisite helper scoping before adding provisioning.
      - [ ] Add exposure metadata for base domain, derived
            `<service>.<base-domain>` hostname, upstream scheme/host/port,
            exposure enabled flag, and TLS settings.
      - [ ] Add `apps/cloudflare-tunnel/compose.yaml` and `.env.example` for a
            dashboard-configured Cloudflare Tunnel token.
      - [ ] Add dashboard/backend settings for Cloudflare account, zone, tunnel,
            tunnel token, base domain, and Nginx origin URL.
      - [ ] Add dashboard/backend settings for Nginx Proxy Manager API URL and
            credentials.
      - [ ] Add a Nginx Proxy Manager client that idempotently finds, creates,
            or updates proxy hosts.
      - [ ] Add a Cloudflare Tunnel client that idempotently ensures public
            hostname routes to Nginx Proxy Manager.
      - [ ] Persist provisioning state and return/audit provisioning warnings
            when Docker startup succeeds but external provisioning fails.
      - [ ] Show exposure/provisioning status and warnings in the frontend.
      - [ ] Document new API/settings fields and add targeted smoke or backend
            coverage for idempotent provisioning.
- [ ] **Backups are broken** — `POST /backups/create` fails with `spawn pg_dump ENOENT`.
      `pg_dump`/`pg_restore` are not installed in the backend image; add
      `postgresql-client` to `backend/Dockerfile`.
- [ ] **Rate limiting keys on the proxy IP** — behind Cloudflare the backend logs
      `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. Express `trust proxy` is unset, so
      `express-rate-limit` cannot identify real clients and limits are applied to
      the proxy rather than per user.
- [ ] **Docker socket exposure** — the backend mounts `/var/run/docker.sock`,
      granting it root-equivalent control of the host. Consider a socket proxy
      restricted to the required endpoints, and keep the API off the public
      internet or behind strict authentication.
- [x] **Registry lists apps that are not installed** — all 13 entries in
      `backend/src/config/services.js` now have a `docker-compose.yml` and
      `.env.example` under their respective `apps/` directory.
- [ ] **Health check URLs assume host ports** — entries use `localhost:<port>` and
      are rewritten via `SERVICE_HEALTH_HOST`. Apps published on a non-default
      port, or not published to the host at all, will report `check failed`.
- [x] **Per-app secrets are validated before service actions** — the backend now
      checks each service `apps/<name>/.env` and required compose variables
      before `start`/`stop`, returning a clear 400 error listing missing keys.
- [ ] **`version:` key is obsolete** — the root and app compose files still declare
      `version:`, which Docker Compose warns about on every invocation.
