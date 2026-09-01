# Homelab Management

Homelab Management is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

## Documentation

- Setup guide: [/docs/setup-guide.md](/docs/setup-guide.md)
- First run — prerequisites, prompts, what's reachable: [/docs/first-run.md](/docs/first-run.md)
- First login per app: [/docs/app-credentials.md](/docs/app-credentials.md)
- Host ports: [/docs/ports.md](/docs/ports.md)
- Raspberry Pi / arm64 guide: [/docs/raspberry-pi.md](/docs/raspberry-pi.md)
- Deployment guide: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- API reference (OpenAPI): [/docs/openapi.yaml](/docs/openapi.yaml)
- Recovery & troubleshooting: [/docs/recovery-troubleshooting.md](/docs/recovery-troubleshooting.md)
- User guide: [/docs/user-guide.md](/docs/user-guide.md)
- Development guide: [/docs/development-guide.md](/docs/development-guide.md)
- SSH key access: [/docs/ssh-keys.md](/docs/ssh-keys.md)
- Security checklist: [/docs/security-checklist.md](/docs/security-checklist.md)

## Quick start

```bash
git clone <this repo> && cd homelab-management
sudo ./start.sh
```

That's it — on Ubuntu/Debian, `start.sh` installs Docker (via the official
`get.docker.com` script) and the Compose plugin if they're not already
present, enables the docker service, and adds the user who ran `sudo` to the
`docker` group. It then generates `.env` on first run (random `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `POSTGRES_PASSWORD`; `APPS_DIR` and `DOCKER_GID`
auto-detected), builds the images, and starts the stack. `sudo` is required
because it installs system packages and manages the docker service. It's
safe to re-run any time (e.g. after `git pull`) — it never overwrites a
secret that's already set, and never reinstalls Docker if it's already
there.

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
  with the Docker access below, the backend already has root-equivalent
  host control, so this isn't a materially larger trust boundary.
- The backend does **not** mount the host Docker socket. A `docker-socket-proxy`
  service holds the real socket and the backend reaches it over
  `DOCKER_HOST=tcp://docker-socket-proxy:2375`, on the internal network only,
  scoped to what `docker ps` and `docker compose up|down` need — `exec`,
  `build`, `secrets`, `swarm` and `plugins` stay off. That narrows the blast
  radius but does not sandbox compose: creating containers is still creating
  containers, so **treat the backend as root-equivalent on the host** and only
  expose the API to trusted users.
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

## Project status

Working and proven against the real deployment: authenticated start/stop with
per-app config written from the dashboard, public exposure (Cloudflare Tunnel +
Nginx Proxy Manager) with upstreams derived automatically, Authelia SSO in front
of exposed apps, NetBird VPN with peers connected, app database dumps, and
backup + restore verified byte-identical.

`plan.md` is the running spec and session log — every change, including what was
tried and rejected, is recorded there in numbered sections. Read its last section
for where things stand.

## TODO

**This list is the single place open work is tracked.** An item is deleted when
it is done — not ticked off and left behind. Section references point at
`plan.md`.

### Security

- [ ] **2FA for admin accounts** — the dashboard is internet-facing via the
      tunnel (`homelab.tx-home-utils.com`, `api-homelab.tx-home-utils.com`),
      independent of the per-service exposure feature. Nothing in the codebase
      implements TOTP today.
- [ ] **code-server's LAN port is ungated** — its own web login is disabled and
      only Authelia guards the exposed hostname, so `:10130` on the LAN is open.
      Now that `~/` is mounted into it (§78.1), that reaches `~/.ssh` and every
      `apps/*/.env`. Either gate the port or narrow `CODE_SERVER_HOME`.

### Backups

- [ ] **Confirm a scheduled run actually produced a version** (§75.1) — every
      successful backup so far was triggered by hand. The last scheduler run was
      during the broken period, so the schedule has never produced a working
      backup. Check `backup_schedule_last_run_at` and whether Duplicati reports
      a second version. Do this before the items below; the answer reorders them.
- [ ] **Surface backup state in the dashboard** (§75.2) — there is no way to see
      whether backups work without the CLI. Needs last run + outcome, version
      count and size, the destination actually used, and an explicit "never run"
      state rather than a blank.
- [ ] **Fix or remove the restore API** (§75.3) — `POST /backup/2/restore`
      returns `{"Status":"OK"}`, writes nothing, logs no error. `duplicati-cli`
      restores correctly, so only the API path is broken. Do not wire a restore
      button until a test proves bytes arrive.
- [ ] **Three apps have no consistent backup** (§75.4) — `portainer`,
      `file-browser`, `stirling-pdf` (BoltDB/H2, 0 dump files each). Their live
      DB files are copied raw and can restore corrupt. Either snapshot them
      stop-copy-start, or record the accepted risk in `docs/`.
- [ ] **"Back up now" button** (§74.6) — must call `runAppDataBackup`, never
      `runBackupJobNow`, or each manual backup is a generation stale.
- [ ] **`backup_target_folder` is blank** — falls back to the `homelab-backups`
      default inside `toDuplicatiUrl`, so the dashboard shows an empty field for
      a folder that is in use. Populate it.
- [ ] **Prove a non-Drive destination** — `disk`/`SMB`/`NFS` are built and never
      exercised.
- [ ] **Prove a Postgres/MySQL restore** — only SQLite has been round-tripped.

### Exposure and platform

- [ ] **Restart Home Page from the dashboard once** (§80.4) — its stored
      `HOMEPAGE_ALLOWED_HOSTS` is a URL rather than a bare host, so the public
      hostname gets "Host validation failed" instead of the page. A start
      through the dashboard now normalises it; until then the live container
      keeps the bad value.
- [ ] **Periodic exposure drift reconciliation** — `POST
      /api/services/:name/exposure/verify` re-verifies one service on demand,
      but nothing notices on its own when NPM or Cloudflare drifts from
      `service_exposure`.
- [ ] **`BACKEND_PORT` is 3000 on this host, not the documented 10000** — the
      backend publishes `0.0.0.0:3000`, while `docs/ports.md` states the core
      stack occupies `10000`–`10099` and that `BACKEND_PORT=10000`. The
      frontend is correctly on `10001`. Either the allocator moved it, or the
      value predates the renumbering; 3000 also sits in the collision zone the
      renumbering existed to escape (it was `home-page`'s old port).
- [ ] **Retrofit `mailEnvKeys`** (§75.6) to Uptime Kuma, n8n, BookStack,
      Paperless and Vikunja — global mail settings exist but these apps don't
      consume them yet.
- [ ] **Signal-port coupling is uncovered** (§69) — the port renumbering
      silently killed NetBird's signal service once; no test would catch a
      repeat.
- [ ] **Health checks for a container with no published port** — the port is now
      resolved from the compose file, and host-networked apps declare
      `hostNetworkPort`, so the common cases are right. A container publishing
      nothing and declaring nothing still falls back to `localhost:<container
      port>` and would misreport. No app hits this today.

### Apps and integrations

- [ ] **VPS fresh-setup test** (§61.5) — `start.sh` has been audited for the
      fresh-install path but never run on a clean VPS.
- [ ] **MeshCentral** (§62.2) — planned, not yet added to the registry.
- [ ] **Pre-built n8n workflows** (§64) — ship useful workflows rather than an
      empty n8n.
- [ ] **Home Assistant: identify the three unlabelled Espressif devices**
      (§77.6) — `.18`/`.19`/`.20`, no DHCP hostname. Power-cycle one appliance
      and re-sweep to identify by elimination.
- [ ] **Home Assistant: Bluetooth for the washing machine** (§77.6) — if it is
      BLE rather than Wi-Fi, an ESPHome Bluetooth proxy near the machine beats
      enabling the host stack (the server is nowhere near the laundry, and it
      avoids mounting the host's D-Bus into the container).
- [ ] **Home Assistant: Ariston via eBus** (§77.6) — the cloud integration works
      but the vendor API is flaky and Nuos is not on its tested list. An eBus
      adapter (~€30–40) plus ebusd is the durable local path.
- [ ] **App backlog** — §22 lists candidate apps by category (communication,
      business ops, no-code/BI, files/PDF, security/network, dev infra,
      productivity). Pull from there rather than restating it here.
