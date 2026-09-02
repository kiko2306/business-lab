# User Guide

## Dashboard

- View service status in real time.
- Start/stop allowlisted services.
- Inspect health and audit sections.

## Settings

- Save Cloudflare token in the Settings panel.
- Use built-in validation and token test flow.
- Configure first-start exposure provisioning with the base domain, Cloudflare
  account, zone, and tunnel IDs, plus Nginx Proxy Manager credentials. For the
  bundled Docker stacks, use `http://host.docker.internal:81` as the Nginx
  Proxy Manager API URL. This address is reachable from the backend container,
  and the Cloudflare Tunnel reaches NPM through the host gateway on port 80.
- On each service card, enable public exposure with a single toggle — the
  upstream host/port are derived automatically from the service's own compose
  file, so there's nothing to enter by hand. The card shows a read-only
  "forwarding to..." line once configured. The proxy host and tunnel route are
  applied after the next successful start.
- Per-app secrets (e.g. a service's admin password or API key) are configured
  from that service's card too, under **Configuration** — fill in the
  required fields and save; the backend writes the app's `.env` for you.

## Backup and recovery

- Create backups from the dashboard.
- "Back up now" on the schedule card runs the app-data backup on demand (dump
  every app database, then Duplicati) — use it to check a destination you have
  just changed rather than waiting for the next scheduled run.
- Restore when needed.
- Recovery mode (emergency admin-password reset) is API-only and gated to
  localhost. On this containerized deployment a request from the host does not
  count as localhost, so there is currently no sanctioned way to use it on a
  headless server — see `docs/recovery-troubleshooting.md`. Tracked as an open
  item in the README.
