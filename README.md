# Business Lab

**Version 0.135.0** — full history in the [changelog](/CHANGELOG.md).

Business Lab (repository `business-lab`) is a Dockerized Angular + Node.js (TypeScript)/PostgreSQL system for operating homelab services with authenticated start/stop controls, audit logs, health checks, backup/restore, and recovery mode.

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
operates their own instance. Bundled features such as document management
and OCR are part of the free software, not a paid add-on.

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
- Deployment guide — provisioning a box for a client, first run to hand-over: [/docs/deployment-guide.md](/docs/deployment-guide.md)
- Turnkey build spec — hardware, disk partitioning, the default small-office app profile: [/docs/turnkey-build-spec.md](/docs/turnkey-build-spec.md)
- Data protection position — controller vs processor, backup key custody, the DR promise: [/docs/data-protection-position.md](/docs/data-protection-position.md)
- Commercial plan — pricing structure, onboarding timeline, support model: [/docs/commercial-plan.md](/docs/commercial-plan.md)
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
admin account. From there, per-app secrets are entered in the dashboard; no
more manual `.env` editing is required for the core app. Every app that can be
exposed is published behind Authelia automatically on its next start — there
is no per-app exposure step.

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

### Backups


### Exposure and platform

- [ ] **Self-update panel: richer progress detail — which image, which app,
      a real "checking" phase** — plan in plan.md §617. Today's progress
      line is one flat phrase per `SelfUpdateRunState` (e.g. "Building the
      images that changed…") with no sub-state. Add a nullable
      `self_update_runs.detail` column and: report which target
      (`frontend`/`backend`) is building, one `docker compose build
      <target>` call at a time instead of one combined call; report which
      app (name + index/total) `updateAllInstalledApps` is currently
      pulling/recreating, via a new `onProgress` callback; and make the
      pre-trigger `git fetch` (`checkForUpdate()` inside
      `triggerSelfUpdate`) run *after* the run row is inserted, so a
      slow/unreachable remote shows as a real, visible `checking` state
      (and lands as an `error` row on failure) instead of stalling the
      trigger request with no row and no visible state at all.
- [ ] **Vikunja silent SSO: confirm a live Authelia session actually skips
      the login page** — code built and proven at the HTTP level in plan.md
      §572 (NPM's `location = /` block confirmed rendered; anonymous curl
      shows the redirect chain lands on Authelia's real login with no loop,
      and deep links / `/api/v1/...` are unaffected). What's left needs a
      real logged-in browser: with a live Authelia session, visiting bare
      `https://vikunja.tx-home-utils.com/` should land straight in the app
      with no visible login page, and a reload of that same URL shouldn't
      loop. Confirm before merging to `main`.
- [ ] **NetBird Android client blocks all non-NetBird traffic once connected**
      — matches upstream
      [netbirdio/android-client#96](https://github.com/netbirdio/android-client/issues/96),
      open/unfixed. Our server-side routes are correctly scoped (two `/24` LAN
      resources, no exit node), so this is the mobile app itself, not this
      repo's config. Check that issue periodically; delete this item once it's
      closed upstream (or once an app update fixes it for us, whichever comes
      first). Last checked 2026-09-23: still open.
- [ ] **Re-enable the CrowdSec Cloudflare Worker bouncer once its token bug is
      fixed** — the edge-level bouncer (`cloudflare-worker-bouncer` in
      `apps/crowdsec/docker-compose.yml`, behind the `edge-bouncer` compose
      profile) would drop flagged IPs at the Cloudflare edge, further
      upstream than the NPM Lua bouncer currently enforcing bans (plan.md
      §567's #3, §23.17) — but as of v0.0.18 it crash-loops
      ("Authentication error (10000)") against Cloudflare API tokens with the
      newer `cfut_` prefix, even with full Workers/KV/Routes scope (verified
      via curl). Its config is already rendered on every start
      (`services/crowdsecConfig.ts`), so re-enabling it is just
      `docker compose --profile edge-bouncer up -d` once a classic token
      works or upstream fixes the auth path. Check periodically; delete this
      item once it's fixed and the bouncer is confirmed enforcing live. Last
      checked 2026-09-23: latest release is still v0.0.18, and no upstream
      issue names the 10000 auth error.
- [ ] **MeshCentral: prove real agent enrolment through the public tunnel**
      — the app is up, reachable at its own hostname with no Authelia gate,
      and its own login page confirmed live (§505/§506), but the actual
      point of re-adding it is agents on machines that aren't ours, dialing
      in over Cloudflare + NPM rather than the overlay. Needs a real second
      device (VM or spare machine) to install the agent on and confirm: the
      cert path holds (`REVERSE_PROXY`/`certUrl` — MeshCentral's documented
      fix for "Agent bad web cert hash" behind a proxy that isn't
      MeshCentral's own TLS) and a KVM/terminal session actually relays over
      WebSocket without WebRTC. Nothing here can be proven from the
      dashboard host alone.

- [ ] **Orphaned `homelab.tx-home-utils.com` in Cloudflare — needs manual
      cleanup** — investigated in plan.md §556. Not tracked by any
      `service_exposure` row (confirmed via a direct DB query — 38 rows, none
      named `homelab`/`businesslab`); the dashboard's own hostname should be
      `businesslab.tx-home-utils.com` by default (`DEFAULT_DASHBOARD_SUBDOMAIN`,
      and the live `dashboard_url` setting is empty). Most likely a leftover
      Cloudflare DNS/Tunnel route from before this project's rename (the
      working directory is still `homelab-management`). Needs a human to open
      the Cloudflare Zero Trust dashboard, confirm it's unused, and delete it
      there — not something backend code can safely detect-and-remove on its
      own with no `service_exposure` row to key off.

- [ ] **Host OS timezone should follow Settings > General's timezone** —
      today changing it only sets the `TZ` env override injected into
      managed containers (`generalSettings.ts`/`executor.ts`); it never
      touches the real host clock. Plan in plan.md §608: a small core
      `pid: host` + `privileged` sidecar (same trust precedent as Scrutiny,
      §240/§446) polling `app_timezone` and running
      `nsenter -t 1 -m -u -n -i -- timedatectl set-timezone <tz>` when it
      drifts from the host's current zone — mirrors
      `self-update-watchdog`'s polling shape since the backend has no
      `docker exec` path to trigger it directly. Needs a beta test once
      built: change the timezone in Settings, confirm `timedatectl status`
      on the host actually flips.

- [ ] **Beta-test the ntfy panel regrouping (§609/§615)** — one grouped row
      per category (switch + topic + Test) replaced the old shared-default-topic
      + single CrowdSec switch + separate Enforcement switch. On `beta`: open
      Settings → ntfy alerts and confirm all four rows show a real topic (the
      one-time migration should have backfilled any category that was
      relying on the old shared default, not silently reset it to
      `homelab-alerts`); toggle a switch and confirm Test greys out when off;
      confirm CrowdSec bans are still enforced at Nginx Proxy Manager (a
      banned IP still gets a 403) even though its switch is gone from
      Settings.

- [ ] **Beta-test the new subscriber list endpoints (plan.md §616)** — on
      `beta`: submit a real email to `POST /api/subscribers` (a plain form
      POST, e.g. via curl `-d`) and confirm a row lands in
      `advert_subscribers` with a token; confirm a `redirect` field bounces
      the response there, and its absence serves the built-in confirmation
      HTML; open `/unsubscribe/<that token>` in a browser and confirm it
      shows success and the row's `unsubscribed_at` is set; hit the same
      link again and confirm it still succeeds instead of erroring.

- [ ] **Wire the social-drafts publish path to the new subscriber list** —
      the recipient-list prerequisite (`advert_subscribers` table, public
      subscribe/unsubscribe endpoints, `UnsubscribeComponent`) is built
      (plan.md §616). Still open: `POST /api/social/drafts/:id/publish`
      reading a draft and sending it via `utils/mailSend.ts`'s `sendMail()`
      (already used for invites, §158) — one message per row from
      `listActiveSubscribers()`, each with `{baseUrl}/unsubscribe/{token}`
      in its footer. No n8n workflow needed — §611's n8n angle is
      superseded for plain email. Slice 2 (social-platform posting) still
      needs a per-platform token/OAuth setup and is scoped only once a
      specific platform is named.

- [ ] **"Claude API key" → multi-provider "AI API Keys"** — plan in
      plan.md §610. Today it's one Anthropic-only key
      (`claudeSettings.ts`) used by social-post generation
      (`claudeGenerate.ts`, native Anthropic SDK) and Mealie's AI recipe
      parser (`mealieAiSync.ts`, already via Anthropic's OpenAI-compatible
      endpoint). Plan: a small provider registry seeded with Anthropic,
      Google Gemini and Groq (both real free tiers, both OpenAI-compatible
      endpoints), one settings row per provider
      (`ai_api_key_<provider>`, migrated from `claude_api_key`), a grouped
      key+Test row per provider in the renamed panel, and a shared
      OpenAI-compat call helper used by both consumers instead of
      Anthropic-specific code. §610 flags that this keeps one
      active-provider-per-feature choice in Settings rather than adding a
      per-request provider picker — confirm that's the intent before
      building.

### Wintouch rebuilds — `check-in`, `pulse`, `tally`

Names are settled (plan.md §625): **`check-in`** (guest online check-in),
**`pulse`** (post-stay guest feedback, the old "quiz"), and **`tally`**
(invoices, employees and payments control, the old PBordo).

Target architecture is agreed and recorded in plan.md §623: Angular frontends,
Node/TypeScript/Express APIs, and .NET Windows services for the on-premise
agents only. The hotel side is `hotel-core` (owns units, guests and
reservations, and is the only service its agent talks to), `check-in`, `pulse`,
one `hotel-admin` Angular shell over all three, and a shared database
container. `tally` is an agent plus a single API + frontend. All of them land
as dashboard-managed apps under `apps/`.

**One box, one client is a requirement, not a side effect.** Every multi-client
construct in these projects is removed; plan.md §624 is the inventory. Hotel
Utils has no tenancy inside the app at all, so removal there is simply not
porting the deploy scripts. PBordo threads a `domain` layer through its store,
every API route, the SPA's landing page and the agent's config — removing that
is real design work. Multiplicity *within* a client stays: hotel `units` and
PBordo `stores` remain ordinary rows.

Remaining decisions were taken in plan.md §629: Authelia is the admin identity,
the agents read Wintouch over SQL but write through its own assemblies, only
feedback responses and check-in history migrate (everything else re-syncs), all
three half-built legacy features are in scope, each app owns its SMTP sender,
guest text stays per-client editable, and **`tally` is built first** — it is
smaller and proves agent enrolment and the tunnel WebSocket on a cheap surface.
App code follows `apps/price-compare/app/`: one source dir per service with its
own Dockerfile, tests and CI job.

The `sample/` copies stay reference-only. Per-slice scope is still proposed
before anything is built.

- [ ] **Build `check-in` + `pulse` + `hotel-core` (migrate `sample/hotel`)** — how the
      existing system works is in plan.md §620. The migration has to carry
      over: the four sync jobs and their direction (units, guests and
      reservations push out of Wintouch; completed check-ins are the only
      write back in, including the `observacoes` stamp reception reads), the
      `exportado` watermark on `wgcterceiros` that makes the guest sync
      incremental, the check-in and quiz email schedules with their per-unit
      offsets and active flags, the guest-facing check-in form covering every
      occupant, and the 15-minute agent-down alert. Decide before building:
      whether to keep the per-client-instance model at all (`setup/` and
      `trigenius/` have already drifted 135 entries apart, which is what
      `update-clients.sh` exists to fight), and what replaces
      `GET /api/config` handing out the Wintouch credentials to anyone who
      asks. The dormant check-out/payment half (`CheckOut.cs`, night audit,
      invoice/payment DAOs) is in-scope only if online payment is wanted —
      confirm either way rather than porting it by default.
- [ ] **Strip `tally`'s inherited `domain` tenant layer** — inventory in plan.md §624.
      One box serves one client, so the domain layer goes: `data/<domain>.json`
      and the `Domain` aggregate, the `:domain` segment on every store route,
      `POST /login/domain` and its domain-password gate,
      `DomainSelectionComponent` as the landing route, `/cli/:domain`,
      `domain.service.ts` and the `domain` threaded through the other three
      Angular services, and `<domain>` in the agent's `pbordo.config`. The API
      becomes `/stores/:store/overview` and the SPA opens on login. Keep
      `stores` and each user's `access[]` — those are multiplicity within one
      client, not tenancy. Do this as part of the `tally` build below, not
      as a port-then-strip.
- [ ] **Build `tally` (migrate `sample/pbordo`)** — how the
      existing system works is in plan.md §622. The migration has to carry
      over: the pull-on-demand model (the cloud holds no business data and
      proxies live to each shop), per-user store access lists, and the
      dashboard's actual figures — note `DAO.cs` wraps 20 SQL queries while
      only four endpoints are reachable, so `total_day`, `tables_list`,
      `clients_present_count` and `total_week_comp` are an inventory of what
      the panel was once meant to show and worth confirming against what is
      wanted now. Decide before building: what replaces each shop exposing an
      unauthenticated plaintext HTTP port on its public IP, and what replaces
      the 30-second ipify/`set_ip` dynamic-DNS loop — an outbound tunnel from
      the shop would remove both problems at once. Also: real sessions
      (there are none today), hashed passwords, a store for the domain/user
      data that isn't a lock-free JSON file, and a per-shop agent URL that
      isn't compiled into the binary.
- [ ] **Build agent enrolment: code → long-lived token** — designed in
      plan.md §627. An admin adds the unit/store in the UI and gets a
      short-lived single-use enrolment code; the installer asks only for the
      API URL and that code; the agent exchanges it on first start for a
      non-expiring token bound to that unit/store and stores it with Windows
      DPAPI (`ProtectedData`, machine scope) under `ProgramData`, not in
      plaintext beside the executable. Needs: the code/token tables and
      exchange endpoint in `hotel-core` and `tally`, the issue-and-revoke UI,
      per-agent last-seen replacing the legacy single-row `conn_logs`, and
      revocation proven to 401 a running agent.
- [ ] **Make the agents outbound-only** — plan.md §627. No agent listens.
      This is what removes the open inbound port at every shop, the 30-second
      `api.ipify.org` → `set_ip` loop, the `store.ip` column and the
      "is the shop online" ping hack — and means the client never touches
      their router. The hotel agent uses outbound HTTPS with a bearer token;
      `tally`'s uses one persistent outbound WebSocket authenticated with the
      same token at handshake, with the API keeping a registry of connected
      agents by store. Confirm WebSockets survive the Cloudflare Tunnel hop
      on a real deployment before committing to it — that is the one leg of
      this design that cannot be proven locally.
- [ ] **Remove `GET /api/config` and get Wintouch credentials locally** —
      plan.md §627. No credential travels cloud → agent. The hotel agent reads
      them from the local Wintouch install the way `tally` already does
      (§622); where it needs a Wintouch *application* user rather than the SQL
      login, that is one install-time prompt, entered locally and never
      transmitted. Also drop `<domain>` and `<store name>` from the agent
      config — the enrolment code binds the agent to its store, so both are
      derived — and stop compiling the API URL into the binary (§622).
- [ ] **Add a per-exposure Authelia policy to `additionalExposures`** —
      plan.md §628. Authelia policy is a per-app property today
      (`skipAutheliaProtection` / `autheliaBypassPaths` on the
      `ServiceDefinition`, applied by `renderAccessControl` to every hostname
      the app owns), so one app cannot hold both a public and a gated
      hostname. `apps/hotel/` needs exactly that: `hotel.<domain>` gated,
      `hotel-checkin.<domain>` and `hotel-pulse.<domain>` public. Add an
      optional per-entry policy field to `additionalExposures` — which already
      carries `suffix`, `label`, `portEnvVar`, `grpc` and `apex`, and already
      gets its own `service_exposure` row and hostname — and honour it in
      `renderAccessControl`. Keep bypass rules emitted before the
      `one_factor` rule; Authelia takes the first match. Backend change to the
      dashboard itself, so it needs `services.test.ts` and
      `autheliaAccessControl.test.ts` coverage and a version bump.
- [ ] **Use random (v4) identifiers for every capability URL** — plan.md §628.
      The guest check-in and feedback pages are wholly public, so the uuid in
      `/checkin/:uuid` *is* the authorisation. That only holds if it cannot be
      guessed, and the legacy code is not uniformly safe: `tally`'s
      `storeClass.js` uses **uuid v1**, which encodes a timestamp and MAC
      address. Every capability identifier in the rebuilds is random — a
      correctness requirement, not a preference.
- [ ] **Set up the shared frontend theme every app builds against** —
      plan.md §626. `frontend/src/styles.css` (Bootstrap 5.3, `data-bs-theme`
      dark mode, the `--app-canvas`/`--app-surface`/`--app-surface-raised`
      tokens and the `.table-stack` responsive-table pattern) becomes a single
      shared source every app's build references — `hotel-admin`, `check-in`,
      `pulse` and `tally` — **not** a copy per app,
      which is the drift that put 135 entries between `setup/` and
      `trigenius/`. Decide the mechanism (relative path from each app's
      `angular.json`, or a workspace package) and confirm a theme change lands
      in every app without touching them individually. `hotel-admin` and
      `tally` take the theme as-is; `check-in` and `pulse` keep per-client logo
      and colours on guest-facing pages, so the legacy `styles`/logo config
      survives in reduced form for those two only.
- [ ] **Build the guest-text template store** — plan.md §629. Admin UI uses
      the dashboard's `TranslatePipe` with static `en`/`pt-pt` files; guest
      emails and pages keep DB-backed per-client, per-language templates, so
      the legacy `translations` table survives in reduced form covering only
      guest-facing strings. Same admin/guest split as the styling decision.
- [ ] **Give each app its own SMTP config and sender** — plan.md §629. `hotel`
      and `tally` each hold their own SMTP settings and From address rather
      than reusing the dashboard's shared mailbox, so guest mail arrives from
      the hotel. Needs a small config panel per app. Note the dashboard's
      `sendMail()` is plain-text only and these are HTML messages with an
      embedded logo, so it is not reusable as-is either way.
- [ ] **Map Authelia identity to per-unit / per-store access** — plan.md §629.
      Authelia is the admin identity; the apps keep no accounts of their own
      and trust its forwarded identity. The legacy `users`, `unit_user` and
      `user.access[]` tables collapse into one mapping from that identity to
      the units or stores it may see.
- [ ] **Index the scheduler's hot queries when the schema is written** —
      plan.md §626. `checkin:send` and `quiz:send` run **every minute** and
      filter reservations on `checkin`+`checkin_sent`+`checkin_success`+`status`
      and `status`+`checkout`+`quiz_sent` respectively; the legacy migrations
      have no index for either. Both want a composite, and both are partial-index
      candidates since they only match rows whose "sent" flag is false. Also
      cover `uuid` lookups for guest links and `quiz_responses.reservation_id`.
      Same class of fix as the recent `audit_logs.created_at` index.
- [ ] **Move `tally`'s aggregation into SQL** — it inherits
      `SELECT * FROM wsir_vnd_vendas` with no date filter (plan.md §622), so
      the whole sales table crosses the wire on every refresh and is summed in
      the browser. Aggregate in SQL, bounded by date, and send totals rather
      than rows.
- [ ] **Build the birthday and promo email flows** — plan.md §629 puts them
      in scope. They are effectively new features, not a port: the legacy has
      only an enum, per-unit `birthday_is_active` / `promo_is_active` flags and
      admin translation pages, while `SendEvents` has empty case bodies and is
      not scheduled at all. There are four guest email flows in total, not the
      two §620 described.
- [ ] **Build the check-out / online payment flow** — plan.md §629 puts it in
      scope, and it is the largest of the three. `CheckOut.cs`, the night-audit
      run and the invoice/payment DAOs exist in the legacy agent but are
      commented out of its tick loop. This is the path that most needs the
      assemblies-for-writes decision, since it calls Wintouch's own account
      transfer logic.
- [ ] **Build the agents x86, not AnyCPU/x64** — plan.md §629. The Wintouch
      assemblies at `C:\wintouch\sgw` are **PE32 (x86)**, so an agent that
      loads them must target x86 or AnyCPU with `Prefer32Bit`. An x64 build
      fails at load with a `BadImageFormatException` that does not obviously
      point at bitness. Verify on the first agent build rather than trusting it.
- [ ] **Plan the cutover re-send** — plan.md §629. Reservation uuids are not
      preserved (only feedback responses and check-in history migrate; units,
      guests and reservations re-sync from Wintouch), so check-in and feedback
      links already in guests' inboxes stop working at cutover. Decide between
      a quiet window and a one-off re-send, per client, before the first one.
- [ ] **Register `apps/hotel/`** — plan.md §628. One compose project holding
      `hotel-admin` (`10600`), `check-in` (`10601`), `pulse` (`10602`),
      `hotel-core` (`10603`) and a shared `hotel-db` with no host port.
      Declares `backup: { engine: 'postgres', service: 'hotel-db' }` and
      generates its database password through `hiddenGeneratedSecrets`.
      Needs a `services.ts` entry with its `additionalExposures` (which depends
      on the per-exposure Authelia item above), mandatory `homepage.*` labels,
      and rows in `docs/ports.md`, `docs/app-credentials.md` and
      `docs/licences.md` — a licence row per app **and per base image**.
      `apps/tally/` is done (plan.md §630) and is the worked example.
- [ ] **Verify `tally` starts on the live stack** — plan.md §630 registered the
      app and proved the schema against a real `postgres:17-alpine` in CI, but
      nothing has run it on `beta` yet. Check: the app starts from the
      dashboard, `TALLY_DB_PASSWORD` is generated into `apps/tally/.env` on
      first start, `/api/health` returns ok through its own hostname, the
      Authelia gate holds on admin paths while `/agent` bypasses it, and the
      scheduled `pg_dump` picks `tally-db` up.