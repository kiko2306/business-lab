# Business Lab

**Version 0.8.0** — full history in the [changelog](/CHANGELOG.md).

Business Lab (repository `business-lab`; npm packages, Docker images and the
compose project are still `homelab-*`, see §84.2) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

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

### Security

- [ ] **@mat: verify `setup_server.sh`'s new prompts against the real
      host** (§94) — the fixed-IP (`netplan try`) and passwordless-sudo
      (`NOPASSWD:ALL` sudoers entry) prompts are syntax/shellcheck-verified
      only; deliberately not exercised by an agent session, since a wrong
      value in either can cut off the very session applying it. Run
      `sudo ./setup_server.sh` and confirm both prompts behave as documented
      in `docs/first-run.md`.

### Features & architecture (§131)

SSO / roles:

- [ ] **Role model reshape 152a — backend** (§152) — roles become
      webmaster / admin / user (owner + it_admin removed). `/setup` and
      `./start.sh recover` create/restore a webmaster; `ensureRoleModelReshape()`
      migrates owner→webmaster, it_admin→admin. New `user_capabilities` table +
      `effectiveCapabilities(roles, grants)`: a webmaster is always full, an
      admin's features are per-account grants (no rows = all-on). Users API +
      `PUT /users/:id/capabilities`, `owner`→`webmaster` guards. Backend + tests.
- [ ] **Role model reshape 152b — frontend** (§152) — role checkboxes to
      webmaster / admin / SSO user, a per-admin Features editor on the create
      form and each row, nav gating on the session's effective capabilities.
      Visual review; feature bump to 0.9.0.
- [ ] **SSO slice 2a — user email + app-access data model & API** (§151) —
      `users.email` column, `user_app_access` allowlist table, optional
      `autheliaGroups` on the registry, `GET /api/users/app-access-options`
      (derived from live exposure), and email + `appAccess` on the create /
      update user APIs. Backend + tests only.
- [ ] **SSO slice 2b — create form email field + app-access checkboxes**
      (§151) — required email input, a checkbox list from the derived options,
      and a per-row Access editor mirroring the roles editor. Visual review.
- [ ] **SSO slice 2c — Authelia users-file sync** (§151) — every managed
      account written into `users_database.yml` with `app-<name>` groups, the
      bcrypt hash copied from `users.password_hash`; synced on
      create/update/delete/password-reset/recover. Proven on the live stack.
- [ ] **SSO slice 2d — Authelia access_control generation** (§151) —
      marker region in `configuration.yml`, `default_policy: deny`, a
      per-app group rule per exposed+gated app, Authelia restart, hooked into
      the exposure-toggle path. Proven end-to-end on the live stack.

Updates:

- [ ] **Update button does the full job** (§131.4) — rewrite the app's image
      tag, `docker compose pull`, `up -d` to recreate; per-app result;
      sequenced through the safe backup path (§103). Compose files are
      read-only to the backend, so this needs a managed tag-override
      mechanism, not an in-place compose edit.
- [ ] **Dashboard self-update panel** (§131.4) — separate from the version
      display: current version/commit vs `origin/main`; a confirm-gated button
      that runs `git pull` and restarts the management services individually
      (never a root `docker compose down`). Always prompts; no silent
      self-update.

Infrastructure:

- [ ] **`apps/samba/` — LAN-only SMB share** (§131.5) — Windows-reachable file
      share, generated credentials + generated `smb.conf`, data under the app
      dir. No Cloudflare Tunnel, no NPM host, no Home Page tile; mandatory
      `homepage.*` labels (group "Files"); rows in `ports.md` (SMB 445, a
      documented sub-10000 pin), `app-credentials.md`, `licences.md`
      (Samba GPL-3.0).
- [ ] **Browser E2E framework** (§131.5) — Playwright-in-Docker driving the
      real dashboard (login, 2FA, create user, start/stop, exposure, backup);
      its own CI job or local-only like the smoke tests.
Strategy:

- [ ] **Rewrite the README business rules** (§131.6) — the app is Free to Use;
      billable services are domain management, custom configuration, and
      server maintenance only; drop the SaaS / tiered framing from
      §84.2/§84.4.
- [ ] **Rescope or drop the SaaS-inventory items** (§131.6) — §84.7 "collect
      the SaaS inventory" and "Sales / value-proposition plan" become "app
      list + features + alternatives", not subscription-cost arithmetic.
- [ ] **Sales catalogue Artifact** (§131.6) — per app: what it does and what
      it stands in for. Out of this public repo (§84.6).

### Backups

- [ ] **`onlyoffice`'s bundled Postgres is never dumped** (§88.6) — same
      exposure, harder: the database is inside the documentserver container
      rather than a separate compose service, so `backup:` as it stands cannot
      reach it.
- [ ] **Add an FTP/FTPS backup destination** (§131.4) — alongside
      `disk`/`SMB`/`NFS`/Drive, in the stored-destination model and the
      Duplicati (and later Kopia) translation.
- [ ] **Prove a non-Drive destination** (§131.4) — `disk`/`SMB`/`NFS` are built
      and never exercised; prove FTP in the same pass.
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
- [ ] **@mat: collect the SaaS inventory and monthly costs** (§84.7) — what you
      and your clients actually pay for today, per tool per month. Without it
      the value-proposition plan is a generic "self-hosting saves money"
      leaflet; with it, it names the bill it removes. Blocks the item below.
- [ ] **Sales / value-proposition plan** (§84.4) — SaaS replaced per app, and
      the monthly cost removed, priced for offices of 2-15 (§84.7). **As an
      Artifact, not in this repo** (§84.6).
- [ ] **Customer journey / workflows** (§84.4) — scenarios showing why each app
      earns its place. **As an Artifact** (§84.6).
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


- [ ] **Wire Nextcloud to OnlyOffice internally** (§81.4, §131.2) — install the
      connector and set the document-server URL + JWT secret via `occ` inside
      the Nextcloud container, from the backend the way `homeAssistantHacs.ts`
      does HACS, not as a runbook step. Give Nextcloud the **internal**
      doc-server URL for the server-to-server leg. Part of the "prioritise
      roster wiring debt before new apps" push (§131.2).
- [ ] **Does OnlyOffice need public exposure?** (§123.2, §131.2) — the
      browser-loads-the-editor model means the doc-server URL must be reachable
      by the remote browser. Confirm exposure is genuinely required (vs
      LAN-only / proxied via Nextcloud); if it must stay, restrict its NPM host
      to Cloudflare's ranges and verify the shared JWT secret.
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
- [ ] **Should the backend publish a LAN port at all?** (§98) — confirmed the
      frontend never uses it (it reaches the backend at `http://backend:3000`
      over the compose network regardless — `docs/ports.md` already says so);
      `BACKEND_PORT`'s host publish only exists for direct API/debug access.
      This host's value (3000, not the documented 10000 — predating the port
      renumbering) is a symptom of that being genuinely unnecessary once
      exposure is configured. Decide: drop the `ports:` mapping from
      `docker-compose.yml` entirely (backend becomes compose-network-only), or
      keep it published and just fix the number. Bugfix, not urgent.
- [ ] **Signal-port coupling is uncovered** (§69) — the port renumbering
      silently killed NetBird's signal service once; no test would catch a
      repeat.
- [ ] **Health checks for a container with no published port** — the port is now
      resolved from the compose file, and host-networked apps declare
      `hostNetworkPort`, so the common cases are right. A container publishing
      nothing and declaring nothing still falls back to `localhost:<container
      port>` and would misreport. No app hits this today.

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
