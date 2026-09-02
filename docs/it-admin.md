# IT administrator runbook — running the stack

You **deploy, run and maintain the app stack**. The dashboard is your
interface; `./start.sh` is the only command you run on the host. You do not
touch Cloudflare beyond what `start.sh` automates — that is the
[webmaster](webmaster.md). Everything procedural lives in the docs this page
links to; it is not restated here.

## The one hard rule: no console configuration

The only command a human runs on the host is `./start.sh`. Credentials,
exposure, per-app config, secrets — all entered and applied through the
dashboard UI. **No hand-edited YAML / env / conf, no `docker exec`, no `cscli`
steps.** Fixing something by hand on the live host is a diagnostic, never a
fix: `apps/*/data/` is gitignored, so it evaporates on the next fresh clone
(`plan.md` §0, principle 2). If a hand-fix works, the job is to make the code
do it and delete the hand-fix.

## Install

Follow [first-run.md](first-run.md) end to end — what to have ready, what
`start.sh` prompts for, and what is reachable when it finishes. System
requirements are in [setup-guide.md](setup-guide.md); arm64 / Raspberry Pi
specifics in [raspberry-pi.md](raspberry-pi.md).

After the first run, **only the dashboard is running and published**. Every
other app is started from the dashboard.

## Day to day

- **Start / stop apps** from the dashboard. Order matters on a cold start:
  Nginx Proxy Manager first, then Authelia, then everything else — see
  [first-run.md § The order that works](first-run.md#the-order-that-works).
  The dashboard disables the start button for an app whose hard dependency is
  down.
- **Per-app config**: the dashboard pre-fills generated secrets — just Save.
  First-login credentials for each app are in
  [app-credentials.md](app-credentials.md).
- **Exposure**: per app, toggle "Publicly expose this service" and "Require
  Authelia login" (leave the second on unless the app has its own solid
  auth). Provisioning creates the NPM proxy host, the tunnel ingress rule and
  the DNS record automatically; turning it off removes all three.
- **Ports**: [ports.md](ports.md). `start.sh` allocates from 10100 upward and
  logs any app it had to move.
- **Global mail**: set it once in Settings → Email. Apps that inherit it are
  listed in [app-credentials.md](app-credentials.md#global-mail-settings--who-inherits-them);
  ITFlow and Uptime Kuma need it copied into their own UI.
- **Updates**: the dashboard has an image-update check (there is no
  Watchtower — `plan.md` §82). Restart individual services to apply.
  **Never `docker compose down` the root stack** — that tears down the running
  dashboard, backend and database.

## Backups

- Schedule, retention, "Back up now" and the destination are all in the
  dashboard. The schedule card shows the last run and its outcome, the
  destination actually in use, and how many versions are on it.
- **File Browser** and **Stirling-PDF** embed a database that is copied live,
  not snapshotted, and can restore corrupt — an accepted risk documented in
  [recovery-troubleshooting.md](recovery-troubleshooting.md#apps-without-a-consistent-database-snapshot).
- Restore, and emergency admin-password reset, are in
  [recovery-troubleshooting.md](recovery-troubleshooting.md). Note the recovery
  endpoints are not currently reachable from a headless host — that page says
  what to do instead.

## Storage

Docker's data root and growing a filesystem onto a new disk are both handled
by `start.sh` flags (`DOCKER_DATA_ROOT`, `EXPAND_VG_DISK`) — see
[first-run.md](first-run.md#where-docker-keeps-its-data). Decide the data root
before the images pile up.

## Licence conditions you operate under

[licences.md](licences.md) lists the whole stack. The ones that constrain
operations: keep **n8n one box per client** (never a shared multi-tenant
instance), do **not white-label OnlyOffice**, do not enable Stirling-PDF's
paid `proprietary/` features, and never run a modified build of an AGPL/GPL
app without publishing the change. Stock images only.

## When something is not reachable

Work [first-run.md § If something is not reachable](first-run.md#if-something-is-not-reachable):
usually the app is not started, or NPM is down. Backend logs:
`docker compose logs -f backend`. Deeper recovery:
[recovery-troubleshooting.md](recovery-troubleshooting.md).

## Adding an app

That is a code change (a compose project, a `services.ts` entry, doc rows
including a [licences.md](licences.md) row), not an operations task — see the
Conventions section of `CLAUDE.md`.
