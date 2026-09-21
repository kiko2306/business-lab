# Business Lab

**Version 0.126.0** — full history in the [changelog](/CHANGELOG.md).

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

- [ ] **Vikunja mobile/desktop clients: confirm a real client against the
      Authelia bypass** — code built and proven at the HTTP level in plan.md
      §571 (`autheliaBypassPaths: ['^/api($|/)']`, curl against the live host
      shows `/api/v1/...` returning Vikunja's own JSON instead of Authelia's
      HTML login page, `/` still gated). What's left is a real Vikunja
      Android/desktop client pointed at `https://<vikunja-host>/api/v1` to
      confirm it recognises the server and logs in, before merging to `main`.
- [ ] **Vikunja silent SSO: confirm a live Authelia session actually skips
      the login page** — code built and proven at the HTTP level in plan.md
      §572 (NPM's `location = /` block confirmed rendered; anonymous curl
      shows the redirect chain lands on Authelia's real login with no loop,
      and deep links / `/api/v1/...` are unaffected). What's left needs a
      real logged-in browser: with a live Authelia session, visiting bare
      `https://vikunja.tx-home-utils.com/` should land straight in the app
      with no visible login page, and a reload of that same URL shouldn't
      loop. Confirm before merging to `main`.
- [ ] **NetBird Android client blocks all non-NetBird traffic once connected**
      — matches upstream
      [netbirdio/android-client#96](https://github.com/netbirdio/android-client/issues/96),
      open/unfixed. Our server-side routes are correctly scoped (two `/24` LAN
      resources, no exit node), so this is the mobile app itself, not this
      repo's config. Check that issue periodically; delete this item once it's
      closed upstream (or once an app update fixes it for us, whichever comes
      first).
- [ ] **Re-enable the CrowdSec Cloudflare Worker bouncer once its token bug is
      fixed** — the edge-level bouncer (`cloudflare-worker-bouncer` in
      `apps/crowdsec/docker-compose.yml`, behind the `edge-bouncer` compose
      profile) would drop flagged IPs at the Cloudflare edge, further
      upstream than the NPM Lua bouncer currently enforcing bans (plan.md
      §567's #3, §23.17) — but as of v0.0.18 it crash-loops
      ("Authentication error (10000)") against Cloudflare API tokens with the
      newer `cfut_` prefix, even with full Workers/KV/Routes scope (verified
      via curl). Its config is already rendered on every start
      (`services/crowdsecConfig.ts`), so re-enabling it is just
      `docker compose --profile edge-bouncer up -d` once a classic token
      works or upstream fixes the auth path. Check periodically; delete this
      item once it's fixed and the bouncer is confirmed enforcing live.
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

- [ ] **Orphaned `homelab.tx-home-utils.com` in Cloudflare — needs manual
      cleanup** — investigated in plan.md §556. Not tracked by any
      `service_exposure` row (confirmed via a direct DB query — 38 rows, none
      named `homelab`/`businesslab`); the dashboard's own hostname should be
      `businesslab.tx-home-utils.com` by default (`DEFAULT_DASHBOARD_SUBDOMAIN`,
      and the live `dashboard_url` setting is empty). Most likely a leftover
      Cloudflare DNS/Tunnel route from before this project's rename (the
      working directory is still `homelab-management`). Needs a human to open
      the Cloudflare Zero Trust dashboard, confirm it's unused, and delete it
      there — not something backend code can safely detect-and-remove on its
      own with no `service_exposure` row to key off.
