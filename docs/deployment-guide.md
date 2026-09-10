# Deployment Guide

Provisioning one box for one client, end to end. Each step links to the
reference that covers its detail; this page is only the order.

One deployment is one client: their domain, their Cloudflare account, their
user set, their backup destination. Nothing here is shared between clients.

## Before the box

Have these in hand — `start.sh` cannot derive them (see
[first-run.md § Before you run it](first-run.md)):

- The client's **domain**, already a zone in a Cloudflare account (theirs if
  self-controlled, a reseller-managed one if contracted — see §203).
- A **Cloudflare API token** scoped to **that one zone** (Zone Resources →
  Include → Specific zone), with Account → Cloudflare Tunnel: Edit and
  Zone → DNS: Edit.
- A **Tailscale account + reusable auth key**, and Funnel enabled once for the
  tailnet.
- Hardware per [the turnkey build spec](../README.md#todo) — decide Docker's
  data root at install time, not after (first-run.md § Where Docker keeps its
  data).

## 1. First run on the host

```bash
sudo ./start.sh
```

The only command run on the host. For an unattended run, fill
`start.config` (from `start.config.example`) with the four values above
first. `start.sh` installs Docker, provisions the tunnel, brings up the core
stack, and publishes the dashboard at `https://homelab.<domain>`. Everything
else is done from the dashboard.

Full walk-through of the prompts and the `setup_server.sh` sub-prompts (fixed
IP, passwordless sudo, freeing port 53): [first-run.md](first-run.md).

## 2. Create the admin account

Open the printed dashboard URL and complete `/setup`. This is the client's
Authelia admin identity — every app that seeds its own first admin
(Nextcloud, ITFlow, Kimai, NocoDB, …) takes its email from here on first
start, so there is no per-app admin step later (plan.md §341/§346/§347).

## 3. Fill in the per-deployment settings

**Settings → Deployment checklist** lists what is still blank and links each
item to its section. Work it top to bottom:

| Setting | Where | Notes |
|---|---|---|
| Base domain, tunnel, proxy credentials | Networking | Pre-filled by `start.sh`; confirm and **Test connection** — it warns if the token is not zone-scoped |
| Cloudflare account model | Networking | `self-controlled` or `contracted` — recorded for the record (§203/§359) |
| Cloudflare token | Networking | Only if `start.sh` could not store it |
| Email (shared mailbox) | Email | One mailbox every app sends/receives through; **Send test** |
| Backup destination | Backup destination | `disk` / `s3` / `sftp` / … — **Test** before relying on it. Custody of the repository passphrase is a contract term (§84.5) |

The checklist shows all seven items **Set** when the box is provisioned.

## 4. Add the client's people

**Users page → Accounts** — add each staff member (offices of 2–15), pick
their role, and send the invite. They set their own password and 2FA from the
invite link.

## 5. Start the apps

Order matters for the first three (first-run.md § The order that works):

1. **Nginx Proxy Manager** — change its default login immediately
   ([app-credentials.md](app-credentials.md)).
2. **Authelia** — the login gate; exposed apps error until it is up.
3. Everything else, any order.

Each exposable app gets a public `<name>.<domain>` behind Authelia on that
start — no toggle, no per-app exposure step (plan.md §331). Set any config an
app asks for (generated secrets are pre-filled — just save).

## 6. Hand over

- Deployment checklist all green.
- Backup **Test** passes and a first snapshot has run.
- Client can log in, reach their apps through SSO, and has the recovery
  procedure ([recovery-troubleshooting.md](recovery-troubleshooting.md)).

## Dockerized E2E deployment validation

Not part of provisioning a client box — this is the pre-release check that the
core stack itself is sound:

```bash
./scripts/docker-e2e-test.sh
```

Validates frontend static serving, backend + DB connectivity, the
setup/login/refresh/logout auth flows, settings/audit/health/SSE, and
recovery mode toggled from a localhost context.
