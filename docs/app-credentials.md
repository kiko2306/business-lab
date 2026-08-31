# First login, per app

What to log in with the first time you open each app, and where the value
comes from.

Three kinds of app, and the difference matters:

| | Meaning |
|---|---|
| **Generated** | The dashboard generated a random secret. Read it in the app's config panel. Nothing to choose. |
| **Wizard** | The app asks you to create an account on first visit. **Whoever opens it first owns it** — do that before exposing it publicly. |
| **Fixed default** | Ships with a published, well-known credential. **Change it immediately.** |

> **Open a Wizard app privately first.** On the LAN or over NetBird, not after
> publishing it. A first-run wizard reachable from the internet is an open
> invitation to have your instance claimed by someone else.

## Fixed defaults — change these first

| App | Default | Notes |
|---|---|---|
| **Nginx Proxy Manager** | `admin@example.com` / `changeme` | Forces a change on first login. Do this **before** exposing anything — it controls all reverse proxying and holds the certificates. |
| **Pi-hole** | password = `PIHOLE_WEB_PASSWORD` in its config | Ships as `change-me`; set a real value in the dashboard before starting. |

## Generated — read the value in the dashboard

Open the app's config panel in the dashboard. Values marked hidden are written
once and never displayed again; rotate them there if you need a new one.

| App | Username | Password / token |
|---|---|---|
| **Beszel** | `BESZEL_ADMIN_EMAIL` | `BESZEL_ADMIN_PASSWORD` (generated) |
| **Nextcloud** | `NEXTCLOUD_ADMIN_USER` | `NEXTCLOUD_ADMIN_PASSWORD` (generated) |
| **Paperless-ngx** | `PAPERLESS_ADMIN_USER` | `PAPERLESS_ADMIN_PASSWORD` (generated) |
| **Duplicati** | — | `DUPLICATI_WEB_PASSWORD` (generated) |
| **WAHA** | dashboard user | `WAHA_DASHBOARD_PASSWORD`, `WAHA_SWAGGER_PASSWORD`, `WAHA_API_KEY` (all generated) |
| **Vaultwarden** | — | `VAULTWARDEN_ADMIN_TOKEN` (generated, hidden) — for `/admin` only; normal accounts are self-registered |
| **Portainer** | you choose at first visit | Protected by a **setup token** the dashboard manages — Portainer locks itself if left unclaimed too long |

## Wizard — you create the account

Open these privately and claim them before exposing.

| App | First-run |
|---|---|
| **Authelia** | The SSO account itself. Managed from the dashboard (Authelia is the one app whose users the dashboard edits directly). |
| **Home Assistant** | Onboarding wizard creates the owner account. |
| **Immich** | First registered user becomes admin. |
| **Jellyfin** | Setup wizard creates the admin user. |
| **Uptime Kuma** | First visit creates the admin account. |
| **BookStack** | Ships with `admin@admin.com` / `password` — change it on first login. |
| **Mealie** | Ships with `changeme@example.com` / `MyPassword` — change it on first login. |
| **NocoDB** | First signup becomes the super admin. |
| **Vikunja** | Register the first account; registration can then be disabled. |
| **n8n** | Owner account created on first visit. |
| **Grocy** | Ships with `admin` / `admin`. |
| **File Browser** | Ships with `admin` / `admin`. |
| **NetBird** | Log in through Authelia; the first user becomes account owner. |
| **ITFlow** | Setup wizard creates the first admin. See the note below — it needs two things switched on afterwards. |

### ITFlow — two things to do after the wizard

Neither is obvious, and both fail *silently* if missed.

1. **Email.** ITFlow does not read mail settings from the environment; it keeps
   them in its own database. So the dashboard's global mail settings
   (Settings → Email) are values to **copy into ITFlow's own UI**, not values
   it inherits. Nothing warns you — outgoing mail simply never sends.
2. **Cron.** Email-to-ticket, the mail queue and recurring invoices all run
   from cron. The container already runs it, so there is nothing to schedule on
   the host, but it must be enabled inside ITFlow:
   **Settings → Notifications → enable Cron**, with the individual jobs under
   **Maintenance → Cron**.

Worth knowing: the container's healthcheck only probes the web server, not
cron. If cron dies the container still reports healthy while every scheduled
job stops.

## No login of their own

These have no authentication, or none enabled by default. **Every one should
have "Require Authelia login" turned on when exposed** — that is their only
gate.

| App | Why |
|---|---|
| **Web Terminal (wetty)** | Hands out a shell on the host. Authelia is the only thing between the internet and a root-capable session — it is not optional here. |
| **Code Server** | Its own web login is deliberately disabled; Authelia is the gate. |
| **Dozzle** | Reads container logs, no auth. |
| **Homepage** | Static dashboard. |
| **Stirling PDF** | `SECURITY_ENABLELOGIN=false` by default; can be enabled instead. |
| **Speedtest**, **Kitchen Switcher**, **Pantry**, **Price Compare** | No auth of their own. |
| **ntfy** | Open by default; supports its own ACLs if you configure them. |

## Services with no web UI

**CrowdSec**, **Tailscale**, **Watchtower** — no login, nothing to expose.
CrowdSec's bouncer key and Tailscale's auth key are handled by the dashboard
and `start.sh`.

## Rotating a credential

Generated values live in each app's `.env`, written by the dashboard. Change
them in the app's config panel and restart the app — editing files by hand
means the dashboard's copy and the app's copy can disagree.

For anything a wizard created, change it inside the app itself; the dashboard
does not manage those accounts (Authelia excepted).
