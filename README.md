# Business Lab

**Version 0.117.6** — full history in the [changelog](/CHANGELOG.md).

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
- [ ] **NetBird Android client blocks all non-NetBird traffic once connected**
      — matches upstream
      [netbirdio/android-client#96](https://github.com/netbirdio/android-client/issues/96),
      open/unfixed. Our server-side routes are correctly scoped (two `/24` LAN
      resources, no exit node), so this is the mobile app itself, not this
      repo's config. Check that issue periodically; delete this item once it's
      closed upstream (or once an app update fixes it for us, whichever comes
      first).
- [ ] **MeshCentral: prove real agent enrolment through the public tunnel**
      — the app is up, reachable at its own hostname with no Authelia gate,
      and its own login page confirmed live (§505/§506), but the actual
      point of re-adding it is agents on machines that aren't ours, dialing
      in over Cloudflare + NPM rather than the overlay. Needs a real second
      device (VM or spare machine) to install the agent on and confirm: the
      cert path holds (`REVERSE_PROXY`/`certUrl` — MeshCentral's documented
      fix for "Agent bad web cert hash" behind a proxy that isn't
      MeshCentral's own TLS) and a KVM/terminal session actually relays over
      WebSocket without WebRTC. Nothing here can be proven from the
      dashboard host alone.
- [ ] **First-ever exposure of an app may need one extra restart** (§506)
      — `startService` computes an app's exposure env overrides (Host
      allow-lists, public URLs, `gatewayOnExposure` values) *before*
      auto-exposure creates and enables that app's `service_exposure` row
      on its very first start, so the container's first boot bakes in
      pre-exposure values. Found live on MeshCentral (hard 502: it serves
      its own HTTPS until `TLS_OFFLOAD` is set, so the mismatch is fatal
      there) — a second start picks up the right values immediately.
      Other `exposureEnvKeys` apps likely hit the same race more quietly
      (a stale Host-allow-list for one boot, not a hard failure), which is
      probably why nobody's noticed it before. Worth checking how many
      apps are actually affected before deciding whether `startService`
      should provision exposure *before* the first `compose up` instead —
      that reorder touches every app's start path, so it's not a
      one-line fix.

### From the 2026-09-18 review (§511)

- [ ] **Backend trusts a client-supplied `X-Forwarded-For` from the
      LAN/overlay** — `frontend/nginx.conf` passes the header through and
      `trust proxy` is 1, so `X-Forwarded-For: 127.0.0.1` makes `req.ip`
      localhost: bypasses recovery mode's localhost-only check and the login
      rate limit. Tunnel traffic is fine (Cloudflare appends the real IP).
      Found by reading the code; prove it on a LAN request before fixing.
- [ ] **A password reset doesn't revoke the user's sessions** —
      `routes/users.ts` sets the new hash but leaves `refresh_tokens` live
      (only `scripts/recoverAdmin.ts` revokes), so an old session keeps
      refreshing for up to 7 days.
- [ ] **NetBird router peer drops its management stream ~68×/hour** —
      steady for the client's whole uptime: `502 Bad Gateway` on the job
      stream and `RST_STREAM INTERNAL_ERROR` on the main one, via
      `netbird-vpn-api.<domain>` (Cloudflare → NPM). Find the timeout, and
      whether remote peers see it too.
- [ ] **OnlyOffice runs at ~95% of its 640 MiB `mem_limit` idle** — an open
      document may OOM it. Raise the limit.
- [ ] **NocoDB: signup is probably open, and error reporting is on** — no
      `nc_app_settings` row, so invite-only signup is at its default (off)
      on a hostname with no Authelia. Its info endpoint reports
      `errorReportingEnabled: true`; set `NC_DISABLE_ERR_REPORTS`.
- [ ] **Twenty: confirm public signup is closed after the bootstrap** — no
      `IS_SIGN_UP_DISABLED`; not running at review time, so unverified.
- [ ] **Failed dashboard logins are audited without username or IP** — no
      way to spot brute force from `audit_logs`.
- [ ] **Dashboard login hardening** — invited usernames answer 403 vs 401
      (enumeration); unknown users skip the bcrypt compare (timing); a TOTP
      code can be replayed inside its window; no per-`mfaToken` attempt cap.
- [ ] **Public dashboard HTML has no HSTS/CSP** — helmet only covers `/api`.
- [ ] **Stopped apps keep public hostnames that 502** (home-assistant,
      itflow, twenty) — and the reconciler reports them "healthy" because it
      checks NPM/Cloudflare config, not the upstream.
- [ ] **`writeAuditLog` should never throw** — log and swallow inside it,
      delete the ~50 `.catch(() => {})` at call sites and its `42703`
      fallback. Today `/auth/login` awaits it uncaught *after* issuing a
      session, so an audit insert failure 500s a successful login.
      `/auth/setup` also re-implements `issueSession()` and its own audit
      insert.
