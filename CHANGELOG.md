# Changelog

All notable changes to Business Lab are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semantic](https://semver.org/) but pre-1.0, so a **minor** bump marks a new
user-facing feature or a breaking change and a **patch** bump marks a fix or a
small internal change. `MAJOR` stays `0` until a `1.0.0` is declared
deliberately.

The version string shown in the dashboard footer lives in the repo-root
`VERSION` file, which the backend reads live (bind-mounted) and serves at
`GET /version` (plan.md §343). `scripts/bump-version.sh` writes `VERSION`,
this file, and the README line together; the `package.json` version fields
are frozen and unused.

## [0.67.0] — 2026-09-09

### Changed

- Home Assistant is exposed directly with its own login (§344/§347) — the dashboard runs HA's onboarding on start (Authelia admin username + generated HOMEASSISTANT_ADMIN_PASSWORD) and forces ip_ban_enabled in its managed http: block

## [0.66.1] — 2026-09-09

### Changed

- Park ITFlow's auto-run setup wizard (§346) — it fired before the itfloworg image finished its first-boot DB migration and locked setup with no schema; ITFlow stays behind Authelia

## [0.66.0] — 2026-09-09

### Changed

- ITFlow is exposed directly with its own login (§344/§346) — the dashboard runs its 4-step setup wizard on start with the Authelia admin email + a generated ITFLOW_ADMIN_PASSWORD

## [0.65.1] — 2026-09-09

### Changed

- Jellyfin is now lanOnly (§344) — media stays on-premises; off the tunnel and the overlay, its own login on the LAN

## [0.65.0] — 2026-09-09

### Changed

- NocoDB is exposed directly with its own login (§344) — community NocoDB has no OIDC; the dashboard seeds its super admin from NC_ADMIN_EMAIL (Authelia admin) + a generated complex NC_ADMIN_PASSWORD on boot

## [0.64.0] — 2026-09-09

### Changed

- BookStack now logs in through Authelia OIDC with its own form hidden (§344) — AUTH_METHOD=oidc + auto-initiate, admins group maps to BookStack Admin; break-glass at /login?prevent_auto_init=true

## [0.63.7] — 2026-09-09

### Changed

- ITFlow stays publicly exposed after all (§344) — its client portal needs public access; only Kopia and n8n go overlayOnly

## [0.63.6] — 2026-09-09

### Changed

- Kopia, n8n and ITFlow are now overlayOnly (§344 batch 1) — off the public tunnel, reached over the overlay with their own login, no Authelia stacked in front (§342)

## [0.63.5] — 2026-09-09

### Changed

- Verify §343 C: this bump touches only VERSION / CHANGELOG / README, so its deploy must be a bare git pull with no build, app sweep or restart

## [0.63.4] — 2026-09-09

### Changed

- Self-update only rebuilds and recreates what the git diff touched (§343 C) — a version/docs-only deploy is now a bare git pull; backend restarts only if backend code changed, apps recreate only if their own files did

## [0.63.3] — 2026-09-09

### Changed

- Version now lives in a repo-root VERSION file read live by the API (§343) — a version-only deploy needs no rebuild; bump-version.sh and the version-bump hook stop touching package.json

## [0.63.2] — 2026-09-09

### Apps

- DocuSeal: expose directly with only its own login instead of stacking Authelia in front (§342) — no app should present two login screens

## [0.63.1] — 2026-09-09

### Apps

- DocuSeal: run its first-run /setup wizard automatically on start (§341) — community edition has no SSO, so Authelia gates the hostname and the generated DOCUSEAL_ADMIN_PASSWORD account is created for you

## [0.63.0] — 2026-09-09

### Apps

- Add DocuSeal — document signing and fillable PDF forms (§22.3), single container on SQLite, auto-exposed behind Authelia

## [0.62.5] — 2026-09-09

### Fixed

- Auto-exposure now regenerates Authelia's access-control rules + OIDC clients — a newly auto-exposed app was getting an NPM host + DNS but no Authelia rule, so default-deny 403'd everyone (§331 follow-up)

## [0.62.4] — 2026-09-09

### Fixed

- Flag ClamAV `lanOnly` so auto-exposure (§331) doesn't publish a `clamav.<domain>` hostname that would proxy HTTP at the clamd protocol socket

## [0.62.3] — 2026-09-09

### Changed

- The Cloudflare token + tunnel-provisioning forms moved from the standalone /exposure page onto the Settings page (`<app-network-settings>`); the /exposure route and nav link are gone (§331 slice 4)

## [0.62.2] — 2026-09-09

### Removed

- The per-app 'Publicly expose this service' toggle from the service-card modal, the `GET /api/services/:name/exposure` endpoint, and the `apps:expose` capability — exposure is automatic (§331 slice 3)

## [0.62.1] — 2026-09-09

### Removed

- The per-app exposure API (PUT/POST `/api/services/:name/exposure`, `upsertServiceExposureConfig`) — exposure is automatic now, there is nothing to toggle (§331 slice 2)

## [0.62.0] — 2026-09-09

### Changed

- Exposure is now automatic: every app that can be exposed is exposed behind Authelia on each start and by the reconciler sweep, with no per-app opt-in (§331 slice 1)

## [0.61.1] — 2026-09-09

### Fixed

- Nextcloud header-trust: write the user_saml attribute mappings to the provider config (`occ saml:config:set 1`), not appconfig — user_saml 6.x moved them and the env-mode login failed with "IDP parameter for the UID not found"

## [0.61.0] — 2026-09-09

### Added

- Immich's first (admin) account is created automatically on an exposed start, using the Authelia admin's email, so single sign-on links to it instead of failing with "the first registered account must be the administrator"

## [0.60.1] — 2026-09-09

### Fixed

- Mealie's seed admin is auto-renamed off username `admin` on start, so an Authelia user named `admin` can sign in via OIDC without a `users.username` collision

## [0.60.0] — 2026-09-09

### Added

- First-run setup collects the webmaster's email and syncs it straight into Authelia, so the initial admin is a usable single-sign-on identity for the managed apps with no separate invite step

## [0.59.5] — 2026-09-09

### Fixed

- SSO app-access list no longer offers secondary exposure legs (`netbird-vpn:api`, `homepage:apex`); creating or editing a user with those exposed no longer 400s on the `appAccess` pattern check

## [0.59.4] — 2026-09-09

### Removed

- Beszel dropped — Uptime-Kuma kept for the status-page + alerting overlap; its user-sync path removed from the auth/users/services routes (§301e, §323)

## [0.59.3] — 2026-09-09

### Removed

- Syncthing dropped — Nextcloud already covers file sync for this roster (§301e, §322)

## [0.59.2] — 2026-09-09

### Removed

- kitchen-switcher dropped — a UI shim for a bookmark, not an app (§301e, §321)

## [0.59.1] — 2026-09-09

### Removed

- MeshCentral dropped — redundant once Guacamole reaches endpoints over the NetBird overlay (§301e, §320)

## [0.59.0] — 2026-09-09

### Changed

- Guacamole is reached directly over the overlay with its own login (like NPM admin / Pi-hole); removed the unreachable header-auth wiring and the guacamoleSync account provisioning (§318)

## [0.58.1] — 2026-09-09

### Fixed

- removedAppCleanup: delete root-owned app data via a root helper container (backend runs non-root), and match dirs by project-dir name not registry key (home-page vs homepage)

## [0.58.0] — 2026-09-09

### Added

- Removed apps are now cleaned up on boot — containers torn down (docker compose down) and the orphaned apps/<name>/ dir deleted (removedAppCleanup.ts)

## [0.57.0] — 2026-09-09

### Removed

- Forgejo removed from the project (apps/forgejo, registry entry, docs rows; ports 10560/10561 freed)

## [0.56.0] — 2026-09-09

### Added

- Navidrome — Subsonic-compatible music streaming server (apps/navidrome, port 10570)

## [0.55.0] — 2026-09-09

### Removed

- File Browser removed — upstream `filebrowser/filebrowser` was archived 2026-09-01 with no further security fixes, while holding the repo's most dangerous bind mount (host `~` read-write); the shared tree it seeded moved to `apps/nextcloud/data/shared/`, still served over SMB by Samba and watched by Paperless

## [0.54.0] — 2026-09-09

### Changed

- Stirling-PDF runs the ultra-lite image — every core PDF operation, but no bundled LibreOffice/OCR/Python runtime (~960 MiB RSS and 3.4 GB on disk down to ~200 MiB / 0.9 GB); switch back to :latest if Office-doc conversion or OCR is needed

## [0.53.0] — 2026-09-09

### Removed

- Metabase (BI dashboards over the apps' databases) removed — a speculative value-add with no wired consumer, ~1.34 GiB uncapped JVM, AGPL

## [0.52.0] — 2026-09-09

### Removed

- SQL Server (mssql) removed — the only proprietary-EULA app, carrying a large special-case surface (licence gate, x86Only guard, bespoke mssql backup engine, MSSQL_ secret branch) for one LAN-only database no client used

## [0.51.0] — 2026-09-09

### Removed

- WAHA (WhatsApp HTTP API) removed — automating WhatsApp Web breaches Meta's ToS (a non-software-terms flag in docs/licences.md), a headless-Chromium container at ~277 MiB, and nothing in the stack consumed it

## [0.50.0] — 2026-09-09

### Removed

- Postiz (social scheduling) removed from the registry and repo — heaviest stack on the host (~1.7 GiB across 5 containers), AGPL, and the §84 P4 glue it existed for was never built

## [0.49.8] — 2026-09-08

### Fixed

- Self-update panel: drop the redundant --build from the frontend/backend restart steps — the images were already built in the earlier building phase, so this cut real rebuild work at the exact point most exposed to memory pressure

## [0.49.7] — 2026-09-08

### Fixed

- Self-update panel: prune dangling images and build cache after the dashboard build and after updating every app, instead of letting reclaimable Docker cruft accumulate silently across runs

## [0.49.6] — 2026-09-08

### Features & architecture

- Fix reconcileDanglingSelfUpdateRun only recognizing a run stuck in restarting_backend: now compares the actually-running commit against any dangling run's target, closing the coverage gap that left an interrupted-earlier run stuck 'in progress' forever

## [0.49.5] — 2026-09-08

### Features & architecture

- Fix the self-update panel's build step: force the classic Docker builder instead of buildx's container-based one, which needs EXEC permission on docker-socket-proxy that's deliberately disabled

## [0.49.4] — 2026-09-08

### Exposure

- Fix the Exposure settings form's fields having no label association at all (missing for/id) — a real accessibility gap, found because it also made the fields unfindable by the E2E live-stack spec

## [0.49.3] — 2026-09-08

### Security

- Fix CORS rejecting the dashboard's own same-origin requests: recognize same-origin dynamically instead of a static allowlist that can never cover every valid hostname (LAN IP, public hostname, localhost)

## [0.49.2] — 2026-09-08

### Exposure

- Fix Authelia crash-looping when the first app's exposure is enabled on a fresh deploy: the access_control generator could emit default_policy: deny with zero rules, which Authelia itself refuses to load

## [0.49.1] — 2026-09-08

### Exposure

- Correct NPM's admin bootstrap for current releases: no fixed default account exists any more, it needs POST /api/users while GET /api/ reports setup:false — confirmed live on a throwaway NPM instance

## [0.49.0] — 2026-09-08

### Exposure

- Automate NPM's default-admin bootstrap: rotating off admin@example.com/changeme, and seeding the dashboard's Exposure settings, needs no manual step anymore

## [0.48.6] — 2026-09-08

### Security

- Authelia managed OIDC client secrets are written to configuration.yml as $pbkdf2-sha512$ digests, not plaintext (pre-empts Authelia's deprecation removal)

## [0.48.5] — 2026-09-08

### Fixed

- ensurePaperlessDropbox: tolerate a chmod EPERM when the shared drop box already exists world-writable but is owned by another container's uid — it was aborting every Paperless start

## [0.48.4] — 2026-09-08

### Changed

- Authelia OIDC: managed clients now use consent_mode implicit, so first-party apps skip the OAuth accept screen (§280)

## [0.48.3] — 2026-09-08

### Fixed

- Vikunja OIDC: register its Authelia client with token_endpoint_auth_method client_secret_basic — Vikunja authenticates to the token endpoint with HTTP Basic and has no knob to switch to POST, so the default client_secret_post gave invalid_client on the callback (proven live, §280)

## [0.48.2] — 2026-09-08

### Security

- Bind Nginx Proxy Manager's :80/:443 to loopback and point the tunnel origin at 127.0.0.1, so a LAN client can no longer send a spoofed Host header straight to NPM and skip Cloudflare (plan.md §279)

## [0.48.1] — 2026-09-07

### Fixed

- Vikunja OIDC: deliver Authelia's provider block via a managed config.yml — Vikunja won't surface a provider configured only through environment variables, so the login page showed no Authelia button (plan.md §271)

## [0.48.0] — 2026-09-07

### Apps

- Forgejo added — self-hosted Git forge with CI (apps/forgejo, port 10560, SSH git on 10561); proven live: image pulls, healthy in ~10s, /api/healthz passes

## [0.47.0] — 2026-09-07

### Apps

- Nextcloud can trust Authelia's forward-auth header (user_saml environment-variable mode), gated behind NEXTCLOUD_PROXY_HEADER_AUTH + exposure

## [0.46.0] — 2026-09-07

### Apps

- Immich logs in via Authelia OIDC — a managed immich.json config file (Immich has no OIDC env vars), written only while Immich is exposed; IMMICH_PASSWORD_LOGIN_ENABLED toggle drops the local form

## [0.45.0] — 2026-09-07

### Apps

- Mealie logs in via Authelia OIDC — first managed OIDC client to use PKCE + client_secret_basic; ALLOW_PASSWORD_LOGIN toggle drops the local form

## [0.44.0] — 2026-09-07

### Apps

- Homebox logs in via Authelia OIDC — client auto-registered on exposure, HBOX_OPTIONS_ALLOW_LOCAL_LOGIN toggle to drop the local form

## [0.43.2] — 2026-09-07

### Added

- Vikunja logs in via Authelia's OIDC provider: the dashboard registers the client and injects Vikunja's VIKUNJA_AUTH_OPENID_* config at start when it's exposed; toggle VIKUNJA_AUTH_LOCAL_ENABLED off after a first sign-in to drop Vikunja's own form (plan.md §271). Unproven against the live proxy.

## [0.43.1] — 2026-09-07

### Added

- Authelia OIDC-client plumbing: apps can declare an `oidcClient` in the registry and the dashboard registers a matching confidential client in Authelia's config on every exposure change, so they log in via Authelia instead of showing a second form (plan.md §270). No app wired yet.

## [0.43.0] — 2026-09-07

### Added

- Backup destinations: ftp/ftps kind driven by the rclone bundled in the Kopia image (Kopia has no native FTP backend) — new Settings fieldset, rclone.conf generated at start with the password obscured and FTP concurrency capped, test-connection via rclone lsd. Live proof against the test NAS blocked the same way SMB is (§267, §268); disk kind stays the proven external path.

## [0.42.1] — 2026-09-07

### Fixed

- Kopia backup source now ignores /kopia/data (its own local repository and cache) so an app-data snapshot no longer recursively swallows the repository — proven live: a snapshot dropped from a runaway 60+ GB to 3.1 GB / 50553 files, and restored byte-for-byte from a real external mount (§265, §266).

## [0.42.0] — 2026-09-07

### Added

- MeshCentral (apps/meshcentral): remote endpoint management, published as mesh.<domain>. Config is env-driven at start (image DYNAMIC_CONFIG); exposure injects the public hostname, the Docker bridge gateway into settings.tlsOffload (new exposureEnvKeys.gatewayOnExposure), and certUrl so agents pin the real public cert behind Cloudflare (§62.2).

## [0.41.1] — 2026-09-07

### Fixed

- mssql backup: the _dump dir is created by a root busybox container (the backend can't mkdir inside the uid-10001-owned data dir mssql-init sets up), and the .bak files are made world-readable so the file backup can archive them (§263f live proof).

## [0.41.0] — 2026-09-07

### Added

- SQL Server licence acceptance gate: a Settings panel shows the Microsoft EULA terms and a tick-to-accept; until accepted the backend refuses to start mssql and never writes ACCEPT_EULA=Y (§121.5, §263d).

## [0.40.2] — 2026-09-07

### Added

- SQL Server (mssql) backup engine: server-side BACKUP DATABASE writes a .bak per user database into apps/mssql/data/_dump/ for the file backup to capture, with a matching RESTORE path (§263c).

## [0.40.1] — 2026-09-07

### Changed

- Generate SQL-Server-policy-compliant SA passwords: consolidate the three secret-generation sites in appEnv.ts into one generateSecretFor() and add an MSSQL_ branch (3-of-4 char classes); also fixes APP_KEY only being special-cased on one of the three paths (§263b).

## [0.40.0] — 2026-09-07

### Added

- SQL Server Express (LAN-only) app skeleton and registry entry — x86-64-only guard in the start path, generated SA password, EULA acceptance still pending (§263a).

## [0.39.2] — 2026-09-07

### Added

- Wire Mealie's AI recipe parsing to the Settings Claude API key: the dashboard rotates Mealie's shipped admin default and configures an AI provider pointed at Anthropic's OpenAI-compat endpoint (§238).

## [0.39.1] — 2026-09-07

### Changed

- Rebrand tier 1 leftovers: the iOS home-screen title and the Apps page subtitle no longer say "Homelab" (§84.2 / §254 P7)

## [0.39.0] — 2026-09-07

### Added

- Postiz (social media scheduling) as a managed app — trimmed 5-container stack (Postiz + Postgres + Valkey + Temporal + Temporal's Postgres), AGPL-3.0 run unmodified; the §257 Temporal search-attribute blocker fixed via SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES + a health-gated depends_on (§254 P3)

## [0.38.0] — 2026-09-07

### Added

- Content page: generate a social-media post draft from a brief with the stored Claude key, then edit or delete stored drafts (§84.3 / §254 P2)

## [0.37.0] — 2026-09-07

### Added

- Settings: a Claude (Anthropic) API key field — stored once, masked on read, with a free "Test key" check against the Anthropic API; consumed by the coming content-generation and Mealie AI features (§84.3 / §254 P1)

## [0.36.2] — 2026-09-07

### Changed

- Exposure config: NPM admin API URL is now derived from the Docker bridge gateway + NPM_ADMIN_PORT on every read, not stored as hand-editable free text — a stale LAN/DHCP IP can no longer be seeded or typed in and 502 the whole tunnel (§252)

## [0.36.1] — 2026-09-06

### Changed

- Backup destination form: note that Backblaze B2 works through the existing S3-compatible kind (its S3 endpoint + key ID + application key) — no separate B2 destination type (§246)

## [0.36.0] — 2026-09-06

### Added

- Miniflux (`miniflux/miniflux`) — minimalist RSS/Atom feed reader over a companion Postgres; schema self-migrates on boot, admin created from env, no wizard (§22.8)

## [0.35.0] — 2026-09-06

### Added

- Metabase (`metabase/metabase`) — BI dashboards and questions over the stack's existing Postgres databases; own companion Postgres for app state (§22.4)

## [0.34.0] — 2026-09-06

### Added

- Syncthing (`syncthing/syncthing`) — continuous peer-to-peer folder sync; GUI via tunnel behind Authelia, sync over LAN-direct + relay pool, no router changes (§22.5)

## [0.33.0] — 2026-09-06

### Added

- IT Tools (`corentinth/it-tools`) — static offline box of developer/IT utilities, no backend or config (§22.7)

## [0.32.0] — 2026-09-06

### Added

- Scrutiny (`ghcr.io/analogj/scrutiny` omnibus) — hard-drive SMART health and failure prediction, a monitoring gap Beszel doesn't cover (§22.6); runs privileged for host-agnostic disk access

## [0.31.2] — 2026-09-06

### Security

- Tag nginx-proxy-manager `overlayOnly`: its admin UI controls all ingress + holds the TLS certs, so it's reachable over the overlay only, not the public tunnel (§210.3)

## [0.31.1] — 2026-09-06

### Added

- `overlayOnly` service flag: refuses public tunnel exposure for sensitive gateways (Guacamole, Pi-hole), which must be reached over the NetBird/Tailscale overlay (§210.3)

## [0.31.0] — 2026-09-06

### Added

- Beszel SSO account sync: dashboard users granted Beszel access are provisioned as Beszel accounts over its PocketBase API, so its TRUSTED_AUTH_HEADER path has an account to resolve (§229)

## [0.30.1] — 2026-09-04

### Roster

- Paperless's document intake now watches a shared-tree drop box instead of its own isolated consume folder

## [0.30.0] — 2026-09-04

### Added

- A Kopia-native S3-compatible backup destination (AWS S3, MinIO, B2, Wasabi, …), alongside disk/SMB/NFS

## [0.29.0] — 2026-09-04

### Changed

- **Removed the per-app "Update" button** — managed-app images no longer
  update independently per app. The only way any app's image moves now is
  as a batch step of a Business Lab self-update (`/updates`, "Update now"):
  after the dashboard's own rebuild, every installed app is pulled and
  recreated against whatever tag its compose file carries in the commit
  that `git pull` just landed, one at a time, tolerating any single app's
  failure without blocking the rest. This ties the whole stack's image
  versions to one commit of the repository instead of letting any one app
  drift ahead independently — the dev controls what "current" means by
  advancing a pin and pushing, not by clicking a per-app button.
- Removed the daily per-app "image update available" check and its
  `service_image_updates` table along with it — there is no longer a
  per-app action for it to inform, and the outdated/unknown badge is gone
  from the service card. `docker-compose.override.yml`'s image pins are
  still written and still shown ("📌 pinned"), now by the self-update batch
  instead of the old button; "Unpin" still works the same way.



### Added

- **Dashboard users are now auto-provisioned into Guacamole** (§200 slice
  3): every active account with `app-guacamole` granted (or the webmaster
  role) gets a Guacamole account, created and enabled automatically; an
  account that loses that access gets disabled, never deleted, so any
  connections/permissions set up for it by hand in Guacamole's own UI
  aren't lost. Runs on the same triggers as the existing Authelia sync
  (invitation accepted, roles/access changed, account deleted) plus
  Guacamole's own exposure changing. `guacadmin` is never touched. Note:
  this doesn't skip Guacamole's own login screen yet — that's slice 4.

## [0.27.1] — 2026-09-04

### Changed

- **Internal: `guacamoleClient.ts` gained user create/get/enable-disable**
  (§200 slice 2) — no user-facing effect yet, nothing calls it until slice 3
  wires it into an actual sync.

## [0.27.0] — 2026-09-04

### Added

- **Guacamole's shipped `guacadmin`/`guacadmin` default admin password now
  auto-rotates**, closing the gap left once it was exposed at a real
  hostname (§199): on the first successful login with the default
  credentials after a start, the backend generates a random password and
  sets it over Guacamole's own REST API — no human step, and idempotent by
  construction (a rejected default-credential login just means it already
  happened). `guacamole/guacamole` and `guacamole/guacd` are pinned to
  `1.6.0` rather than `:latest`, needed so a later SSO extension can be
  version-matched to the webapp build.

## [0.26.0] — 2026-09-04

### Changed

- **Authelia login is now mandatory by default for every exposed app**,
  instead of a per-app "Require Authelia login" toggle that defaulted off.
  The toggle is removed from the UI; the policy is now fixed (and no longer
  stored per app) via a `skipAutheliaProtection` registry flag, set only on
  the Home Page (deliberately the public front door) and Authelia itself (it
  can't forward-auth-gate its own login). The now-unused
  `service_exposure.authelia_protected` column is dropped by a startup
  migration.

## [0.25.0] — 2026-09-04

### Added

- **Dashboard self-update panel** (`plan.md` §131.4), gated to a new
  `system:update` capability (webmaster/admin only, same role model as every
  other capability). A new `/updates` page shows the running version, the
  current commit vs. `origin/main`, and how many commits behind; "Check now"
  re-fetches, "Update now" (confirm-gated) runs `git pull --ff-only` +
  `docker compose build` + `up -d --build` for `frontend` then `backend` —
  never `docker compose down`. The run survives the backend's own restart via
  a `self_update_runs` Postgres row (`state`: `checking` → `pulling` →
  `building` → `restarting_frontend` → `restarting_backend` → `done`/`error`);
  a boot-time reconciler closes out a dangling row as proof the new process
  came up. A build failure stops before anything is restarted, leaving the
  old containers running on the old code. Needs a new `REPO_ROOT`-mounted
  bind (auto-set by `start.sh`, same as `APPS_DIR`), `git` in the backend
  image, and `BUILD: 1` on `docker-socket-proxy` (the one exception to it
  never building images — every managed-app update still only pulls a
  prebuilt registry image).

## [0.24.0] — 2026-09-04

### Removed

- **Duplicati is gone; Kopia is the sole backup engine** (`plan.md` §81.5,
  §197). `apps/duplicati/`, `duplicatiClient.ts`, `backupTargetApply.ts` and
  every route/service/frontend reference are deleted. `backupScheduler` now
  gates the app-data run on Kopia directly instead of running it "alongside
  Duplicati". `GET /api/backups/status` now returns Kopia's status shape
  (`repositoryDescription`/`storageType`/`snapshotCount`/`lastSnapshotAt`/…)
  instead of Duplicati's. `POST /api/settings/backup-target/provision-job` is
  removed — Kopia registers its snapshot source itself, with no separate
  provisioning step.
- **`googledrive`/`ftp`/`ftps` backup destinations are removed** — Duplicati
  spoke those protocols directly; Kopia has no plain-FTP backend and its
  `gdrive` backend needs different credentials (a GCP service-account JSON,
  not an OAuth AuthID). Only `disk`/`smb`/`nfs` remain. A Kopia-native remote
  (S3/B2/SFTP/`gdrive`) is tracked separately in the README TODO.

## [0.23.0] — 2026-09-04

### Changed

- **The backup scheduler now snapshots Kopia alongside Duplicati**
  (`plan.md` §81.5). After the per-app database dumps, `backupScheduler`
  triggers a Kopia snapshot of `/source/apps` via a new
  `kopiaClient.snapshotAppData` (provision-if-needed + snapshot, one call,
  never throws). Runs on both the scheduled cycle and the manual "Back up
  now" button. Kopia's outcome is recorded in the `app-data` audit row's
  `kopia` metadata but does **not** gate the run — Duplicati stays the source
  of truth until it is removed. Kopia is skipped quietly when it has no
  password, and a Kopia failure never disturbs the Duplicati-gated result.

## [0.22.0] — 2026-09-04

### Changed

- **Saving a backup destination now reconfigures Kopia too**, alongside
  Duplicati (`plan.md` §81.5). `services/kopiaTargetApply.ts` translates the
  chosen destination into `apps/kopia/`'s `backup-target` volume: a mounted
  destination (disk/SMB/NFS) is used exactly as Duplicati uses it — Kopia's
  filesystem repository just sees a directory. Google Drive / FTP have no
  Kopia-native equivalent for the credentials stored here, so those leave
  Kopia on a local repository and the save response says so. `apps/kopia`'s
  `/repository` mount changed from a fixed bind to the same three-option
  templated volume Duplicati uses. `PUT /api/settings/backup-target` gains
  `kopiaRestarted` and `kopiaRepository` in its response and appends a
  `(Kopia: …)` note to `message`.

## [0.21.1] — 2026-09-04

### Added

- **`services/kopiaClient.ts`** — the client that drives the Kopia server's
  REST API, mirroring `duplicatiClient.ts` (`plan.md` §81.5, slice 2):
  `checkKopiaConnection`, `setRetentionPolicy`, `provisionBackupSource`,
  `runSnapshotNow`, `listSnapshots`, `restoreSnapshot` +
  `getRestoreTaskStatus`, and a never-throwing `getBackupSourceStatus` for a
  future schedule card. Handles Kopia's basic-auth + per-request CSRF-token
  dance (fetch `/`, scrape the `<meta>` token, replay it with the session
  cookies). Not wired into any route or the scheduler yet — that is a later
  slice; Duplicati still runs in parallel.

### Changed

- `apps/kopia/docker-compose.yml` pins `hostname: kopia` so a container
  recreate (an image update) does not orphan existing snapshots — Kopia keys
  every source by `(user, host, path)` and the host otherwise defaults to the
  container id.

## [0.21.0] — 2026-09-04

### Added

- **Kopia added as a self-configuring backup app** (`apps/kopia/`, port
  `10470`) — first slice of the Duplicati → Kopia migration (`plan.md` §81.5).
  An `entrypoint.sh` wrapper connects to the filesystem repository under
  `/repository` on start, creating it on the very first run (Kopia has no
  create-if-missing server mode), then runs `kopia server start` with `--ui`
  over plain HTTP behind basic auth. `KOPIA_PASSWORD` (repository encryption)
  and the two server passwords are generated by the dashboard via
  `autoGeneratedSecrets` — nothing typed. Registered in `services.ts` with a
  container-driven health state (the server's own basic auth 401s an
  unauthenticated probe; the compose healthcheck checks with the generated
  credentials). Not yet wired to the dashboard's backup destination or
  scheduler — those are later slices; Duplicati still runs in parallel.

## [0.20.0] — 2026-09-04

### Added

- **Periodic exposure drift reconciliation** — the backend now re-asserts
  every enabled public hostname against the live NPM + Cloudflare state on a
  ~6 h cadence (`services/exposureReconciler.ts`), the same idempotent path
  `POST /exposure/verify` runs for one app on demand. A hand-edit in NPM or a
  change made in the Cloudflare dashboard is reverted automatically; a
  hostname that can't be brought back to `provisioned` writes an
  `exposure_reconcile` failure to the audit log (the card already shows the
  `last_error`). No settings toggle — it no-ops when nothing is exposed or
  global exposure config is missing, and the first pass is delayed 10 min past
  boot to skip cold-start noise. Proven on the live stack: a clean pass over
  33 hostnames, and NPM drift on one host (wrong forward port) corrected on
  the next reconcile.

## [0.19.0] — 2026-09-04

### Added

- **Per-app backups in the dashboard** (§185 slice 4) — a "Backups" section on
  every app's Settings modal: **Back up now**, and a list of that app's local
  snapshots (timestamp, size, DB engine, any failed dumps) each with
  **Download**, **Restore** and **Delete**. Restore and Delete confirm through
  the app's in-page modal (`ConfirmService`) — no browser dialog — and Restore
  reports any warnings and refreshes the card since the app is bounced. Drives
  the slice 2–3 API; `OperationsService` gains the five calls.

## [0.18.0] — 2026-09-04

### Added

- **Per-app restore** (§185 slice 3) — `POST /api/services/:name/backup/restore`
  `{ file }`, behind `backups:manage`: stop the app, replace its `data/` from
  the archive (the live `data/db` server-DB dir is kept), replay the SQL dump
  into a freshly-started DB container (§183's `psql` / `mariadb` path), then
  bring the whole app back up. `appDumps.ts` gains `restoreServerDatabase`.
  Warnings (e.g. a failed replay) don't stop the app coming back. Proven end
  to end through the API on the live stack: n8n (Postgres) — 22 execution rows
  and the workflow name rolled back, a sentinel file gone, app healthy after;
  Vaultwarden (SQLite) — the wiped table restored from the `.sqlite` snapshot,
  sentinel gone, app healthy.

## [0.17.0] — 2026-09-04

### Added

- **Per-app backup API** (§185 slice 2) — four routes on the service resource,
  behind `backups:manage`: `POST /api/services/:name/backup` (dump + archive
  now), `GET …/backups` (list, newest first, with the manifest), `GET
  …/backups/:file` (download), `DELETE …/backups/:file`. The archive step now
  runs `tar` as **root in a throwaway alpine container** rather than in the
  backend process — the backend runs unprivileged and cannot read every app's
  data files (e.g. `valkey/dump.rdb`, Paperless index files, mode 0600), which
  a first live test against Paperless surfaced immediately. Proven through the
  authenticated API on the live stack: Postgres (Paperless) and SQLite
  (Vaultwarden) archives, download, delete, `user`-role → 403, unknown app →
  400, missing file → 404, traversal name → 422.

## [0.16.1] — 2026-09-04

### Added

- **Per-app backup foundation** (§185 slice 1, internal) — `services/appBackup.ts`:
  `backupOneApp` writes a self-contained `backups/apps/<name>/<name>-<ts>.tar.gz`
  (that app's fresh DB dump(s) + SQLite snapshot(s) + `data/`, live-DB dirs
  excluded the same way the Duplicati job excludes them) plus a manifest
  sidecar, then prunes to a per-app retention count; `listAppBackups`,
  `deleteAppBackup`, `pruneAppBackups`, path-traversal guard. `appDumps.ts`
  gains `dumpOneApp`. No routes or UI yet (slices 2–4). Proven on the live
  stack against a Postgres app (Paperless) and a SQLite app (Vaultwarden).

## [0.16.0] — 2026-09-04

### Added

- **Paperless document intake is virus-scanned against ClamAV** (§81.7) — the
  Paperless half of the roster wiring §179 started for Nextcloud. Paperless has
  no native antivirus, so the backend renders a `PAPERLESS_PRE_CONSUME_SCRIPT`
  (Python, in the image already) that streams each document to clamd's
  `INSTREAM` over TCP and aborts consumption on a `FOUND` verdict; an
  unreachable clamd fails open (exit 0), matching Nextcloud's
  `av_block_unreachable=false`. Since the base compose file can't carry that
  env var, a second dashboard-managed compose file
  (`docker-compose.managed.yml`) was added — separate from the Update button's
  image-pin override so an update can't wipe it. `clamav` added to Paperless's
  `requires`. Proven end to end on the live stack: an EICAR file is rejected
  (left in the consume dir, never imported), a clean file consumes normally,
  and with ClamAV stopped both pass.

## [0.15.1] — 2026-09-04

### Fixed

- **OnlyOffice wiring: the LAN-only fallback produced a broken config**
  (§180). §178 set `DocumentServerUrl` to the plain-HTTP gateway URL whenever
  OnlyOffice wasn't exposed — but the Nextcloud connector rejects a `http://`
  document server on an `https://` page ("HTTPS address for ONLYOFFICE Docs is
  required"). Now the gateway URL is only used when Nextcloud is *also*
  LAN-only; a public Nextcloud with an unexposed OnlyOffice wires the internal
  legs + secret, leaves `DocumentServerUrl` unset, and logs that OnlyOffice
  must be exposed. New "OnlyOffice: expose it, or keep Nextcloud LAN-only too"
  section in the webmaster runbook — including why a Cloudflare-Tunnel setup
  has no "Cloudflare IP ranges" to restrict NPM to.

## [0.15.0] — 2026-09-04

### Added

- **Nextcloud's antivirus is wired to ClamAV automatically** (§81.7, §179). On
  every Nextcloud start the backend installs + enables the `files_antivirus`
  app and points it at the ClamAV daemon (`daemon` mode, host-gateway IP +
  `CLAMAV_PORT`), via `occ` — the same throwaway-container pattern as the
  OnlyOffice connector, now factored into a shared `nextcloudOcc` helper.
  `av_infected_action=delete`; `av_block_unreachable=false` so a stopped
  ClamAV can't block all uploads (the background scan catches up), with
  `clamav` added to Nextcloud's `requires` so the dashboard still warns when
  it's down. Proven end to end — `occ files_antivirus:test` detects the EICAR
  test signature and passes a clean file.

## [0.14.0] — 2026-09-04

### Added

- **Nextcloud is wired to OnlyOffice automatically** (§81.4, §178). On every
  Nextcloud start the backend installs and enables the `onlyoffice` connector
  and points it at the document server via `occ` inside a throwaway
  `docker compose run` container — the same no-console-step pattern HACS uses.
  It sets the browser-facing URL (OnlyOffice's public hostname when exposed,
  else the host-gateway URL), the internal server-to-server URL
  (`http://<gateway>:<port>/`), the callback/storage URL, and the shared JWT
  secret (read from OnlyOffice's generated `.env`, passed through the
  environment so it never hits `ps` or the log). Idempotent; never blocks the
  start. Proven end to end — `occ onlyoffice:documentserver --check` reports
  the document server successfully connected.

## [0.13.0] — 2026-09-04

### Changed

- **The Update button now does the full job** (§131.4, §176). It still pulls
  and recreates, but the pull now runs under a shared maintenance lock so it
  can never land mid-backup-dump (and vice-versa — a scheduled dump waits for
  a running update), and afterwards it records the exact digest of every image
  it pulled into a dashboard-managed `apps/<name>/docker-compose.override.yml`.
  A fresh clone then recreates the same containers instead of whatever the
  tags point at that day. Every `docker compose` invocation now passes that
  override as a second `-f`. A **📌 pinned** marker and an **Unpin** button on
  the app card clear the pins (`POST /api/services/:name/update/unpin`) and
  drop the app back to its compose-file tags. Compose files stay read-only to
  the backend — the override is a generated file, like `.env`.

## [0.12.0] — 2026-09-03

### Added

- **FTP / FTPS backup destinations** (§131.4) — pick FTP or FTPS on the
  Settings page alongside disk/SMB/NFS/Google Drive. Like Google Drive it is
  a Duplicati-backend destination (no mount): the dashboard builds an
  `aftp://` target URL and **Test destination** verifies it through Duplicati
  itself. Reuses the SMB/NFS fields — server (`host` or `host:port`), remote
  directory, username, password. Verified against a real Duplicati that the
  URL is parsed, connects and authenticates; a completed transfer still needs
  a production-like FTP server (the "prove a non-Drive destination" item).

## [0.11.1] — 2026-09-03

### Fixed

- **Health checks** — a running service that publishes no host port and
  declares no `hostNetworkPort` is no longer probed at an address nothing
  listens on and marked unhealthy; the check is skipped (with a warning) and
  the service keeps its running-is-healthy default. No registry app hits this
  today — it guards a future portless one (§170).

## [0.11.0] — 2026-09-03

### Added

- **Samba** — a LAN-only SMB file share as a managed app (`apps/samba/`,
  §131.5). Windows-reachable on port 445 (a documented sub-10000 pin, like
  Pi-hole's 53); the dashboard generates the account password and renders the
  share definition to `data/smb.conf` before every start
  (`backend/src/services/sambaConfig.ts`), so there is no hand-edited config.
  A new `lanOnly` flag on the service registry keeps a non-HTTP app that
  publishes a port from being offered for public exposure — SMB never goes
  through the Cloudflare Tunnel. No Home Page tile (it is never "running and
  exposed"). Rows added to `docs/ports.md`, `docs/app-credentials.md` and
  `docs/licences.md` (Samba GPL-3.0, `dockurr/samba` wrapper MIT).

## [0.10.1] — 2026-09-03

### Added

- The invite flow's UI (§158, slice 158b — frontend). The Add-user form drops
  the password field, warns (with a link to Settings) when the mailbox isn't
  configured, and its button now reads "Create user & send invite". A new
  public **`/set-password?token=…`** page validates the link, takes a
  password, activates the account and signs in. The Users list shows a
  **"Pending invite"** badge on inactive rows with a **"Resend invite"**
  action (and hides "Reset password" until the account is active). Settings →
  General gains a **Dashboard URL** field (shows the effective value, blank
  falls back to the derived guess).

## [0.10.0] — 2026-09-03

### Changed

- Dashboard-created accounts are now **invited by email**, not given a
  password by their creator (§158, slice 158a — backend). `POST /api/users`
  drops the `password` field and now requires `email`, a configured mailbox
  and a dashboard URL; it creates the account **inactive** (`password_hash`
  is now nullable) and emails a single-use, 72-hour set-password link. New
  public `GET`/`POST /api/auth/invitation/:token` (view / redeem — redeeming
  activates the account and returns a session) and
  `POST /api/users/:id/invitation/resend`. The users list reports `active`.
  Login refuses an un-activated account with a clear message. `/setup` and
  `./start.sh recover` still set a password directly. New `nodemailer`
  dependency (the repo had only a connection tester); a **Dashboard URL**
  setting feeds the link, pre-filled from the exposure base domain.

## [0.9.5] — 2026-09-03

### Added

- Authelia `access_control` generation (§151, slice 2d — closes slice 2).
  The dashboard now writes a marker-delimited block into
  `apps/authelia/config/configuration.yml`: `default_policy: deny` plus one
  `one_factor` rule per exposed + Authelia-protected app, each admitting
  `group:admins` (a webmaster) or `group:app-<name>` (a granted user), and a
  `bypass` for Authelia's own portal. An app with no rule is unreachable. It
  regenerates whenever exposure or the Authelia flag changes (the
  `PUT /services/:name/exposure` path) and restarts Authelia when the block
  moved. `configuration.yml` is now gitignored and seeded from a fail-closed
  `configuration.yml.example` by `start.sh`, like `users_database.yml`.

## [0.9.4] — 2026-09-03

### Added

- Authelia users-file sync (§151, slice 2c). The dashboard now owns
  `apps/authelia/config/users_database.yml`: every managed account with an
  email is written as an Authelia user, its bcrypt password hash copied from
  the dashboard account verbatim, and its groups derived from the SSO
  app-access list — `admins` + every `app-<name>` for a webmaster, the granted
  `app-<name>` groups (plus any the app declares) for everyone else. The sync
  runs best-effort after every create / access change / password reset / role
  change / delete and from `./start.sh recover`; a failure is surfaced as a
  `warning` on the response, never rolled back. Authelia's file backend is now
  configured with `watch: true`, so it reloads the file with no restart. The
  rebuild never writes an empty user list (that would lock every gated app
  out). Access-control rules per app are still to come (slice 2d).

## [0.9.3] — 2026-09-03

### Added

- The Access UI on the Users & roles page (§151, slice 2b). The create form
  gains a required **Email** field and an **SSO app access** checkbox list
  built from `GET /api/users/app-access-options` — each app shows its
  hostname and a badge for any Authelia group the grant implies. Each account
  row gains an **Email** column and an **Edit access** action that expands to
  an email field + the same app checkboxes, saved via `PUT
  /api/users/:id/access`. Still no Authelia write — that is slices 2c/2d.

## [0.9.2] — 2026-09-03

### Added

- Data model + API for per-user email and the SSO app-access list (§151,
  slice 2a). New `users.email` column and `user_app_access` allowlist table;
  an optional `autheliaGroups` field on the service registry. `GET
  /api/users/app-access-options` lists the apps an account can be granted —
  those currently exposed and Authelia-protected, Authelia excluded. `POST
  /api/users` accepts `email` and `appAccess`; new `PUT /api/users/:id/access`
  replaces an account's email + app list. The users list now carries both.
  Nothing is written into Authelia yet — that is slices 2c/2d.

## [0.9.1] — 2026-09-03

### Added

- The per-admin **Features** editor on the Users & roles page (§152, slice
  152b). When an account is an admin (and not a webmaster), the create form
  and its row show a checkbox per dashboard capability — start/stop apps, app
  config, exposure toggle, exposure settings, backups, settings, audit log,
  users & roles — pre-ticked from what the account currently holds, with an
  inline "Save features" that appears when the set changes. All on by default;
  an admin must keep at least one.

## [0.9.0] — 2026-09-03

### Changed

- Reshaped the role model to **webmaster / admin / user** (§152, backend
  slice 152a). `/setup` and `./start.sh recover` now create/restore a
  **webmaster** — every capability, always, never restrictable. **admin** is
  full by default but a webmaster can switch individual dashboard features off
  per account (new `user_capabilities` grant table; no rows means all-on).
  **user** is unchanged. `owner` and `it_admin` are gone: a startup migration
  renames `owner` → `webmaster` and `it_admin` → `admin` (seeding the six
  features the old it_admin role granted so migrated admins keep exactly their
  reach). New `PUT /api/users/:id/capabilities`; `/api/users` and the auth
  responses now carry each account's effective capability set. The "last
  owner" guards are now "last webmaster".

## [0.8.0] — 2026-09-03

### Added

- Named roles that gate the dashboard (§131.3 / §150). Four roles —
  **owner**, **it_admin**, **webmaster**, **user** — held in a new `user_roles`
  join table (a user may hold several; capabilities are the union). Every
  existing account is migrated to `owner`. The API enforces a capability per
  route (`requireCapability`); the frontend hides nav entries and the menu
  tiles a role can't reach, and route guards bounce a typed-in URL. The Users
  page gains a role column and a per-account role editor, and the create form
  now requires picking at least one role. `GET /api/auth/me` returns the
  caller's roles and capabilities; `./start.sh recover` restores the `owner`
  role alongside the password.

## [0.7.0] — 2026-09-03

### Added

- A CPU / RAM / disk read-out in the shell header (§147.2), polling
  `GET /api/health` every 30s and colour-coding each meter on the thresholds
  the API reports. `GET /api/health` now also returns `cpu.percentUsed` —
  non-idle CPU time since the previous poll (or a short inline sample when
  polls are close together); it does not feed the `status` field.

### Changed

- The dark theme is now Tailwind's `slate` ramp (§147.1) — the same palette
  gethomepage runs on the Home Page — so the dashboard and the Home Page read
  as one product. The page background matches gethomepage's exactly
  (`#1e293b`), with card panels lifted one step above it; a blue accent stays
  for buttons and active states.

## [0.6.0] — 2026-09-03

### Changed

- Utils moved onto its own `/utils` route (§131.1 slice 6), taking the Health
  checks panel with it — both are stack-wide operational tools. This was the
  last content on `/dashboard`, so the Dashboard route, its nav button and
  `DashboardComponent` are **removed**. Every dashboard area is now its own
  route; the post-login menu is the only landing page.

## [0.5.0] — 2026-09-03

### Changed

- Settings moved off the Dashboard onto its own `/settings` route (§131.1
  slice 5). The `settings-panel` component became the `SettingsComponent` page
  (`pages/settings/`), with a "Settings" nav button and the Home menu tile
  repointed. Same four panels (General, ntfy alerts, email, backup
  destination), no API change. The Dashboard route now holds only Health
  checks and Utils.

## [0.4.0] — 2026-09-03

### Changed

- Exposure & networking moved off the Settings stack onto its own `/exposure`
  route (§131.1 slice 4). The Cloudflare Tunnel token and the first-start
  exposure-provisioning form (base domain, tunnel/zone IDs, Nginx Proxy
  Manager credentials) are now an `ExposureComponent`, with an "Exposure" nav
  button and the Home menu tile repointed at it. Same forms, no API change.
  Settings keeps General, ntfy alerts, email and the backup destination.

## [0.3.1] — 2026-09-03

### Changed

- Dark-theme polish pass (§141). `--bs-secondary-color` lifted from `#9aa4b4`
  into the slate-200/300 range so `.text-body-secondary` (card subtitles, menu
  descriptions, the header's "Signed in as …") reads against the near-black
  canvas; headings and panel titles now resolve to pure white.
- The post-login menu is a bento grid — Apps, Backups and Account security span
  two columns, on a fixed row height so every card body lines up. The
  "Opens in …" badge moved to each tile's top-right corner instead of a
  bottom-aligned slot that left a void on short tiles.
- The shell nav is plain text links with a solid borderless pill on the active
  route, replacing the row of fixed-width outlined buttons.

## [0.3.0] — 2026-09-03

### Changed

- Backups & restore moved off the one-page dashboard onto its own `/backups`
  route (§131.1 slice 3), with a "Backups" nav button in the shell header and
  the Home menu tile repointed at it. The schedule, "Back up now", the
  Duplicati status line and the archive list are unchanged — same components,
  no API change. The dashboard now carries only Settings, Health checks and
  Utils.

## [0.2.1] — 2026-09-03

### Changed

- OnlyOffice no longer gets a Home Page tile. Its public exposure exists only
  so a remote browser can load the editor Nextcloud embeds — it is
  infrastructure, not a destination. A `hideFromHomePage` registry flag
  (`services.ts`) suppresses the tile while keeping the app running and
  exposed; the mandatory `homepage.*` labels are unaffected (plan.md §131.2).

## [0.2.0] — 2026-09-03

### Added

- **Apps** is now its own route (`/apps`), split off the single-page
  dashboard: service summary, the running-apps table, and the full
  start/stop/configure list. What remains at `/dashboard` is the stack-wide
  areas (plan.md §131.1).
- A reusable collapsible **panel** (`<app-panel>`): title, one-line subtitle,
  and a body that starts collapsed. Every data section on every page —
  Apps, Dashboard (Backups / Health / Utils), the six Settings sections,
  Users, Audit logs, Account security — is now one of these.
- An in-app **confirm dialog** (`ConfirmService`) replacing the browser's
  `window.confirm()` for the restore-backup and delete-user actions.
- A dark theme (Bootstrap 5.3 `data-bs-theme`) with a project palette and
  `--app-*` surface tokens; every card shares one background and a raised
  shadow.
- A `.table-stack` utility that collapses wide tables to a card per row below
  the `md` breakpoint, so no table scrolls sideways on a phone.

### Changed

- Dates render as `dd/MM/yyyy` (with `HH:mm` where the time matters).
- The post-login menu uses a fixed 3-column grid; header nav buttons are all
  one width.
- `setup` and `recovery` now return to `/home` rather than the (now partial)
  `/dashboard`.

## [0.1.0] — 2026-09-03

### Added

- A post-login menu page and a shared app shell (one header and footer around
  every signed-in page). Signing in now lands on the menu; each area is
  reachable from the header nav or a menu tile (plan.md §131.1).

### Changed

- The dashboard's own header and footer moved into the shared shell, so the
  version string and navigation are the same on every page. The per-page
  "Back to dashboard" buttons are gone — the header nav replaces them.

## [0.0.1] — 2026-09-03

### Added

- A version string in the dashboard footer (`Business Lab v0.0.1`), served
  from the backend at `GET /version` so it reflects what is actually running
  rather than what the frontend was built with (plan.md §131.4).
- This changelog. Earlier history lives in `plan.md`'s numbered sections and
  `git log`; `0.0.1` is the first tagged point, not the first change.
