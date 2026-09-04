# Business Lab

**Version 0.14.0** — full history in the [changelog](/CHANGELOG.md).

Business Lab (repository `business-lab`; npm packages, Docker images and the
compose project are still `homelab-*`, see §84.2) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

## What it is, and how it's sold

Business Lab — the software in this repository — is **free to use**. There are
no tiers, no subscription, and no hosted multi-tenant service: one deployment
is one client, who owns the box and runs it on their own domain, Cloudflare
account and user set, for their own internal business.

What is sold is **service, not software**:

- **Domain management** — the Cloudflare account, DNS, the Tunnel and Zero
  Trust policies (the [webmaster runbook](/docs/webmaster.md)).
- **Custom configuration** — standing up the app set a given office needs and
  wiring it to their accounts and data.
- **Server maintenance** — keeping the stack patched, backed up and healthy
  (the [IT administrator runbook](/docs/it-admin.md)).

Turnkey hardware — a pre-built box — may be sold alongside that service. The
apps are never resold or run as a service for third parties; each client
operates their own instance. Bundled features such as scheduled social
publishing are part of the free software, not a paid add-on.

This supersedes the "three tiers, only one of which is free" and "which SaaS
each app replaces" framing in earlier `plan.md` sections (§84.2, §84.4). The
licence due diligence in [docs/licences.md](/docs/licences.md) is checked
against this model.

## Documentation

- Setup guide: [/docs/setup-guide.md](/docs/setup-guide.md)
- First run — prerequisites, prompts, what's reachable: [/docs/first-run.md](/docs/first-run.md)
- First login per app: [/docs/app-credentials.md](/docs/app-credentials.md)
- Host ports: [/docs/ports.md](/docs/ports.md)
- Raspberry Pi / arm64 guide: [/docs/raspberry-pi.md](/docs/raspberry-pi.md)
- Deployment guide: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- API reference (OpenAPI): [/docs/openapi.yaml](/docs/openapi.yaml)
- Recovery & troubleshooting: [/docs/recovery-troubleshooting.md](/docs/recovery-troubleshooting.md)
- Two-factor authentication (TOTP) for the dashboard login: [/docs/two-factor.md](/docs/two-factor.md)
- Licence due diligence (every image vs the resale model): [/docs/licences.md](/docs/licences.md)
- Version history: [/CHANGELOG.md](/CHANGELOG.md)
- User guide: [/docs/user-guide.md](/docs/user-guide.md)
- Webmaster runbook (Cloudflare / DNS / Tunnel): [/docs/webmaster.md](/docs/webmaster.md)
- IT administrator runbook (running the stack): [/docs/it-admin.md](/docs/it-admin.md)
- Development guide: [/docs/development-guide.md](/docs/development-guide.md)
- SSH key access: [/docs/ssh-keys.md](/docs/ssh-keys.md)
- Security checklist: [/docs/security-checklist.md](/docs/security-checklist.md)

## Quick start

```bash
git clone <this repo> && cd business-lab
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
- Browser E2E — Playwright drives the real dashboard (login, navigation, the
  invite-gated Users page, the full TOTP second-factor journey). Runs in
  containers, no host Node, and is its own CI job:
  ```bash
  ./scripts/e2e-tests.sh
  ```
  The specs in `e2e/tests/` also run against a live deployment — point
  `E2E_BASE_URL` at it and run `npx playwright test` from `e2e/`.
- Live-stack E2E — `e2e/tests/live-stack.spec.ts` covers the flows the
  socket-less test stack can't (start/stop an app, the Backups page, the
  Exposure test-connection check). Opt-in and local-only, so CI skips it:
  ```bash
  E2E_LIVE_STACK=1 E2E_BASE_URL=https://your-dashboard \
  E2E_ADMIN_USER=admin E2E_ADMIN_PASSWORD=… \
  npx playwright test live-stack   # from e2e/
  ```
  Optionally set `E2E_LIVE_APP` (default `samba`) to the app it bounces.

## Project status

Working and proven against the real deployment: authenticated start/stop with
per-app config written from the dashboard, public exposure (Cloudflare Tunnel +
Nginx Proxy Manager) with upstreams derived automatically, Authelia SSO in front
of exposed apps, NetBird VPN with peers connected, app database dumps, and
backup + restore verified byte-identical.

`plan.md` is the running spec and session log — every change, including what was
tried and rejected, is recorded there in numbered sections. Read its last section
for where things stand.

## Environments

The deployment this repo is developed against, `tx-home-utils.com`, is a
**dev/test box with no uptime or data-durability guarantee** — services may go
down and data may be changed or lost. It exists to prove changes against a real
stack; anything on it is disposable.

A production / per-client deployment is a **separate install** with its own
domain and its own credentials and tokens, where uptime and data *do* matter.
It uses the same internet-exposure model (Cloudflare Tunnel + Nginx Proxy
Manager), so being reachable from the internet is not what distinguishes the
two — the guarantees are.

## TODO

**This list is the single place open work is tracked.** An item is deleted when
it is done — not ticked off and left behind. Section references point at
`plan.md`.

### Housekeeping

- [ ] **@mat: run the E2E live-stack specs against a real dashboard once**
      (§171) — `e2e/tests/live-stack.spec.ts` (start/stop, Backups render,
      Exposure test-connection) is gated on `E2E_LIVE_STACK=1` and verified
      only against the socket-less test stack (specs skip there). Run it once
      with `E2E_LIVE_STACK=1 E2E_BASE_URL=<dashboard> E2E_ADMIN_USER=… ADMIN_PASSWORD=…`
      and report any selector drift.

### Security

- [ ] **@mat: verify `setup_server.sh`'s new prompts against the real
      host** (§94) — the fixed-IP (`netplan try`) and passwordless-sudo
      (`NOPASSWD:ALL` sudoers entry) prompts are syntax/shellcheck-verified
      only; deliberately not exercised by an agent session, since a wrong
      value in either can cut off the very session applying it. Run
      `sudo ./setup_server.sh` and confirm both prompts behave as documented
      in `docs/first-run.md`.

### Features & architecture (§131)

Updates:

- [ ] **Dashboard self-update panel** (§131.4) — separate from the version
      display: current version/commit vs `origin/main`; a confirm-gated button
      that runs `git pull` and restarts the management services individually
      (never a root `docker compose down`). Always prompts; no silent
      self-update.

Infrastructure:

- [ ] **E2E coverage for the Docker-touching flows** (§131.5) — the Playwright
      suite (`e2e/`) covers auth, nav, the Users page and the full 2FA
      journey against `docker-compose.test.yml`, whose backend has no Docker
      socket. Start/stop an app, configure exposure and run a backup still
      need a live stack: add a live-stack mode (`E2E_BASE_URL` at a real
      dashboard) that exercises them, local-only like the smoke tests.
Strategy:

- [ ] **Sales catalogue Artifact** (§131.6, §166) — one row per managed
      app: what it does, and what commercial/SaaS product it stands in for.
      No pricing, no monthly-cost arithmetic, no named client scenarios.
      **As an Artifact, out of this public repo** (§84.6). This is the single
      canonical sales-doc item — the old §84.4/§84.7 "SaaS inventory +
      monthly costs", "value-proposition plan" and "customer journey"
      items were folded into it (§166).

### Backups

- [ ] **Prove a non-Drive destination end to end** (§131.4, §173) — FTP/FTPS
      are built (§173) and proven as far as connect + auth against real
      Duplicati, but a completed transfer failed against throwaway
      containerised FTP servers. `disk`/`SMB`/`NFS` are built and never
      exercised at all. Prove one of them writes and restores against a
      production-like server (a NAS, or the live dashboard). Also covers the
      Kopia translation later.
- [ ] **Prove a Postgres/MySQL restore** — only SQLite has been round-tripped.
- [ ] **Per-application backup / restore** (§131.4) — a per-app action on each
      app's card: back up just this app's data + database, list its snapshots,
      restore just this app. Reuses the existing engines; pairs with the
      multi-page Backups view (§131.1).

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
- [ ] **Pick a licence for this repo** (§107) — there is no `LICENSE` file, so
      the public repo is "all rights reserved" and contributions have no legal
      basis. Fell out of the licence due diligence; the choice (AGPL to match
      the copyleft apps it bundles, permissive, or source-available) is a
      commercial call.
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


- [ ] **Harden OnlyOffice's exposure** (§123.2, §131.2, §178) — the connector
      wiring (§178) confirmed the browser-facing leg needs OnlyOffice's public
      hostname, so exposure stays. Remaining: restrict its NPM host to
      Cloudflare's IP ranges (Document Server has had CVEs), and consider a
      LAN-only mode for deployments that only use Nextcloud on the LAN (the
      wiring already falls back to the host-gateway URL when OnlyOffice is not
      exposed). The shared JWT secret is verified — `occ
      onlyoffice:documentserver --check` passes.
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

- [ ] **CrowdSec-alert dedupe needs a real store** (§118.4a) — the Code node
      dedupes by IP within one batch, but `$getWorkflowStaticData` doesn't
      persist between executions for a CLI-imported workflow, so cross-batch
      dedupe doesn't work. Mostly moot (CrowdSec aggregates per bucket
      upstream); add a Redis-backed store only if pushes prove noisy in
      practice.
- [ ] **n8n workflow overwrite policy** (§118.3) — `n8n-workflows-init`
      re-imports every boot, so a managed workflow's UI edits are replaced.
      Fine for now (matches every other generated config here); revisit
      skip-if-exists if someone needs to customise one in place.
- [ ] **n8n's Postgres is 15; n8n 2.36 wants 17 (16 on compat)** (§118.3) —
      `apps/n8n/docker-compose.yml` runs `postgres:15-alpine`; n8n logs
      "Postgres 15 is not supported" on every start. Runs with a warning for
      now. Needs a PG major upgrade (dump/restore, or a versioned data dir
      swap) — same care as the other DB apps. Independent of §118.
- [ ] **Periodic exposure drift reconciliation** — `POST
      /api/services/:name/exposure/verify` re-verifies one service on demand,
      but nothing notices on its own when NPM or Cloudflare drifts from
      `service_exposure`.

### Apps and integrations

- [ ] **Explore a small local LLM for text cleanup and JSON parsing** — check
      whether a very small model (something llama.cpp-class, CPU-viable on
      this host) is worth adding for jobs like tidying user-facing text or
      parsing/repairing JSON from another app's output, without depending on
      an external API key. Scope: which jobs actually need it, model size vs.
      quality tradeoff, and how it'd be packaged (its own compose service?).
- [ ] **Smarter Mealie "recipe from URL"** (§123.1) — the `recipe-scrapers`
      importer is poor on blogs without schema.org markup. Mealie 2.x has an
      `OPENAI_*` integration for AI-assisted parsing (incl. an
      Anthropic-compatible `OPENAI_BASE_URL`). Check what it improves for a URL
      import, and whether to wire the key through the dashboard reusing the
      §84.3 "Claude API key in Settings" pattern; weigh per-import cost.
- [ ] **Add SQL Server Express (LAN-only)** (§121) — licence **cleared**
      (§121.5): the SQL Server 2022 Express EULA permits it via the §2.b.iv
      hosting exception **provided the client accepts the Microsoft EULA on
      first start** — the backend must never set `ACCEPT_EULA=Y` silently. So
      SQL Server needs its own acceptance gate (unlike every OSS app here):
      show the terms → operator ticks accept → then start; store who/when.
      Then `apps/mssql/` (x86-64 only, no arm64; `MSSQL_PID=Express`;
      complexity-compliant generated `MSSQL_SA_PASSWORD`; ~1 GiB buffer-pool /
      10 GB DB cap), a new `mssql` backup engine (`sqlcmd BACKUP DATABASE`),
      docs rows (incl. the No-High-Risk-Use limit: no e-commerce/payments/
      life-safety), and prove a start + backup/restore round-trip.
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
- [ ] **Pre-built n8n workflows** (§64, §118.3) — ship useful workflows rather
      than an empty n8n. No native "import from a directory" for n8n's main
      process; needs a spike (container-`command` import of a backend-rendered
      JSON with a stable id + `update:workflow --active`, vs the REST API which
      needs a UI-created key). Blocks the CrowdSec-alert workflow (§118.4).
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
