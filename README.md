# Business Lab

**Version 0.91.0** — full history in the [changelog](/CHANGELOG.md).

Business Lab (repository `business-lab`) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

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
operates their own instance. Bundled features such as document management
and OCR are part of the free software, not a paid add-on.

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
- Deployment guide — provisioning a box for a client, first run to hand-over: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- Turnkey build spec — hardware, disk partitioning, the default small-office app profile: [/docs/turnkey-build-spec.md](/docs/turnkey-build-spec.md)
- Data protection position — controller vs processor, backup key custody, the DR promise: [/docs/data-protection-position.md](/docs/data-protection-position.md)
- Commercial plan — pricing structure, onboarding timeline, support model: [/docs/commercial-plan.md](/docs/commercial-plan.md)
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
admin account. From there, per-app secrets are entered in the dashboard; no
more manual `.env` editing is required for the core app. Every app that can be
exposed is published behind Authelia automatically on its next start — there
is no per-app exposure step.

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

### Exposure and platform

- [ ] **CrowdSec-alert dedupe needs a real store** (§118.4a) — the Code node
      dedupes by IP within one batch, but `$getWorkflowStaticData` doesn't
      persist between executions for a CLI-imported workflow, so cross-batch
      dedupe doesn't work. Mostly moot (CrowdSec aggregates per bucket
      upstream); add a Redis-backed store only if pushes prove noisy in
      practice.

- [ ] **No alert when the NetBird PAT expires** (§407) — NetBird's API caps
      Personal Access Tokens at 365 days with no "never expires" option.
      When it hits that cap, `netbirdRoutingPeer.ts`'s auto-provisioning
      just logs a warning and silently stops until someone notices and
      pastes a fresh token in. Wire an alert into the existing
      alertNotify/ntfy system so this isn't a silent failure.

- [ ] **Two apps still need a human to claim the admin account** (§416.3;
      n8n §419, Jellyfin + Navidrome §420, Vikunja dissolved — its OIDC
      login creates the user by itself) — **Uptime Kuma** and **Twenty**.
      Copy `navidromeAdminBootstrap.ts`; no exposure gate (§419).
      - **Uptime Kuma** drives setup over socket.io, not REST. Needs a raw
        engine.io handshake or a new dependency — a decision to take before
        starting, not an implementation detail.
      - **Twenty** is a GraphQL `signUp` mutation on a fast-moving API;
        confirm it against the running instance first.
      When probing either, confirm a route with a **GET that returns 405**,
      never a POST — probing Jellyfin's `/Startup/Complete` completed its
      wizard as a side effect (§420).

- [ ] **Build Kimai's `MAILER_URL` from the global mail settings** (§416.4)
      — documented as by-hand only because the per-field injection can't
      compose a DSN, but it is just `smtp://user:pass@host:port` from fields
      the dashboard already holds.

- [ ] **Uptime Kuma's SMTP notification isn't covered by global mail**
      (§416.5) — no environment variable exists; it needs Uptime Kuma's own
      API after an admin exists, so it depends on the admin bootstrap above.

- [ ] **`setup_server.sh`'s three y/N prompts aren't pre-answerable**
      (§416.6) — fixed IP, NOPASSWD sudo, and freeing port 53 for Pi-hole
      are all skipped silently on a no-TTY install because `start.config`
      has no keys for them.

- [ ] **Vaultwarden ships `SIGNUPS_ALLOWED=true`** (§416.7) — anyone who
      reaches it could register if it were ever un-gated, and it blocks
      §415's client-API bypass. Default it to false with a
      dashboard-managed invite instead.

- [ ] **Native mobile clients can't get past Authelia** (§415) — the ntfy
      app and a Bitwarden client retry forever against
      `ntfy.<domain>/homelab-alerts/json` and
      `vaultwarden.<domain>/identity/connect/token`, because Authelia answers
      a native client with a 401-to-login-portal it can't use. Alerts
      themselves are fine (they publish via the host port, not through
      Authelia) — it's only reading them on the phone that's blocked.
      Needs a per-path bypass mechanism, which does not exist:
      `autheliaAccessControl.ts` emits one whole-domain rule per app, so this
      means a registry field plus a `resources:`-scoped rule ahead of the
      domain rule. Two independent halves, each an exposure decision:

      - **Vaultwarden** — bypass `/api`, `/identity`, `/notifications`; the
        documented pattern, its own auth is strong. Must land together with
        `SIGNUPS_ALLOWED=false`, or the open signup endpoint becomes public.
      - **ntfy** — needs ntfy's own auth first (`auth-file` + ACL +
        a generated subscriber token, dashboard-managed). It has none today,
        so a bare bypass would publish the CrowdSec alert stream, attacker
        IPs included, to anyone who guesses the topic.

- [ ] **Delete the obsolete `netbird-router-*` peers in the NetBird
      dashboard** (§410/§411.1) — the cause is fixed (the routing peer was
      mounting the pre-0.78 `/etc/netbird` state path, so it never
      persisted its identity and registered afresh on every recreate), but
      the identities it already leaked have to be removed by hand: delete
      every `netbird-router*` peer except the one currently connected, so
      the router group has exactly one live member. Needs a NetBird
      dashboard login, which the agent does not have.
