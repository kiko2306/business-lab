# Business Lab

**Version 0.49.8** — full history in the [changelog](/CHANGELOG.md).

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
operates their own instance. Bundled features such as scheduled social
publishing are part of the free software, not a paid add-on.

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
- Deployment guide: [/docs/deployment-guide.md](/docs/deployment-guide.md)
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
admin account. From there, every other configuration step — per-app secrets,
enabling public exposure — is done from the dashboard itself; no more manual
`.env` editing is required for the core app.

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

### Housekeeping

- [ ] **@mat: decide how Guacamole is actually meant to be reached, then
      prove SSO live if it applies** (§200, §223, §288) — turns out there is
      no NPM proxy host for Guacamole to apply the snippet to, and NPM's
      proxy listeners are loopback-only (§279), so an overlay/VPN peer can't
      reach one anyway. The two other `overlayOnly` apps (NPM's own admin
      UI, Pi-hole) are reached directly on their own port, own login, no
      Authelia — decide whether Guacamole should follow that same pattern
      (in which case the `guacamole-auth-header` wiring has no live use and
      that's fine to say) or whether it's worth building a second,
      dedicated NPM+Authelia instance just for overlay-only apps that want
      SSO (real infra, a new "exposure kind" in the backend — see §288 for
      why a LAN-bound port can't just be added to the existing NPM). A
      security-boundary/network-topology call, not a coding session.

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

- [ ] **@mat: decide whether this host's memory headroom during a full
      self-update is worth fixing at the infra level** (§131.4, §198,
      §199, §290–§299) — everything code-side about the self-update panel
      is now fixed and verified live: the Compose version-skew bug
      (§291–§293, §295), the reconciler's `restarting_frontend` coverage
      gap (§296), ~57.5GB of accumulated Docker cruft plus a prune step so
      it doesn't reaccumulate (§297), a redundant rebuild at the riskiest
      moment (§298), and — the last real gap — backend's self-replacement
      having no automatic recovery if SIGKILLed mid-swap, closed by a
      `self-update-watchdog` service running outside backend's own process
      (it structurally can't supervise its own replacement), proven live
      by `docker kill`ing the real backend and watching it recover
      unattended (§299). What's left is purely a capacity question, not a
      code one: this host still runs ~47 apps close to its 14GiB ceiling,
      and a full self-update's build+all-apps-update phase still pushes
      swap to its limit — recovery is now automatic, but repeatedly
      hitting that ceiling isn't free. Worth more RAM, or is the current
      behavior (occasional automatic recovery, ~1-2 min of downtime) fine
      to leave as is?

Memory baseline (§300 — attack the §290–§299 headroom problem by shrinking
the baseline, ~9.7 GiB container RSS on 14 GiB, swap 90% full):

- [ ] **Phase A — reclaim now (ops, no code)** (§300) — `docker rm -f
      peaceful_keldysh` (the §268 leftover); `docker buildx prune -af` +
      `image prune -af` + `network prune`; prune only *inspected* dangling
      volumes, never blind. Then, once Phase B/C give RAM headroom,
      `swapoff -a && swapon -a` to flush swap.
- [ ] **Phase B — lighter config, same apps** (§300) — one commit each:
      B1 Stirling-PDF → `latest-ultra-lite` (~970→200 MiB, verify no
      OCR/convert use); B3 Metabase heap cap — *see §301, Metabase is now a
      removal candidate*; B4 Paperless → 1 web + 1 task worker + `mem_limit`
      (~450→250 MiB); B5 Immich → cap server, stop machine-learning if smart
      search unused (−120 MiB). (B2 WAHA and B6 MSSQL dropped — both apps are
      being removed, §301.)
- [ ] **Phase C — `mem_limit` on every service** (§300) — one commit:
      tiered caps on every `apps/*/docker-compose.yml` + the management
      stack (generous on `backend` — an OOMKill mid-self-update is the §299
      failure), maybe a `services.test.ts` guard that each app declares one.
      Deploy app-by-app, watch `docker events` for `oom`.
- [ ] **@mat: Phase D decisions** (§300) — D4 ClamAV (215 MiB, irreducible):
      on-access vs scheduled scans. (D1 Postiz, D3 MSSQL folded into the §301
      removals; D2 Metabase → see the §301 Metabase question.)

Roster removals (§301 — drop the heaviest apps outright instead of tuning them):

- [ ] **Remove Postiz** (§301a) — `apps/postiz/`, the `services.ts` entry,
      docs rows, test fixtures; stop+rm the 5 `postiz-*`/`temporal*`
      containers on the host. Ends the §84 social-publishing angle (P4 was
      never built). `minor` bump.
- [ ] **Remove WAHA** (§301b) — `apps/waha/`, registry entry, docs rows
      (incl. the licences.md ⚠️ WhatsApp-ToS row), test fixtures; stop+rm
      `waha-waha-1`. `minor` bump.
- [ ] **Remove SQL Server** (§301c) — the deep one: `apps/mssql/`,
      `mssqlEula.ts`, the `/settings/mssql-eula` route + validator, the
      `x86Only`/`assertPlatformSupported` guard, the `mssql` backup engine,
      the `MSSQL_` secret-generator branch, the frontend licence panel, all
      the test cases and docs rows; stop+rm `mssql-mssql-1`+`mssql-init`,
      delete the `mssql_eula_accepted` settings row. Run `scripts/e2e-tests.sh`
      (Settings component changes). `minor` bump.
- [ ] **@mat: confirm removing Metabase** (§301d) — BI/dashboards over the
      other apps' databases; speculative, no wired use, 1.34 GiB uncapped
      JVM, AGPL. If yes: same-shape removal as 301a. If no: it gets a heap
      cap + `mem_limit` under §300 Phase B/C instead.
- [ ] **Redundancy / same-functionality pass** (§301e) — after the removals,
      survey the remaining roster for apps doing substantially the same job
      and write it up for @mat (candidates: Forgejo vs code-server, Immich vs
      Nextcloud photos, Syncthing vs Nextcloud sync, Dozzle/Beszel/Uptime-Kuma/
      Scrutiny monitoring overlap, Jellyfin vs Immich media, Miniflux vs
      Nextcloud News).

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
graph.** P1 (§255), P2 (§256), P3a (§257), P3 (§258 — `apps/postiz/` built
and proven on the real stack) are done. Phase tags below.
- [ ] **P4 — glue: `/content` drafts → Postiz** (§84.3, §261) — **parked.**
      Blocked on Postiz being exposed on the real stack *and* at least one
      Tier A social provider (Bluesky/Mastodon) connected — until then the
      queue has nothing that can send. When unblocked, build the
      human-triggered "Send to Postiz" slice first (Postiz API token in
      Settings + `postizClient.ts` + a push-draft route — §261), not the n8n
      scheduler.
- [ ] **P8 — Rebrand tier 2** (§84.2) — package/image/network/project names.
      Recreates the management stack — do it in the §83 data-root maintenance
      window, with host access, not before.
- [ ] **P9 — Per-client provisioning** (§84.5, §84.7, §202, §203) — one host is
      one deployment today; turnkey boxes need it repeatable per client. The
      list is concrete: their domain, their Cloudflare account and API
      token, their tunnel, their Authelia users, their backup destination.
      Decided (§203): whose Cloudflare account holds the domain is the
      client's own call, not ours to standardise — self-controlled (their
      own account) or contracted (a reseller-managed account) — so the
      provisioning flow must support both, with per-zone-scoped API tokens
      required either way. Lands in the setup flow.
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


- [ ] **SFTP / gdrive as non-S3 Kopia remotes** (§81.5, §194, §221, §246) —
      **parked, not scheduled.** B2 needs no new destination type: it has an
      S3-compatible API and goes through the existing `s3` kind (§246).
      SFTP (needs `known_hosts` handling) and `gdrive` (needs a GCP
      service-account JSON upload, a different UX from the "one token in
      Settings" pattern) only get built if a real deployment actually wants
      a destination that is neither a mount nor S3.
### Exposure and platform

- [ ] **CrowdSec-alert dedupe needs a real store** (§118.4a) — the Code node
      dedupes by IP within one batch, but `$getWorkflowStaticData` doesn't
      persist between executions for a CLI-imported workflow, so cross-batch
      dedupe doesn't work. Mostly moot (CrowdSec aggregates per bucket
      upstream); add a Redis-backed store only if pushes prove noisy in
      practice.
- [ ] **Wire up the "trust the proxy" knobs the §210.2 audit found** (§216,
      §217) — twelve apps ship a real, upstream-supported way to stop
      showing their own login on top of Authelia's, the same shape as the
      already-fixed Dozzle/Guacamole:
      - **Header/IP trust**: still open — File Browser (`auth.method=proxy`)
        and Home Assistant (`trusted_networks` — IP-based, weaker). The §180
        LAN-bypass blocker on these is **now cleared** (§279 closed it live:
        NPM's proxy ports are loopback-only, so there is no un-gated
        LAN-direct path to drop a login in favour of), so both are buildable.
        Done: Stirling-PDF (shipped with
        `SECURITY_ENABLELOGIN=false`), Uptime Kuma (`disableAuth` set by an
        idempotent init sidecar, §227), Paperless-ngx (`Remote-User` via
        `PAPERLESS_ENABLE_HTTP_REMOTE_USER`, §247), and **Nextcloud**
        (`user_saml` environment mode, §276 — wired, gated behind
        `NEXTCLOUD_PROXY_HEADER_AUTH` + exposure, unproven, see the @mat item
        below).
      - **OIDC against Authelia's own provider, then disable the local
        form.** Plumbing is done (§270): a service declaring `oidcClient` in
        the registry gets a confidential Authelia client registered on every
        exposure change, and its client-side OIDC config injected at start
        (env for most; a managed `immich.json` for Immich, §275).
        **Vikunja (§271/§278), Mealie (§274), Immich (§275), Homebox (§272) —
        all four proven live end to end (§280)**: button on the app's own
        login page → Authelia → callback → landed logged in, no second
        password form and (since implicit consent) no accept screen.
        NocoDB (§273) dropped (Enterprise-only SSO).
- [ ] **@mat: prove the hashed Authelia OIDC client secrets live** (§270,
      §280, §281) — `renderOidcClientsBlock` now writes `$pbkdf2-sha512$`
      digests, not plaintext (verified byte-for-byte against
      `authelia crypto hash generate/validate pbkdf2`, but not through a real
      Authelia restart). On the live box: trigger an exposure reconcile so
      the managed block rewrites, confirm Authelia restarts clean, then do a
      fresh OIDC login through each of Vikunja/Mealie/Immich/Homebox and
      confirm each still lands logged in with no `invalid_client`.

- [ ] **@mat: prove Nextcloud header-trust live** (§217, §276) — expose
      Nextcloud, apply Authelia's `authelia-authrequest.conf` snippet to its
      NPM proxy host, flip `NEXTCLOUD_PROXY_HEADER_AUTH` true (Configuration
      panel), restart Nextcloud, and confirm an Authelia login lands straight
      in with no second form (the dashboard puts `user_saml` in
      environment-variable mode on start). Then confirm
      `https://<host>/login?direct=1` still shows the normal form as the
      escape hatch. `general-uid_mapping=HTTP_REMOTE_USER` and the
      email/displayname mappings are from `user_saml` source, not a live run —
      if auto-login provisions a wrongly-named account, the `$_SERVER` key is
      off. §180 applies: decide whether the LAN-direct `:80` bypass matters
      for Nextcloud before treating header-trust as the only gate.

- [ ] **@mat: prove Beszel SSO live, then flip `DISABLE_PASSWORD_AUTH`**
      (§229, §236) — `beszelSync.ts` is built and `TRUSTED_AUTH_HEADER:
      Remote-Email` is on the `beszel` service, but unproven against the real
      proxy. Scratch-stack proof (§223 shape): provision a test dashboard
      user granted `beszel` access, confirm the PocketBase `users` record
      lands, then forge `Remote-Email` on `/api/collections/users/auth-refresh`
      (the request the two failing upstream discussions used) and confirm
      200 + a real token instead of 401. Only then add
      `DISABLE_PASSWORD_AUTH: "true"` to the compose file — flipping it
      before the header path is proven risks a lockout with no non-manual
      way back.

      Each needs its own config change and its own live proof; Nextcloud and
      Home Assistant's fixes probably also want a §180 conversation about
      whether the LAN-direct bypass matters for that specific app first.
      **BookStack** has OIDC/SAML too, but no flag to hide the local form —
      `AUTH_METHOD=oidc` only adds OIDC as an option, and a years-old
      upstream request to disable the standard form is still unimplemented.
      ITFlow, NPM's own admin UI, Pi-hole, Kopia, WAHA, n8n and NocoDB
      (Enterprise-only SSO — §273), Jellyfin (core has no header-trust, only a
      community plugin) and BookStack have no known full fix — parked, not
      blocked on anything actionable.
- [ ] **`@mat`: confirm NPM's overlay path, deprovision any live public NPM
      exposure** (§239) — `nginx-proxy-manager` is now `overlayOnly`, so the
      dashboard refuses to *enable* its exposure, but an already-provisioned
      `npm.<domain>` route isn't torn down automatically (same as `lanOnly`).
      Check whether the live host has one and toggle it off if so, and
      confirm the admin UI is reachable over NetBird/Tailscale.

### Apps and integrations

- [ ] **@mat: register Nextcloud's shared-tree mount** (§219, §224) — the
      `/shared` bind mount and `www-data` write permission are in place, but
      registering it with Nextcloud (Admin settings -> External Storage) needs
      a real interactive login — Nextcloud's create API requires a fresh
      password confirmation no API call can satisfy. Steps in
      `docs/app-credentials.md`.
- [ ] **@mat: decide Pi-hole's port-53 conflict** (§283, §284) — starting
      Pi-hole from a fresh deploy fails: `failed to bind host port
      0.0.0.0:53/tcp: address already in use`. Root cause confirmed (no
      single process to kill): `systemd-resolved` holds `127.0.0.53`/
      `127.0.0.54:53` and `netbird` holds its own tailnet IP `:53`
      (MagicDNS) — Linux refuses a wildcard `0.0.0.0:53` bind while any
      specific-address `:53` socket exists, so Pi-hole can't get the port no
      matter which one is freed unless *both* are addressed. Real fix needs
      a host-networking decision (disable `systemd-resolved`'s stub
      listener via `DNSStubListener=no`, and/or bind Pi-hole to a specific
      host IP instead of all interfaces) — left unstarted for now rather
      than done as a host-console change.
- [ ] **@mat: prove MeshCentral live with a real agent** (§62.2, §264) — the
      app is built (`apps/meshcentral/`, port `10550`, `mesh.<domain>`) and
      env-driven config is wired, but the reverse-proxy path is unproven:
      expose it, enrol a real agent, and confirm (a) no `Agent bad web cert
      hash` — i.e. `certUrl` + `tlsOffload` do their job through NPM +
      Cloudflare, and (b) whether Authelia forward-auth on `mesh.<domain>`
      blocks agent enrolment. If it does, split the agent endpoint onto its
      own un-gated hostname (or scope the authrequest snippet to exclude
      `/agent.ashx` + `/meshrelay.ashx`).
- [ ] **App backlog** — §22 lists candidate apps by category (communication,
      business ops, no-code/BI, files/PDF, security/network, dev infra,
      productivity). Pull from there rather than restating it here.
