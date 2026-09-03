# User Guide

## Dashboard

- View service status in real time.
- Start/stop allowlisted services.
- Inspect health and audit sections.

## Two-factor authentication

- The dashboard login can take a time-based one-time code (TOTP) on top of your
  password. It is per account and opt-in.
- Turn it on from **Account security** in the user menu: scan the QR into an
  authenticator app, enter a code to activate, then **save the ten recovery
  codes** — they are shown once.
- Once on, signing in asks for a 6-digit code after the password. No code? Use
  one of the recovery codes (each works once).
- Turn it off from the same page with a current code or your password.
- Lost the authenticator *and* the recovery codes? That is a lockout — the
  host operator runs `./start.sh recover disable-2fa <username>`.
- Full details: [two-factor.md](two-factor.md).

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
- File Browser and Stirling-PDF embed a database (BoltDB / H2) that is copied
  live, not snapshotted, so it can restore corrupt — an accepted risk because
  both hold little that isn't quickly rebuilt. See
  `docs/recovery-troubleshooting.md`.
- Locked out of the dashboard? Run `./start.sh recover reset-password` on the
  host — it prompts for the username and a new password and resets it inside
  the backend container. `./start.sh recover list` shows the usernames; add
  `create-admin` if no account exists at all. See
  `docs/recovery-troubleshooting.md`.
