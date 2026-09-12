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
| **Nginx Proxy Manager** | none — see Notes | No human step. The moment the dashboard first needs NPM's API (provisioning the first app's exposure) it detects the unclaimed install and either creates the first admin user itself (current NPM ships with none at all — its own UI's unauthenticated `POST /users` on first run) or, on an older pinned image still shipping `admin@example.com`/`changeme`, logs in with that and rotates it — either way to a generated password it then owns (`bootstrapNpmAdminIfDefault`, `npmClient.ts`; plan.md §285). That password is never shown back through the dashboard (same write-only pattern as every other hidden secret); **Settings → Networking → Test connection** confirms it's working. Only touch these fields by hand if you've already changed NPM's password some other way and need to tell the dashboard the new value. |
| **Pi-hole** | password = `PIHOLE_WEB_PASSWORD` in its config | Ships as `change-me`; set a real value in the dashboard before starting. |
| **Guacamole** | `guacadmin` / `GUACAMOLE_ADMIN_PASSWORD` (generated, hidden) | Ships as `guacadmin`/`guacadmin`; the dashboard rotates that password to a generated one over Guacamole's own REST API the first time it logs in successfully after a start, so the shipped default stops working — no human step. Its Postgres password is a separate generated secret, unrelated to this. |

## Generated — read the value in the dashboard

Open the app's config panel in the dashboard. Values marked hidden are written
once and never displayed again; rotate them there if you need a new one.

| App | Username | Password / token |
|---|---|---|
| **Nextcloud** | `NEXTCLOUD_ADMIN_USER` | `NEXTCLOUD_ADMIN_PASSWORD` (generated). Optional: after exposing Nextcloud and applying Authelia's authrequest snippet to its NPM proxy host, set **Configuration → `NEXTCLOUD_PROXY_HEADER_AUTH`** true — the dashboard switches the bundled `user_saml` app into environment-variable mode so Authelia's `Remote-User` header logs you straight in (§216/§217). If the header path misbehaves, `https://<host>/login?direct=1` always shows the normal form and the local admin still works there; turning the toggle back off removes `user_saml` on the next start. |
| **Paperless-ngx** | `PAPERLESS_ADMIN_USER` | `PAPERLESS_ADMIN_PASSWORD` (generated). Behind Authelia the Paperless login form is skipped — it trusts the `Remote-User` header (`PAPERLESS_ENABLE_HTTP_REMOTE_USER`). LAN-direct access on the app's port still uses the form. A header-authed user that doesn't exist yet is auto-created non-staff; `PAPERLESS_ADMIN_USER` stays the superuser. The REST API keeps its own token auth. |
| **Kopia** | `kopia` (fixed) | `KOPIA_SERVER_PASSWORD` (generated) for the web UI / REST API. `KOPIA_PASSWORD` is the repository encryption password — also generated, and the one to keep safe: without it the snapshots can't be read on a rebuild. The backup **destination** (disk / SMB / NFS / S3 / FTP / FTPS / SFTP) is set in the dashboard at Settings → Backup destination. For FTP/FTPS/SFTP, enter the server (`host` or `host:port`), the remote directory (`/` = root), and the username/password; Kopia reaches all three through the bundled `rclone`. SFTP is password-auth only and does not verify the host key unless you add `--sftp-known-hosts-file=…` in the extra-flags field. |
| **Samba** | `SAMBA_USER` (default `labshare`) | `SAMBA_PASSWORD` — generated on first start. Set your own in the config panel if you need to know it to map the drive from Windows (`\\<host>\<SAMBA_SHARE_NAME>`). |
| **Vaultwarden** | — | `VAULTWARDEN_ADMIN_TOKEN` (generated, hidden) — for `/admin` only; normal accounts are self-registered |
| **Miniflux** | `MINIFLUX_ADMIN_USERNAME` (default `admin`) | `MINIFLUX_ADMIN_PASSWORD` (generated) — created from env on first boot, no wizard |
| **DocuSeal** | the Authelia admin's email | `DOCUSEAL_ADMIN_PASSWORD` (generated). DocuSeal community has no SSO and can't hide its login form, so it is **exposed directly, not behind Authelia** (§342) — this account is the only login. The dashboard runs DocuSeal's first-run `/setup` wizard on first start (§341); read it in the config panel, or set your own **before** the first start. After setup, change it in DocuSeal → profile settings. |
| **NocoDB** | the Authelia admin's email | `NOCODB_ADMIN_PASSWORD` (generated, complex). Community NocoDB has no OIDC, so it is **exposed directly, not behind Authelia** (§344) — this account is the only login. NocoDB (re-)provisions its super admin from `NC_ADMIN_EMAIL` / `NC_ADMIN_PASSWORD` on **every** boot, so this is the source of truth — change it in the config panel and restart, not inside NocoDB. |
| **ITFlow** | the Authelia admin's email | `ITFLOW_ADMIN_PASSWORD` (generated). ITFlow has no OIDC (SAML only), can't hide its own login form, and its client portal must be public — so it is **exposed directly, not behind Authelia** (§342/§350) and this account is the only login. The dashboard runs ITFlow's first-run wizard on first start — its *first* step creates the schema (the itfloworg image doesn't), then the admin, and re-syncs the admin's email + password to the current Authelia admin / config panel value on every start after (§381/§382). Read the password in the config panel, or set your own **before** the first start (or any time after — the config panel value is the source of truth, restart to apply). **Changing it discards any credential ITFlow itself has encrypted** (client passwords/API keys stored *inside* ITFlow, not the dashboard) — its login password also unlocks ITFlow's own internal credential-encryption key, and there is no way to re-wrap that key without the *old* password. Turn on 2FA in ITFlow → **My Profile** afterwards. |
| **Kimai** | the Authelia admin's email (user `admin`) | `KIMAI_ADMIN_PASSWORD` (generated, complex). Kimai federates via SAML only and Authelia is OIDC-only, so it is **exposed directly, not behind Authelia** (§342) — this account is the only login. Kimai's entrypoint runs `kimai:user:create admin` from `ADMINMAIL`/`ADMINPASS` on **every** boot (no-ops once the user exists); the dashboard injects the email and generates the password into `apps/kimai/.env`. Recovery = change `KIMAI_ADMIN_PASSWORD` in the config panel and restart (not email — set `KIMAI_MAILER_URL` by hand if you want reset mails). Turn on Kimai's built-in 2FA in **My Profile** afterwards. |

## Wizard — you create the account

Every app is exposed behind Authelia automatically — claim these yourself before inviting other Authelia users.

| App | First-run |
|---|---|
| **Authelia** | The SSO account itself. Managed from the dashboard (Authelia is the one app whose users the dashboard edits directly). |
| **Home Assistant** | The dashboard runs HA's onboarding on start (§344) — the owner is `<Authelia admin username>` / generated `HOMEASSISTANT_ADMIN_PASSWORD` (read it in the config panel, or set your own there before the first start). HA is exposed **directly, not behind Authelia** (core HA has no OIDC/header-trust — §311); its own login is the only gate, with `ip_ban_enabled` forced on in the managed `http:` block. Turn on MFA in HA → your profile. HACS is installed automatically — one-time GitHub authorization, see the note below. |
| **Immich** | First registered user becomes admin. Once exposed, the dashboard writes a managed `data/config/immich.json` wiring Authelia OIDC (§270/§275) and an "Authelia" button appears on the login page. **While that file is present Immich's admin *Settings* UI is read-only and any non-OIDC setting you'd changed there reverts to Immich's default** (the file is present whenever Immich is running — every app is exposed automatically). After one Authelia sign-in, flip **Configuration → `IMMICH_PASSWORD_LOGIN_ENABLED`** to false to drop Immich's own email/password form. |
| **Jellyfin** | LAN only (§344) — not on the tunnel or the overlay. Reach it on the LAN at the host's `JELLYFIN_PORT` and run its setup wizard there to create the admin. |
| **Navidrome** | First visit creates the admin account. |
| **Twenty** | First visit creates the workspace owner. Twenty's SSO (OIDC/SAML) is an Enterprise-licensed feature not in the community edition, so it is **exposed directly, not behind Authelia** (§342) and its own account system is the only gate. Once your owner account exists, set **Settings → Admin Panel → Configuration Variables → `IS_SIGN_UP_ENABLED`** to false (takes effect live) so nobody else can self-register. `TWENTY_APP_SECRET` (generated, shown in the config panel) also seeds the field-encryption key — back it up; losing it makes encrypted column values unreadable. |
| **Uptime Kuma** | First visit creates the admin account. |
| **BookStack** | Once exposed, `AUTH_METHOD=oidc` + auto-initiate sends every login straight to Authelia (§344) — no BookStack form. An Authelia user in the `admins` group is auto-provisioned as a BookStack admin on first sign-in. The shipped `admin@admin.com` / `password` standard account still exists as break-glass at `<host>/login?prevent_auto_init=true` — change its password (or disable it) once an OIDC admin is in. |
| **Mealie** | Ships with `changeme@example.com` / `MyPassword`. The dashboard rotates that password to a generated `MEALIE_ADMIN_PASSWORD` the first time Mealie is reachable (like Guacamole's `guacadmin`) and uses that account to point Mealie's AI recipe parsing at the Settings → Claude API key (§238). Create your own admin user in Mealie; the seeded one is dashboard-owned. AI parsing goes through Anthropic's OpenAI-compat endpoint, which Anthropic documents as test-only — a badly-structured page can still fail to parse. Once exposed, an Authelia OIDC login appears (the dashboard wires the client automatically — §270/§274). After signing in through it once, flip **Configuration → `ALLOW_PASSWORD_LOGIN`** to false to drop Mealie's own username/password form and leave Authelia as the only gate. |
| **Vikunja** | Register the first account; registration can then be disabled. Once exposed, an "Authelia" OIDC login button appears (the dashboard wires the client automatically — §270). After signing in through it once, flip **Configuration → `VIKUNJA_AUTH_LOCAL_ENABLED`** to false to drop Vikunja's own username/password form and leave Authelia as the only gate. |
| **n8n** | Owner account created on first visit. |
| **NetBird** | Log in through Authelia; the first user becomes account owner. For remote LAN access (the routing peer), see [deployment-guide.md § Optional: NetBird's routing peer](deployment-guide.md#optional-netbirds-routing-peer-for-remote-lan-access). |

### Nextcloud — the shared tree and admin access are automatic

The shared tree lives at `apps/nextcloud/data/shared/` (§202/§219/§310) — a
sibling of Nextcloud's webroot, also served over SMB by Samba — and is
bind-mounted into the Nextcloud container at `/shared`. The dashboard
registers it as external storage (name `Shared`, all users) on every
Nextcloud start, so there is nothing to click through: **Admin settings ->
External Storage** just shows it already there. (The earlier premise that
this needed a real interactive session — `#[PasswordConfirmationRequired]` —
only applies to the OCS/web create API; `occ files_external:create` has no
such constraint, §369.)

If **`NEXTCLOUD_PROXY_HEADER_AUTH`** is on (above), the dashboard also adds
the Authelia admin to Nextcloud's `admin` group the first time their
header-authed account exists — `user_saml` has no group mapping of its own,
so without this a fresh SSO login would otherwise land as a plain user with
no Administration settings.

### ITFlow — mail + cron are automatic

ITFlow does not read mail settings or a cron toggle from the environment —
both live in its own database, normally set by hand in its own UI. The
dashboard now does this for you on every ITFlow start
(`itflowMailCron.ts`, §62.1): it copies the dashboard's global mail settings
(Settings → Email) into ITFlow's SMTP/IMAP config, and flips ITFlow's master
cron switch on (**Maintenance → Cron**, individual jobs default enabled) so
email-to-ticket, the mail queue and recurring invoices actually run. Nothing
to click through — if outgoing mail isn't sending, check **Settings → Email**
on the dashboard first, since that's what ITFlow's copy is sourced from.

Worth knowing: the container's healthcheck only probes the web server, not
cron. If cron dies the container still reports healthy while every scheduled
job stops.

### Nextcloud — mail is automatic

Nextcloud has no `mail_smtp*` environment variables either — like ITFlow,
its SMTP config lives only in its own database, normally set by hand in
**Administration settings → Basic settings**. The dashboard copies the
global mail settings (Settings → Email) into it on every Nextcloud start
(`nextcloudMail.ts`, §402), splitting the dashboard's single from-address
field into Nextcloud's separate local-part/domain config keys. No-op with
nothing configured yet — outgoing mail (share notifications, activity
digests) just doesn't send until **Settings → Email** is filled in.

## Global mail settings — who inherits them

One SMTP account is entered once in **Settings → Email**. Apps that read mail
config from their environment get it injected automatically at start (restart
the app to apply, same as exposure):

**Vaultwarden**, **BookStack**, **n8n** (user-management emails), **Paperless**
(sending only), **Vikunja**, **Kimai** (as a single DSN — §422).

None of the following read mail config from their environment — for one of
them that just means applying the settings by hand, and nothing warns you if
you don't:

- **ITFlow** and **Nextcloud** — see the notes above; both copied
  automatically into the app's own database, no environment variable
  involved.
- **Uptime Kuma** — an email alert is an SMTP *notification* created under
  **Settings → Notifications**. There is no environment variable for it.
- **Kimai** — reads SMTP from a single `MAILER_URL` DSN
  (`smtp://user:pass@host:port`). The dashboard now composes that DSN from
  the same global settings and injects it as `KIMAI_MAILER_URL` at start
  (§422), so there is nothing to set by hand — restart Kimai to apply, same
  as the others. Credentials are percent-encoded, and implicit TLS gets
  `smtps://`.

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

**Guacamole**, **Kopia** and **n8n** are `overlayOnly` (plan.md §288/§318/§344):
never on the public tunnel, reached directly on their host port over
NetBird/Tailscale with their own login only. Guacamole opens RDP/VNC/SSH to
every overlay host; Kopia can read and delete every backup; n8n runs
arbitrary code — each is one weak login away from the whole estate and has no
client-facing use, so it stays off the internet and Authelia is *not* stacked
in front (that would be a second login — §342). NPM's own admin UI and
Pi-hole are `overlayOnly` for the same reason. Guacamole's bundled
`guacamole-auth-header` extension is left off since no reverse proxy fronts it
— a forged `Remote-User` header on a directly reachable port would be an auth
bypass. (ITFlow is the opposite case: its client portal has to be public, it
has no OIDC and can't hide its own form, so it's exposed *directly* with only
its own login — dashboard-bootstrapped, §350 — rather than stacked behind
Authelia for two logins.)

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

**CrowdSec**, **Tailscale**, **NetBird's routing peer** — no login, nothing
to expose. CrowdSec generates two: `CROWDSEC_BOUNCER_KEY` for the
Cloudflare worker bouncer and `CROWDSEC_NGINX_BOUNCER_KEY` for the Lua
bouncer inside Nginx Proxy Manager, kept separate so either can be revoked
on its own (`cscli bouncers delete nginx`). Both are generated on first
start and baked into the right config file; neither is ever typed.

**Tailscale** and **NetBird's routing peer** both follow the same
two-tier pattern: a plain hand-typed credential works on its own, and
pasting in one extra genuinely-third-party credential hands the whole
thing to the dashboard from then on (§408/§405).

- `TAILSCALE_AUTH_KEY` — by hand, a reusable key from Tailscale's own
  **Settings → Keys**; `start.sh` asks for this only if you skip the OAuth
  client it offers first. With a **Tailscale OAuth client** (`auth_keys` +
  `policy_file` scopes, tagged `tag:businesslab`) pasted into
  `TAILSCALE_OAUTH_CLIENT_ID`/`TAILSCALE_OAUTH_CLIENT_SECRET` instead, the
  dashboard mints and re-mints this key itself (90 days, Tailscale's own
  max — no non-expiring option exists) and keeps Funnel enabled on the
  tailnet's ACL, both without touching Tailscale's UI again. The OAuth
  client itself doesn't expire (Tailscale's trust-credential model, unlike
  the keys it mints) — see `apps/tailscale/.env.example`.
- `NETBIRD_ROUTING_PEER_SETUP_KEY` — by hand, from NetBird's Remote
  Network Access wizard. With a **NetBird Personal Access Token**
  (Settings → Personal Access Tokens) pasted into `NETBIRD_API_TOKEN`
  instead, the dashboard creates and re-mints the network/resource/
  router/policy/setup key itself (365 days, NetBird's own max — also no
  non-expiring option). Unlike Tailscale's OAuth client, **the NetBird PAT
  itself does expire** and has no way to self-renew (NetBird's API can't
  mint one without a human already holding a session in its own UI) — see
  `apps/netbird-vpn/.env.example`.

The setup key's self-heal checks NetBird's own `valid` flag on every
`netbird-vpn` start and re-mints if it's expired or revoked (§405.2/
§405.3) — no separate expiry tracking of its own. The PAT hitting its
365-day cap has no dashboard alert today, only the logged warning
mentioned above; see the README TODO list.

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
