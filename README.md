# Business Lab

**Version 0.74.0** — full history in the [changelog](/CHANGELOG.md).

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

Roster removals (§301 — drop the heaviest apps outright instead of tuning them):

- [ ] **@mat: Homebox vs ITFlow — one asset tracker per deployment** (§301e) —
      both track assets/warranties; not urgent and neither leaves the repo.
      A per-deployment profile choice: ITFlow for the MSP model (it tracks
      client assets as part of its wider job), Homebox for a simpler box.
      The rest of the §301e survey is resolved: Beszel (§323), MeshCentral
      (§320), Syncthing (§322) and kitchen-switcher (§321) removed; Uptime-Kuma
      kept over Beszel for its status page + alert rules. Minor/no action:
      wetty vs Guacamole SSH, Miniflux vs Nextcloud News, BookStack vs ITFlow
      docs (all cheap to keep).

Strategy:


### Backups

- [ ] **Prove a real external destination against off-host hardware** (§131.4,
      §196, §265, §266, §268, §269) — the `disk`-kind code path is proven end
      to end (§266: snapshot + byte-for-byte restore from a real ext4 bind
      mount, 50553 files) and the §265 source-scope bug is fixed. Still
      unproven: any destination on **separate hardware**. The test NAS
      (`192.168.1.50`) hangs `kopia repository create` identically over
      **SMB (§265), FTP (§268) and NFSv4.1 (§269)** — mount/transport is
      healthy each time (`dd`/`touch`/`rclone` all fine), but Kopia's first
      blob writes never complete against this box's storage. Three protocols,
      one uncooperative NAS — not a code problem. Prove it elsewhere: `s3`
      (already proven §221, recommended — needs an S3/MinIO endpoint), or
      `disk` on an actually-separate attached drive. `ftp`/`ftps`, `nfs` and
      the `disk` path are all code-complete; this item is just the off-host
      live run on hardware that cooperates.
### Business Lab (§84)

**§254 sequences these into buildable chunks (P1…P12) with the dependency
graph.** P1 (§255) and P2 (§256) are done. P3/P3a/P4 (social publishing via
Postiz, §257/§258/§261) are dropped — Postiz was removed in §301a. Phase tags
below.
- [ ] **P8 — Rebrand tier 2** (§84.2) — package/image/network/project names.
      Recreates the management stack — do it in the §83 data-root maintenance
      window, with host access, not before.
- [ ] **P10 — Turnkey build spec** (§84.7) — Dell/16 GiB/500 GB/€400 is proven
      (this stack runs on 14.84 GiB, 4 CPUs, 53 containers, 8 GB used). The
      trap is the disk: Ubuntu's installer defaults to a ~100 GiB root LV,
      which is how §83 happened. Set Docker's data root or the partitioning
      **at install**, and pick a small-office app profile. Partly depends on
      P9.
- [ ] **P11 — Data protection position** (§84.5) — controller vs processor,
      backup key custody, DR. A business stance to decide, then write up — not
      a coding session. §84.7 simplifies it (social tokens stay on the client
      box).
- [ ] **P12 — Commercial plan** (§84.5) — hardware BOM, support model,
      onboarding time, and what happens to a client's data when they stop
      paying. Lands as an **Artifact, not a repo commit** (§84.6). Blocked on
      the SaaS inventory + monthly costs from @mat (§84.7).

### Roster changes (§81)


- [ ] **`gdrive` as a non-S3 Kopia remote** (§194, §246) — **parked, not
      scheduled.** B2 needs no new destination type: S3-compatible API via the
      existing `s3` kind (§246). SFTP is done (§356). `gdrive` needs a GCP
      service-account JSON upload — a different UX from the "one token in
      Settings" pattern — so it only gets built if a real deployment wants it.
### Exposure and platform

- [ ] **CrowdSec-alert dedupe needs a real store** (§118.4a) — the Code node
      dedupes by IP within one batch, but `$getWorkflowStaticData` doesn't
      persist between executions for a CLI-imported workflow, so cross-batch
      dedupe doesn't work. Mostly moot (CrowdSec aggregates per bucket
      upstream); add a Redis-backed store only if pushes prove noisy in
      practice.

- [ ] **The start/restart log panel freezes the UI on a chatty first boot**
      (§371) — starting Twenty locked the dashboard while it streamed
      `docker compose logs --follow --tail 200`: Twenty's first boot emits
      thousands of NestJS lines (per-migration, per-cron-job) and the
      frontend log view renders them all with no cap/virtualisation. The
      backend op completes fine; a refresh recovers the UI. Cap the streamed
      lines (ring buffer), virtualise the list, or throttle the SSE.
- [ ] **`setup_server.sh` reinstalls gnupg/ca-certificates every run** (§366) —
      the missing-package check is `command -v gnupg` / `command -v ca-certificates`,
      but neither package provides a binary of that name (`gnupg` → `gpg`,
      `ca-certificates` → no binary), so both always "miss" and every run does
      an `apt-get update` + install — which hung the §365 deploy twice on a
      slow mirror. Fix the probe: check `command -v gpg` and
      `[ -e /etc/ssl/certs/ca-certificates.crt ]` (or `dpkg -s`), and don't
      `apt-get update` when nothing is actually missing.
- [ ] **@mat: refresh the Tailscale auth key before it expires** (§367) — the
      `TAILSCALE_AUTH_KEY` in `apps/tailscale/.env` had **expired**; a
      deauthed node then can't re-register at all (crash loop) until a new
      key is set via the dashboard Tailscale card → Configuration. A fresh
      reusable key was set 2026-09-10. Reusable keys still expire (90 d
      default) — set a calendar reminder, or switch to a tagged/ephemeral
      setup that doesn't.
- [ ] **NetBird client must run with `--disable-dns` on any box with Pi-hole**
      (§368) — a fresh NetBird enrollment turns DNS management **on**: it
      rewrites `/etc/resolv.conf` to `nameserver <netbird-ip>` and starts an
      embedded resolver on `:53`. Pi-hole's container already publishes `:53`,
      so the resolver can't bind and **all host DNS breaks** (self-update,
      backups, apt, everything) until `sudo netbird up --disable-dns`
      (persists as `DisableDNS:true` in `/var/lib/netbird/*.json`). Set on the
      test box 2026-09-10. Needs automating — `start.sh` doesn't run
      `netbird up` (interactive), so at minimum `docs/first-run.md` /
      `deployment-guide.md` must say to pass `--disable-dns`, and a re-enroll
      that forgets it silently kills DNS.

### Apps and integrations

- [ ] **Auto-register Nextcloud's `/shared` external mount + make the
      webmaster a Nextcloud admin** (§369) — done by hand on the test box
      (`occ app:enable files_external` + `occ files_external:create`, then
      `occ group:adduser admin mat`), but it should be automatic. `occ` has
      no password-confirmation constraint (that only affects the web API, the
      old §219 blocker), so `nextcloudSaml.ts` / an `occ` bootstrap can:
      (a) enable `files_external` and create the `/shared` Local mount for
      all users, and (b) add the Authelia admin (webmaster) to Nextcloud's
      `admin` group — SAML has no group mapping, so a fresh SSO account lands
      as a plain user and can't reach Admin settings at all.
- [ ] **@mat: relocate the live shared tree + re-prove the round-trip**
      (§310) — File Browser was removed and the shared tree moved from
      `apps/file-browser/data/files/` to `apps/nextcloud/data/shared/`. A
      fresh clone is fine (dir is gitignored), but the deployed host has
      real data at the old path: in a maintenance window `mv` it to the new
      path, then re-run §219's live check (write over SMB → visible in
      Nextcloud `/shared` and in Paperless's `to-paperless/` drop box → and
      back). Until then §310 stays on `dev`, unmerged.
- [ ] **App backlog** — §22 lists candidate apps by category (communication,
      business ops, no-code/BI, files/PDF, security/network, dev infra,
      productivity). Pull from there rather than restating it here.
