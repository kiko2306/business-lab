# Business Lab

Business Lab (repository still `homelab-management`, see §84.2) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

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

- [ ] **The scheduled run stamps success before the part that matters** (§86.2)
      — `runScheduledBackupCheck` calls `setBackupScheduleLastRun` after the
      dashboard archive and before `runAppDataBackup`, which never throws. A
      total app-data failure therefore leaves a green timestamp, a `success`
      audit row, and a 24-hour wait before the next attempt. This is our code,
      not the engine's, so it survives the move to Kopia.
- [ ] **The SQL dumps went stale on the 2026-09-01 scheduled run** (§86.3) —
      9 of 25 apps kept dumps from the earlier manual run, and they are the ones
      with a separate database container (bookstack, immich, itflow, n8n,
      nextcloud, nginx-proxy-manager, nocodb, paperless, pihole). That is the
      `docker exec`-into-the-database path, not anything Duplicati does, so a
      working Kopia snapshot tonight would still archive a day-old dump for
      those nine.
- [ ] **Surface backup state in the dashboard** (§75.2, sharpened by §86.2) —
      there is no way to see whether backups work without the CLI. Show the
      **app-data outcome**, not the scheduler tick: last run + outcome, version
      count and size, the destination actually used, and an explicit "never run"
      state rather than a blank.
- [ ] **Two apps have no consistent backup** (§75.4) — `file-browser` and
      `stirling-pdf` (BoltDB/H2, 0 dump files each). Their live DB files are
      copied raw and can restore corrupt. Either snapshot them
      stop-copy-start, or record the accepted risk in `docs/`. (`portainer`
      was the third and has been dropped, §81.1a.)
- [ ] **"Back up now" button** (§74.6) — must call `runAppDataBackup`, never
      `runBackupJobNow`, or each manual backup is a generation stale.
- [ ] **`backup_target_folder` is blank** — falls back to the `homelab-backups`
      default inside `toDuplicatiUrl`, so the dashboard shows an empty field for
      a folder that is in use. Populate it.
- [ ] **Prove a non-Drive destination** — `disk`/`SMB`/`NFS` are built and never
      exercised.
- [ ] **Prove a Postgres/MySQL restore** — only SQLite has been round-tripped.

### Next up (2026-09-02)

- [ ] **Remove the old trees** (§83.4, §83.6) — both moves have now landed
      (`Docker Root Dir: /home/docker`, containerd `root = "/home/containerd"`),
      so once they have held for a few days: `/var/lib/docker` (~100 MB,
      trivial) and `/var/lib/containerd` (~45 GB, the actual reclaim — more
      than the new SSD adds to `/`).

### Business Lab (§84)

- [ ] **Rebrand, tier 2** (§84.2) — package/image/network/project names. Do it
      in the same maintenance window as the §83 data-root move; both recreate
      the management stack.
- [ ] **Add Postiz** (§84.3a) — adopt rather than build. Four containers
      (Temporal + Postgres + Redis), AGPL-3.0, and credentials per platform in
      its own env block: it removes the OAuth code, not the approvals.
- [ ] **Content generation** (§84.3) — prompt + a Claude API key entered once
      in Settings, same third-party-token pattern as Cloudflare/Tailscale;
      n8n for "generate on a schedule, queue in Postiz".
- [ ] **Ship against the Tier A networks first** (§84.3a) — Bluesky, Mastodon,
      own Instagram, own LinkedIn profile all publish today with no approval
      and no cost. That is a release on its own.
- [ ] **Per-client Meta app onboarding** (§84.7) — clients post to their own
      accounts under their own business registration, so each client's box
      holds their own developer app. Instagram works immediately in dev mode
      with a Tester role; a publicly visible Facebook Page post still needs
      that client's App Review, 2-4 weeks. Write it up as a billable
      onboarding step, started on day one of an engagement.
- [ ] **Decide on X** (§84.3a) — pay-per-use since April 2026: ~$0.015 a post,
      **$0.200 if it contains a URL**. A budget decision, not a build one.
- [ ] **Verify Meta development-mode publishing empirically** (§84.3a) —
      sources agree Instagram publishes normally from a dev-mode app with a
      Tester role, and that a Facebook Page post in dev mode is visible only to
      admins. Confirm both with a real app before a timeline depends on it.
- [ ] **`docs/webmaster.md`** (§84.4) — Cloudflare role runbook: domain, DNS,
      Tunnel, routing, Zero Trust. Links to first-run.md rather than restating
      it.
- [ ] **`docs/it-admin.md`** (§84.4) — deploy/configure/maintain the stack.
      Same rule: link, do not duplicate.
- [ ] **@mat: collect the SaaS inventory and monthly costs** (§84.7) — what you
      and your clients actually pay for today, per tool per month. Without it
      the value-proposition plan is a generic "self-hosting saves money"
      leaflet; with it, it names the bill it removes. Blocks the item below.
- [ ] **Sales / value-proposition plan** (§84.4) — SaaS replaced per app, and
      the monthly cost removed, priced for offices of 2-15 (§84.7). **As an
      Artifact, not in this repo** (§84.6).
- [ ] **Customer journey / workflows** (§84.4) — scenarios showing why each app
      earns its place. **As an Artifact** (§84.6).
- [ ] **Licence due diligence** (§84.5) — every registry app against
      redistribution for profit. Blocks pricing.
- [ ] **Per-client provisioning** (§84.5, §84.7) — one host is one deployment
      today; turnkey boxes need it repeatable per client. The list is concrete:
      their domain, their Cloudflare account and API token, their tunnel, their
      Authelia users, their backup destination. Lands in the setup flow.
- [ ] **Turnkey build spec** (§84.7) — Dell/16 GiB/500 GB/€400 is proven (this
      stack runs on 14.84 GiB, 4 CPUs, 53 containers, 8 GB used). The trap is
      the disk: Ubuntu's installer defaults to a ~100 GiB root LV, which is how
      §83 happened. Set Docker's data root or the partitioning **at install**,
      and pick a small-office app profile rather than all of them.
- [ ] **Data protection position** (§84.5) — controller vs processor, backup
      key custody, DR.
- [ ] **Commercial plan** (§84.5) — hardware BOM, support model, onboarding
      time, and what happens to a client's data when they stop paying.

### Roster changes (§81)

- [ ] **Decide the fate of `setupToken`** (§81.1a) — Portainer was its only
      user, so `services/setupToken.ts`, its routes, `setupTokenSupported` on
      ServiceStatus and the dashboard UI for it are now dead code. Either find
      it a second user or remove the lot; do not leave it as furniture.

- [ ] **Wire Nextcloud to OnlyOffice** (§81.4) — installing the connector and
      setting the document-server URL + JWT secret is `occ` inside the
      Nextcloud container. Do it from the backend the way `homeAssistantHacs.ts`
      does HACS, not as a runbook step.
- [ ] **Kopia app, auto-configured** (§81.5) — repository created on first
      start, credentials generated by the dashboard, nothing typed.
- [ ] **`kopiaClient.ts`** (§81.5) — same shape as `duplicatiClient.ts`:
      connect, set policy, snapshot now, list snapshots, restore.
- [ ] **Backup destination → Kopia** (§81.5) — translate the stored
      disk/SMB/NFS/Drive destination into a Kopia backend, alongside the
      existing Duplicati translation.
- [ ] **Scheduler → Kopia** (§81.5) — `backupScheduler` calls Kopia after the
      app-database dumps, with Duplicati still running in parallel.
- [ ] **Prove a Kopia restore** (§81.5) — one SQLite app and one Postgres app,
      restored from a snapshot, before anything is switched off.
- [ ] **Remove Duplicati** (§81.5) — last, and only once the restore above is
      proven. Closes §75.3 (its restore API writes nothing) and §74.6.
- [ ] **Wire ClamAV into Nextcloud and Paperless** (§81.7) — both take a
      clamd host/port; same `occ`-shaped problem as the OnlyOffice item.

### Exposure and platform

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

- [ ] **Home Page's healthcheck probes the wrong path** (§86) — the compose
      healthcheck wgets `/health`, which 404s, so the container has reported
      **unhealthy** since it started while serving fine. `/` and
      `/api/healthcheck` both return 200; the latter is the endpoint
      gethomepage actually provides. A false red on the dashboard is worse than
      no check, because it trains the eye to ignore the colour.
- [ ] **Duplicati carries a 5.3 GB uncheckpointed WAL** (§86.4) —
      `apps/duplicati/data/config/HQFQYTBBPZ.sqlite` is 184 KB with a 5.3 GB
      `-wal` beside it, untouched since the 2026-09-01 restore test. It sits
      inside `apps/`, which is the tree Duplicati is pointed at, so the engine
      is backing up its own WAL. Goes away with Duplicati (§81.5) — but check
      Kopia's source tree excludes the equivalent.
- [ ] **VPS fresh-setup test** (§61.5) — `start.sh` has been audited for the
      fresh-install path but never run on a clean VPS.
- [ ] **@mat: change Guacamole's default login** (§84.1a) — it ships as
      `guacadmin`/`guacadmin` and is on the LAN the moment it starts.
- [ ] **Expose Guacamole with Authelia in front** (§84.1a) — it is LAN-only
      today. There is no agent to break on a forward-auth redirect, so unlike
      MeshCentral it can simply sit behind Authelia.
- [ ] **MeshCentral** (§62.2) — still wanted, for client endpoints that will
      not join the overlay. `TLSOffload` + `certUrl` for the agent cert hash.
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
