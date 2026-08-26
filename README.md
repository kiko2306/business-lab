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

```bash
git clone <this repo> && cd homelab-management
./start.sh
```

That's it — `start.sh` generates `.env` on first run (random `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`; `APPS_DIR` and `DOCKER_GID`
auto-detected), builds the images, and starts the stack. It's safe to re-run
any time (e.g. after `git pull`) — it never overwrites a secret that's
already set.

Open the printed dashboard URL and complete `/setup` to create the first
admin account. From there, every other configuration step — per-app secrets,
enabling public exposure — is done from the dashboard itself; no more manual
`.env` editing is required for the core app.

<details>
<summary>Manual setup (if you'd rather not run the script)</summary>

1. Copy `.env.example` to `.env` and set secure values (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`).
2. Set `APPS_DIR` to the **absolute** path of this repository's `apps/` directory, and `DOCKER_GID` to the docker socket's owning group id:
   ```bash
   echo "APPS_DIR=$PWD/apps" >> .env
   echo "DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)" >> .env
   ```
3. Start services:
   ```bash
   docker compose up -d --build
   ```
4. Open the frontend at `http://localhost:${FRONTEND_PORT:-80}`.
5. If first run, complete `/setup` to create the first admin account.

</details>

## Managed app stacks

Each app under `apps/<name>/` is an independent Docker Compose stack that the
backend starts and stops on your behalf.

- `APPS_DIR` is bind-mounted into the backend at the *same absolute path* as
  on the host, so relative paths inside an app's compose file resolve
  identically inside and outside the container. It's mounted **read-write**
  so the dashboard can write each app's `.env` for you (see below) — combined
  with the Docker socket mount below, the backend already has root-equivalent
  host control, so this isn't a materially larger trust boundary.
- The host Docker socket is mounted into the backend so it can drive the daemon.
  **This grants the backend root-equivalent control of the host** — only expose
  the API to trusted users.
- Apps with required secrets ship a `.env.example` documenting them, but you
  don't need to touch it by hand: open the service's card on the dashboard,
  expand **Configuration**, fill in the required (`*`) fields, and save. The
  backend creates `apps/<name>/.env` from `.env.example` on first save and
  updates it from there — secret-looking keys (`PASSWORD`/`SECRET`/`TOKEN`/`*_KEY`)
  are write-only in the UI, never echoed back, only reported as "configured"
  or not.
  `start.sh` sets up the directory permissions this needs automatically; the
  manual `chgrp`/`chmod` dance is only needed if you set up `apps/` by some
  other means.
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

## Project status (as of 2026-08-26)

Public exposure (Cloudflare Tunnel + Nginx Proxy Manager) has now been
validated end-to-end against a real deployment, using `paperless` as the
proof case:

- Per-service upstream scheme/host/port and websocket support are no longer
  entered by the user — the backend derives them automatically (published
  port parsed from the app's compose file, origin host resolved to the
  Docker host's gateway IP, scheme fixed at `http`, websocket upgrade always
  allowed). The exposure panel is now just an enable toggle plus a read-only
  "forwarding to..." line.
- A service can declare `exposureEnvKeys` in `backend/src/config/services.ts`
  (see the `paperless` entry) to have its own public-URL/allowed-hosts env
  vars (e.g. `PAPERLESS_URL`, `PAPERLESS_ALLOWED_HOSTS`) injected
  automatically at every start, computed from the exposed hostname — without
  ever writing to the (read-only) `apps/` mount.
- Fixed along the way: an invalid field sent to the Nginx Proxy Manager API
  (`websocket_upgrade` isn't a real field — `allow_websocket_upgrade` is),
  and Nginx's resolver-based `proxy_pass` failing on `host.docker.internal`
  (its variable resolver doesn't consult `/etc/hosts`, only real DNS — fixed
  by resolving to the literal gateway IP once, up front).
- **Deployment note:** this environment runs `cloudflared` as a host-level
  systemd service, not via the `apps/cloudflare-tunnel/` Docker stack shipped
  in this repo (that stack has no `.env` and has never been started here).
  Keep this in mind before assuming the Docker stack is what's actually
  running — see the Remove list below.
- A live-since-day-one secret leak was found and fixed during this session:
  `.env.save` was committed to git with a real `JWT_SECRET` that was still
  the active session-signing key. It has been rotated, the file removed from
  tracking, and `.gitignore` broadened to `.env.*` (with `.env.example`
  explicitly re-allowed). The old value remains visible in git history
  (commit `5cafdfb`) — rotation makes it inert, but a history rewrite would
  still be needed to fully scrub it if that matters to you.
- A health-status bug was fixed: services without a configured health check
  (most of the registry) were reported as `check failed` instead of
  `healthy` while running, because `healthy` defaulted to `false` whenever no
  check was configured. It now defaults to `true` for a running service with
  no check, and `check failed` is reserved for an actual failed check.

## TODO

### Add

- [ ] **CI pipeline** — there's no `.github/workflows/`, so `smoke-tests.sh`,
      `docker-e2e-test.sh`, and both `tsc` builds only ever run manually.
      Wire them into a workflow that runs on every push/PR.
- [ ] **Automated tests** — there are currently zero `*.spec.ts`/`*.test.ts`
      files in either `backend/` or `frontend/`, despite `ng test` and the
      shell-script smoke tests existing. At minimum, unit-test the exposure
      pipeline (`exposure.ts`, `npmClient.ts`, `cloudflareTunnelClient.ts`,
      the compose-port-parsing regex) — this session's bugs were all in that
      code path and would have been caught by tests instead of by manually
      poking a production tunnel.
- [ ] **"Test connection" action for exposure settings** — NPM credentials
      and Cloudflare account/zone/tunnel IDs are currently only exercised the
      next time a service starts. A validate-now button in Settings would
      have caught several of this session's misconfigurations (wrong NPM API
      URL, wrong upstream host) immediately instead of after a failed
      provisioning attempt.
- [ ] **Exposure drift detection** — nothing currently notices if NPM's or
      Cloudflare's live state diverges from `service_exposure` (e.g. someone
      edits the proxy host by hand in NPM's UI). A periodic reconciliation
      check, or at least a "re-verify" button, would catch that.
- [x] **Docker socket proxy** — the backend no longer mounts
      `/var/run/docker.sock` directly. A `docker-socket-proxy`
      (`tecnativa/docker-socket-proxy`) service holds the real socket, and
      the backend talks to it over `DOCKER_HOST=tcp://docker-socket-proxy:2375`
      on the internal network only. Scoped to just what `docker ps` /
      `docker compose up|down` need (containers/images/networks/volumes,
      start/stop) — `exec`, `build`, `secrets`, `swarm`, and `plugins` stay
      off. Note this narrows blast radius, it doesn't fully sandbox compose:
      creating containers is still creating containers, so a compose file
      that bind-mounts something sensitive isn't stopped by this proxy.
- [ ] **2FA for admin accounts** — worth prioritizing given the dashboard
      itself is already internet-facing via the tunnel (`homelab.tx-home-utils.com`,
      `api-homelab.tx-home-utils.com`), independent of this app's own
      per-service exposure feature.
- [ ] **Scheduled/automated backups** — confirm whether `POST /backups/create`
      is manual-trigger only today; if so, add a cron-driven schedule with
      retention instead of relying on someone remembering to click it.
- [ ] **Extend `exposureEnvKeys` to other apps** — only `paperless` declares
      one right now. Any other app with its own Host-header/CSRF allowlist
      (many self-hosted apps have this) will hit the same class of bug the
      first time someone enables exposure for it.
- [ ] **Health check URLs still assume host ports** — entries use
      `localhost:<port>`, rewritten via `SERVICE_HEALTH_HOST`. Apps not
      published to the host, or published on a non-default port, will still
      misreport. (Distinct from the "no check configured" bug fixed above.)

### Remove

- [x] **`.env.save`** — removed from git tracking and disk; contained a live
      `JWT_SECRET`. `.gitignore` now excludes `.env.*` broadly.
- [x] **`apps/cloudflare-tunnel/` Docker stack** — removed, along with its
      registry entry. This deployment's real tunnel runs via host systemd;
      the stack was never started and its `.env.example` documented a
      topology that didn't match reality.
- [x] **`service_configs` table** — dropped (both from `database/init.sql`
      and the live database). It was empty and had zero code references.
- [x] **Manual upstream host/port/scheme/websocket exposure fields** —
      removed from the API and UI this session; see Project status above.
