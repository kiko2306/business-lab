# First login, per app

What to log in with the first time you open each app, and where the value
comes from.

Three kinds of app, and the difference matters:

| | Meaning |
|---|---|
| **Generated** | The dashboard generated a random secret. Read it in the app's config panel. Nothing to choose. |
| **Wizard** | The app asks you to create an account on first visit. **Whoever opens it first owns it** — every app is exposed automatically behind Authelia, so open it yourself before you invite other Authelia users. |
| **Fixed default** | Ships with a published, well-known credential. **Change it immediately.** |

> **Open a Wizard app privately first.** On the LAN or over NetBird, not after
> publishing it. A first-run wizard reachable from the internet is an open
> invitation to have your instance claimed by someone else.

## The dashboard's own login

Not an app — the management dashboard itself. The first admin account is
created at `/setup` on first run (you choose the username and password). After
that, each admin can add a TOTP second factor to their own login from
**Account security**; it is optional and per account. See
[two-factor.md](two-factor.md). Locked out: `./start.sh recover` on the host
([recovery-troubleshooting.md](recovery-troubleshooting.md)).

## Fixed defaults — change these first

| App | Default | Notes |
|---|---|---|
| **Nginx Proxy Manager** | `admin@example.com` / `changeme` | Forces a change on first login. Do this **before** exposing anything — it controls all reverse proxying and holds the certificates. |
| **Pi-hole** | password = `PIHOLE_WEB_PASSWORD` in its config | Ships as `change-me`; set a real value in the dashboard before starting. |
| **Homebox** | first account you register owns it | Registration is open until you turn `HOMEBOX_ALLOW_REGISTRATION` off — claim it before inviting other Authelia users. Once exposed, an Authelia OIDC login appears (the dashboard wires the client automatically — §270). After signing in through it once, flip **Configuration → `HBOX_OPTIONS_ALLOW_LOCAL_LOGIN`** to false to drop Homebox's own username/password form and leave Authelia as the only gate. |
| **Guacamole** | `guacadmin` / `GUACAMOLE_ADMIN_PASSWORD` (generated, hidden) | Ships as `guacadmin`/`guacadmin`; the dashboard rotates that password to a generated one over Guacamole's own REST API the first time it logs in successfully after a start, so the shipped default stops working — no human step. Its Postgres password is a separate generated secret, unrelated to this. |

## Generated — read the value in the dashboard

Open the app's config panel in the dashboard. Values marked hidden are written
once and never displayed again; rotate them there if you need a new one.

| App | Username | Password / token |
|---|---|---|
| **Nextcloud** | `NEXTCLOUD_ADMIN_USER` | `NEXTCLOUD_ADMIN_PASSWORD` (generated). Optional: after exposing Nextcloud and applying Authelia's authrequest snippet to its NPM proxy host, set **Configuration → `NEXTCLOUD_PROXY_HEADER_AUTH`** true — the dashboard switches the bundled `user_saml` app into environment-variable mode so Authelia's `Remote-User` header logs you straight in (§216/§217). If the header path misbehaves, `https://<host>/login?direct=1` always shows the normal form and the local admin still works there; turning the toggle back off removes `user_saml` on the next start. |
| **Paperless-ngx** | `PAPERLESS_ADMIN_USER` | `PAPERLESS_ADMIN_PASSWORD` (generated). Behind Authelia the Paperless login form is skipped — it trusts the `Remote-User` header (`PAPERLESS_ENABLE_HTTP_REMOTE_USER`). LAN-direct access on the app's port still uses the form. A header-authed user that doesn't exist yet is auto-created non-staff; `PAPERLESS_ADMIN_USER` stays the superuser. The REST API keeps its own token auth. |
| **Kopia** | `kopia` (fixed) | `KOPIA_SERVER_PASSWORD` (generated) for the web UI / REST API. `KOPIA_PASSWORD` is the repository encryption password — also generated, and the one to keep safe: without it the snapshots can't be read on a rebuild. The backup **destination** (disk / SMB / NFS / S3 / FTP) is set in the dashboard at Settings → Backup destination; for FTP, enter the server (`host` or `host:port`), the remote directory (`/` = FTP root), and the FTP username/password there. |
| **Samba** | `SAMBA_USER` (default `labshare`) | `SAMBA_PASSWORD` — generated on first start. Set your own in the config panel if you need to know it to map the drive from Windows (`\\<host>\<SAMBA_SHARE_NAME>`). |
| **Vaultwarden** | — | `VAULTWARDEN_ADMIN_TOKEN` (generated, hidden) — for `/admin` only; normal accounts are self-registered |
| **Miniflux** | `MINIFLUX_ADMIN_USERNAME` (default `admin`) | `MINIFLUX_ADMIN_PASSWORD` (generated) — created from env on first boot, no wizard |
| **DocuSeal** | the Authelia admin's email | `DOCUSEAL_ADMIN_PASSWORD` (generated). DocuSeal community has no SSO and can't hide its login form, so it is **exposed directly, not behind Authelia** (§342) — this account is the only login. The dashboard runs DocuSeal's first-run `/setup` wizard on first start (§341); read the password from `apps/docuseal/.env`, or set your own in the config panel **before** the first start. After setup, change it in DocuSeal → profile settings. |

## Wizard — you create the account

Every app is exposed behind Authelia automatically — claim these yourself before inviting other Authelia users.

| App | First-run |
|---|---|
| **Authelia** | The SSO account itself. Managed from the dashboard (Authelia is the one app whose users the dashboard edits directly). |
| **Home Assistant** | Onboarding wizard creates the owner account. HACS is installed automatically; it needs a one-time GitHub authorization — see the note below. |
| **Immich** | First registered user becomes admin. Once exposed, the dashboard writes a managed `data/config/immich.json` wiring Authelia OIDC (§270/§275) and an "Authelia" button appears on the login page. **While that file is present Immich's admin *Settings* UI is read-only and any non-OIDC setting you'd changed there reverts to Immich's default** (the file is present whenever Immich is running — every app is exposed automatically). After one Authelia sign-in, flip **Configuration → `IMMICH_PASSWORD_LOGIN_ENABLED`** to false to drop Immich's own email/password form. |
| **Jellyfin** | Setup wizard creates the admin user. |
| **Navidrome** | First visit creates the admin account. |
| **Uptime Kuma** | First visit creates the admin account. |
| **BookStack** | Ships with `admin@admin.com` / `password` — change it on first login. |
| **Mealie** | Ships with `changeme@example.com` / `MyPassword`. The dashboard rotates that password to a generated `MEALIE_ADMIN_PASSWORD` the first time Mealie is reachable (like Guacamole's `guacadmin`) and uses that account to point Mealie's AI recipe parsing at the Settings → Claude API key (§238). Create your own admin user in Mealie; the seeded one is dashboard-owned. AI parsing goes through Anthropic's OpenAI-compat endpoint, which Anthropic documents as test-only — a badly-structured page can still fail to parse. Once exposed, an Authelia OIDC login appears (the dashboard wires the client automatically — §270/§274). After signing in through it once, flip **Configuration → `ALLOW_PASSWORD_LOGIN`** to false to drop Mealie's own username/password form and leave Authelia as the only gate. |
| **NocoDB** | First signup becomes the super admin. |
| **Vikunja** | Register the first account; registration can then be disabled. Once exposed, an "Authelia" OIDC login button appears (the dashboard wires the client automatically — §270). After signing in through it once, flip **Configuration → `VIKUNJA_AUTH_LOCAL_ENABLED`** to false to drop Vikunja's own username/password form and leave Authelia as the only gate. |
| **n8n** | Owner account created on first visit. |
| **NetBird** | Log in through Authelia; the first user becomes account owner. |
| **ITFlow** | Setup wizard creates the first admin. See the note below — it needs two things switched on afterwards. |

### Nextcloud — register the shared tree once (External Storage)

The shared tree lives at `apps/nextcloud/data/shared/` (§202/§219/§310) — a
sibling of Nextcloud's webroot, also served over SMB by Samba — and is
bind-mounted into the Nextcloud container at `/shared`, but Nextcloud won't
show it until you register it as external storage — and that one step can't
be scripted:
Nextcloud's own create API for it requires a fresh interactive password
confirmation (`#[PasswordConfirmationRequired(strict: true)]`), which no
API/Basic-Auth call can satisfy, and the `occ files_external:create` command
older docs describe no longer exists in current Nextcloud.

**Admin settings -> External Storage -> Add storage**: name it (e.g.
`Shared`), type **Local**, path `/shared`, Auth `None`, leave it applicable
to all users, then **Save**. Takes effect immediately, no restart needed.

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

## Global mail settings — who inherits them

One SMTP account is entered once in **Settings → Email**. Apps that read mail
config from their environment get it injected automatically at start (restart
the app to apply, same as exposure):

**Vaultwarden**, **BookStack**, **n8n** (user-management emails), **Paperless**
(sending only), **Vikunja**.

Two apps keep mail config in their own database and cannot inherit it — the
global settings are values to **copy into the app's own UI** by hand, and
nothing warns you if you don't:

- **ITFlow** — see the note above.
- **Uptime Kuma** — an email alert is an SMTP *notification* created under
  **Settings → Notifications**. There is no environment variable for it.

Paperless' *document intake* over IMAP is also its own per-account setting
(**Settings → Mail**), separate from the global config.

## No login of their own

These have no authentication, or none enabled by default. Every exposed app
gets an Authelia login automatically — that is their only gate, and it is no
longer a per-app setting (Home Page is the sole exception: it's the
deliberately public front door).

A separate set *do* have their own login but skip it behind Authelia, so an
SSO login lands with no second form: **Paperless-ngx**
(`PAPERLESS_ENABLE_HTTP_REMOTE_USER`) trusts the `Remote-User` header NPM sets
from the Authelia forward-auth, and still shows its own login on LAN-direct
access. This is a fixed per-app property, not a setting.

**Guacamole**, **Kopia**, **n8n** and **ITFlow** are `overlayOnly` (plan.md
§288/§318/§344): never on the public tunnel, reached directly on their host
port over NetBird/Tailscale with their own login only. Guacamole opens
RDP/VNC/SSH to every overlay host; Kopia can read and delete every backup;
n8n runs arbitrary code; ITFlow holds client passwords and documentation —
each is one weak login away from the whole estate, so it stays off the
internet and Authelia is *not* stacked in front (that would be a second
login — §342). NPM's own admin UI and Pi-hole are `overlayOnly` for the same
reason. Guacamole's bundled `guacamole-auth-header` extension is left off
since no reverse proxy fronts it — a forged `Remote-User` header on a
directly reachable port would be an auth bypass.

| App | Why |
|---|---|
| **Web Terminal (wetty)** | Hands out a shell on the host. Authelia is the only thing between the internet and a root-capable session — it is not optional here. |
| **Code Server** | Own web login enabled (`CODE_SERVER_PASSWORD`, auto-generated, hidden — read it from `apps/code-server/.env` if needed); Authelia additionally gates the tunnel hostname. |
| **Dozzle** | Reads container logs, no auth. |
| **Scrutiny** | Disk SMART health dashboard, no auth of its own. |
| **IT Tools** | Static utility SPA, no backend and no auth of its own. |
| **Stirling PDF** | `SECURITY_ENABLELOGIN=false` by default; can be enabled instead. |
| **Speedtest**, **Pantry**, **Price Compare** | No auth of their own. |
| **ntfy** | Open by default; supports its own ACLs if you configure them. |
| **OnlyOffice** | No human login — Nextcloud embeds it and every request is signed with a generated JWT secret (`ONLYOFFICE_JWT_SECRET`, read it in the config panel to paste into Nextcloud's connector). Keeps no persistent state of its own — see [recovery-troubleshooting.md](recovery-troubleshooting.md#onlyoffice-keeps-no-persistent-state). |

## Services with no web UI

**CrowdSec**, **Tailscale** — no login, nothing to expose.
CrowdSec's bouncer keys and Tailscale's auth key are handled by the dashboard
and `start.sh`. CrowdSec generates two: `CROWDSEC_BOUNCER_KEY` for the
Cloudflare worker bouncer and `CROWDSEC_NGINX_BOUNCER_KEY` for the Lua bouncer
inside Nginx Proxy Manager, kept separate so either can be revoked on its own
(`cscli bouncers delete nginx`). Both are generated on first start and baked
into the right config file; neither is ever typed.

## Rotating a credential

Generated values live in each app's `.env`, written by the dashboard. Change
them in the app's config panel and restart the app — editing files by hand
means the dashboard's copy and the app's copy can disagree.

For anything a wizard created, change it inside the app itself; the dashboard
does not manage those accounts (Authelia excepted).

## Home Assistant: authorizing HACS

HACS (the Home Assistant Community Store) is installed automatically on every
Home Assistant start — several appliances here have no core integration and are
only reachable through a HACS repository, so it is a prerequisite rather than an
optional extra. It is not configured for you, because it cannot be: HACS talks
to the GitHub API on your behalf and needs an account.

One-time, in Home Assistant: **Settings → Devices & Services → Add Integration →
HACS**, tick the acknowledgements, then open the github.com/login/device link it
shows and enter the code. After that, HACS appears in the sidebar and
repositories install from its UI.

Two integrations this house needs are both in the HACS default list, so they are
a search away once HACS is authorized — no custom repository URL to paste:

| Appliance | HACS repository | What it needs from you |
|---|---|---|
| Beko/Grundig/Arçelik washing machine | `home-assistant-HomeWhiz/home-assistant-HomeWhiz` | a HomeWhiz account (Wi-Fi models) or Bluetooth range (BLE models) |
| Ariston water heater | `fustom/ariston-remotethermo-home-assistant-v3` | an Ariston NET account |

HACS updates itself from inside Home Assistant, so the automatic install only
ever runs when HACS is missing — it never overwrites a version you already have.
