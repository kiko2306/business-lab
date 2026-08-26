# Homelab Management

Homelab Management is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

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

- [x] **Service start/stop was broken** — `executor.js` declared its secrets-validation
      helpers (`ensureServiceSecrets`, `parseEnvFile`, `requiredSecretsFromCompose`)
      inside an unrelated callback, so calling them from `startService`/`stopService`
      threw a `ReferenceError` on every start or stop. The helpers are now defined at
      module scope.
- [x] **First-start exposure provisioning** — when a service starts with
      exposure enabled, the backend provisions a matching Nginx Proxy Manager
      host and Cloudflare Tunnel public hostname route. See
      [`plan.md`](./plan.md#16-implemented-first-start-public-exposure-provisioning)
      for the full implementation summary. **Not yet validated against a real
      Nginx Proxy Manager or Cloudflare account** — test before relying on it
      in production.
- [x] **Backups are broken** — `POST /backups/create` failed with `spawn pg_dump ENOENT`.
      `postgresql16-client` (matching the `postgres:16-alpine` database image) is now
      installed in `backend/Dockerfile`.
- [x] **Rate limiting keys on the proxy IP** — behind Cloudflare the backend logged
      `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`. `app.set('trust proxy', ...)` is now
      configured (default: trust one hop), overridable via `TRUST_PROXY`.
- [ ] **Docker socket exposure** — the backend mounts `/var/run/docker.sock`,
      granting it root-equivalent control of the host. Consider a socket proxy
      restricted to the required endpoints, and keep the API off the public
      internet or behind strict authentication.
- [x] **Registry lists apps that are not installed** — all 17 entries in
      `backend/src/config/services.ts` now have a `docker-compose.yml` and
      `.env.example` (where secrets are required) under their respective `apps/`
      directory, including the previously-missing `dozzle`, `beszel`, `mealie`,
      and `portainer` stacks.
- [ ] **Health check URLs assume host ports** — entries use `localhost:<port>` and
      are rewritten via `SERVICE_HEALTH_HOST`. Apps published on a non-default
      port, or not published to the host at all, will report `check failed`.
- [x] **Per-app secrets are validated before service actions** — the backend now
      checks each service `apps/<name>/.env` and required compose variables
      before `start`/`stop`, returning a clear 400 error listing missing keys.
      (This validation was previously unreachable — see the executor.js fix above.)
- [x] **`version:` key is obsolete** — removed from the root and all app compose
      files.
- [x] **User accounts have no management UI** — `/api/users` (list/create/reset
      password/delete) plus a `/users` dashboard screen now cover multi-admin
      management. There is a single account tier (every user is an administrator);
      the previously-unused `role` column has been removed.
- [ ] **Docker-based validation not yet run** — `./scripts/smoke-tests.sh` and
      `./scripts/docker-e2e-test.sh` haven't been run against the TypeScript
      backend rebuild (no Docker daemon was available in the environment that
      made these changes). Run both before relying on this in production.
- [ ] **Exposure provisioning not yet validated live** — the Nginx Proxy Manager
      and Cloudflare Tunnel clients haven't been exercised against a real NPM
      instance or Cloudflare account. Test end-to-end before enabling exposure
      on any service.
