# Business Lab

**Version 0.30.1** — full history in the [changelog](/CHANGELOG.md).

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
- Sales catalogue (what each app replaces): [/docs/sales-catalogue.md](/docs/sales-catalogue.md)
- Sequence diagrams for the three multi-service backend actions (open with
  [app.diagrams.net](https://app.diagrams.net) or the desktop app):
  [exposure provisioning](/docs/exposure-provisioning.drawio),
  [the self-update walk](/docs/self-update-walk.drawio),
  [the backup/restore round trip](/docs/backup-restore-roundtrip.drawio)
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

## Folder structure

The folders a user or operator actually needs to open — internal code
directories are covered in `CLAUDE.md` instead. Add a row here only when a
new top-level folder is something a user/operator would navigate to, not
every new directory.

| Path | What |
|---|---|
| `apps/<name>/` | One Docker Compose stack per managed app — its `.env` and data live here (gitignored). |
| `docs/` | Operator docs — setup, credentials, ports, runbooks, licence due diligence. |
| `frontend/` | The Angular dashboard. |
| `backend/` | The Node/Express API that drives Docker on the dashboard's behalf. |
| `start.sh` | The one command a human runs on the host — see Quick start above. |

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
- [ ] **@mat: prove Guacamole SSO live** (§200, §223) — `HTTP_AUTH_HEADER`
      is wired and proven against a scratch stack, but not against the real
      NPM proxy host: apply Guacamole's `authelia-authrequest.conf` snippet
      there, then log in through Authelia and confirm it lands in Guacamole
      with no second form.

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

- [ ] **@mat: apply the self-update panel's infra changes and prove it live**
      (§131.4, §198, §199) — the panel itself is built and gated to
      `webmaster`/`admin` (`system:update`), but its `docker-compose.yml`
      changes (`REPO_ROOT` mount, `BUILD: 1` on `docker-socket-proxy`) and
      `backend/Dockerfile`'s new `git` dependency have not been applied to
      `tx-home-utils.com` yet. Recreate `backend`/`docker-socket-proxy`/
      `frontend` individually once, then click "Update now" on `/updates`
      for real and confirm the whole walk (fetch → pull → build →
      **pull/recreate every installed app (§209)** → restart-frontend →
      restart-backend → reconnect) end to end, plus that a `user`-role
      account gets 403 and no nav entry. While recreating
      `backend`, also confirm `docker-entrypoint.sh`'s new chown of
      `apps/authelia/config/{configuration,users_database}.yml` actually
      takes on the real container (§199 only proved it in an isolated
      throwaway container, then unblocked tonight's Guacamole proof with a
      by-hand `chown` that this recreate makes redundant).

Infrastructure:

- [ ] **E2E coverage for the Docker-touching flows** (§131.5) — the Playwright
      suite (`e2e/`) covers auth, nav, the Users page and the full 2FA
      journey against `docker-compose.test.yml`, whose backend has no Docker
      socket. Start/stop an app, configure exposure and run a backup still
      need a live stack: add a live-stack mode (`E2E_BASE_URL` at a real
      dashboard) that exercises them, local-only like the smoke tests.
Strategy:


### Backups

- [ ] **Prove a real external destination end to end** (§131.4, §173, §196) —
      `disk`/`SMB`/`NFS` are the only destination kinds left now that
      Duplicati (and its FTP/Google Drive support) is gone. The restore proof
      (§196) used Kopia's local-fallback repository, not a real external
      mount. Prove one of the three writes and restores against a
      production-like server (a NAS, or the live dashboard).
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
- [ ] **Verify Meta development-mode publishing empirically** (§84.3a) —
      sources agree Instagram publishes normally from a dev-mode app with a
      Tester role, and that a Facebook Page post in dev mode is visible only to
      admins. Confirm both with a real app before a timeline depends on it.
- [ ] **Per-client provisioning** (§84.5, §84.7, §202, §203) — one host is
      one deployment today; turnkey boxes need it repeatable per client. The
      list is concrete: their domain, their Cloudflare account and API
      token, their tunnel, their Authelia users, their backup destination.
      Decided (§203): whose Cloudflare account holds the domain is the
      client's own call, not ours to standardise — self-controlled (their
      own account) or contracted (a reseller-managed account) — so the
      provisioning flow must support both, with per-zone-scoped API tokens
      required either way. Lands in the setup flow.
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


- [ ] **B2/SFTP/gdrive as further Kopia-native remotes** (§81.5, §194, §197,
      §221) — s3 is done (§221): a Kopia-native remote (no Docker mount,
      Kopia talks to the bucket directly), covering AWS S3 and any
      S3-compatible endpoint (MinIO, B2, Wasabi, …). Native B2 (Backblaze's
      own non-S3-compatible API), SFTP and `gdrive` (needs a GCP
      service-account JSON, not an OAuth AuthID) are still open if a
      destination that isn't S3-shaped is ever wanted.
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
- [ ] **The LAN can bypass Cloudflare on NPM's :80** (§180, §210) — the
      tunnel origin is the host LAN IP, so NPM's plain-HTTP proxy port
      answers any `Host:` header from anywhere on the LAN, skipping
      Cloudflare's WAF/Access for *every* exposed app. `:443` is already
      closed (no cert/vhost). Fixing it means moving the tunnel origin to
      loopback **and** binding NPM's `80`/`443` to `127.0.0.1` —
      estate-wide and outage-risky (verify every exposed hostname still
      works through the tunnel), so its own task. Not OnlyOffice-specific;
      low priority on the no-guarantees box. **Blocks §210.2/§210.3**:
      until this closes, no app's own login is safely droppable in favor
      of "Authelia-only" — the LAN-direct path has no gate at all without
      it (code-server keeps its own login for exactly this reason today).
- [ ] **Wire up the "trust the proxy" knobs the §210.2 audit found** (§216,
      §217) — twelve apps ship a real, upstream-supported way to stop
      showing their own login on top of Authelia's, the same shape as the
      already-fixed Dozzle/Guacamole:
      - **Header/IP trust** (one config change each): File Browser
        (`auth.method=proxy`), Paperless-ngx
        (`PAPERLESS_ENABLE_HTTP_REMOTE_USER` — upstream has an open bug
        report of this misbehaving behind nginx specifically, verify before
        wiring), Beszel (trusted-proxy header + `DISABLE_PASSWORD_AUTH`),
        Stirling-PDF (`SECURITY_ENABLELOGIN=false`), Uptime Kuma (Settings →
        Security → Disable Auth), Nextcloud (`user_saml`'s "Environment
        mode"), Home Assistant (`trusted_networks`/`trusted_proxies` —
        IP-based, weaker, lower priority).
      - **OIDC against Authelia's own provider, then disable the local
        form** (two config steps: wire OIDC, log in once to auto-create the
        account, then flip the flag below): Immich (Admin Settings, OAuth-only,
        has a CLI recovery path), Vikunja (`VIKUNJA_AUTH_LOCAL_ENABLED=false`),
        Mealie (`ALLOW_PASSWORD_LOGIN=false` — one community report of this
        not working on some version, verify live), Homebox
        (`HBOX_OPTIONS_ALLOW_LOCAL_LOGIN=false`), NocoDB
        (`NC_DISABLE_EMAIL_AUTH=true`).

      Each needs its own config change and its own live proof; Nextcloud and
      Home Assistant's fixes probably also want a §180 conversation about
      whether the LAN-direct bypass matters for that specific app first.
      **BookStack** has OIDC/SAML too, but no flag to hide the local form —
      `AUTH_METHOD=oidc` only adds OIDC as an option, and a years-old
      upstream request to disable the standard form is still unimplemented.
      ITFlow, NPM's own admin UI, Pi-hole, Kopia, WAHA, n8n (Enterprise-only
      SSO), Jellyfin (core has no header-trust, only a community plugin) and
      BookStack have no known full fix — parked, not blocked on anything
      actionable.
- [ ] **A VPN/overlay-only flag for sensitive apps** (§210.3) — distinct
      from the existing `lanOnly` (`services.ts`), which means "this
      protocol can't physically be tunneled" (Samba/SMB) and is enforced
      as a hard refusal in `exposure.ts`. This would be a policy flag for
      apps that *can* be tunneled but shouldn't be, given what they
      control: Guacamole (RDP/VNC/SSH to everything on the overlay behind
      one login — named directly), code-server/wetty (full shell access,
      tie to §210.2's LAN-bypass question), nginx-proxy-manager/netbird-vpn
      (control the ingress path / VPN control plane), pihole (DNS admin).
      Not Vaultwarden or Home Assistant — their WAN reach is the point of
      running them, so the answer there is "harden the login," not "hide
      it." Same enforcement shape as `lanOnly` in `exposure.ts`, a
      separate flag and message so the two reasons ("can't" vs
      "shouldn't") don't blur together.

### Apps and integrations

- [ ] **@mat: register Nextcloud's shared-tree mount** (§219, §224) — the
      `/shared` bind mount and `www-data` write permission are in place, but
      registering it with Nextcloud (Admin settings -> External Storage) needs
      a real interactive login — Nextcloud's create API requires a fresh
      password confirmation no API call can satisfy. Steps in
      `docs/app-credentials.md`.
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
- [ ] **VPS fresh-setup test** (§61.5) — `start.sh` has been audited for the
      fresh-install path but never run on a clean VPS.
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
