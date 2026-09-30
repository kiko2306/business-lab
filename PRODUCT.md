# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
The client operator of a self-hosted business box: a non-technical small-business owner or staff member who runs their own server through the dashboard and never touches a console. The reseller/admin who sets the box up is a secondary audience, not the design target.

## Product Purpose
A dashboard that starts, stops, configures and exposes ~36 self-hosted apps (each a Docker Compose project under `apps/`). Success: everything a human needs after `./start.sh` (credentials, exposure, per-app config, secrets, backups, updates) is done in the UI, with nothing left in a runbook.

## Positioning
Zero-console turnkey. The only host command is `./start.sh`; ingress (Cloudflare Tunnel behind Authelia), secrets, admin bootstraps and backups are derived or generated automatically, and the UI prompts only for what cannot be obtained (a third-party token, once).

## Operating Context
Angular 18 + Bootstrap 5 frontend, Node/Express API, Postgres, all in Docker. Deployed per client with its own domain and credentials; the reference deployment (`tx-home-utils.com`) is a no-guarantees dev/test box. Exposed apps appear as tiles on a public Home Page.

## Capabilities and Constraints
- Two shipped languages: English and pt-PT (`frontend/src/app/i18n`); every user-facing string goes through the translate service.
- Exposure is automatic for every exposable app; there is no per-app toggle.
- Dependencies between apps are two-tier: `dependsOn` blocks a start, `requires` only warns.
- No router changes, no console configuration, automate everything automatable (CLAUDE.md principles).

## Evidence on Hand
Operator docs in `docs/` (`first-run.md`, `app-credentials.md`, `ports.md`, `licences.md`). No customer testimonials, screenshots or usage metrics exist; do not invent them.

## Product Principles
- Nothing the system can derive is asked of the user.
- State and consequences are visible where the action is (dependency chips, blocked-start reasons), not buried in a tooltip or a runbook.
- A destructive or outward-facing action is confirmed; a routine one is one click.
- Plain language for a non-technical reader, in both shipped languages.

## Accessibility & Inclusion
WCAG AA contrast and keyboard-operable controls; dialogs carry accessible names. English and pt-PT parity for all UI text.
