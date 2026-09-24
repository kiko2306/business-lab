# Business Lab

**Version 0.146.0** — full history in the [changelog](/CHANGELOG.md).

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

- [ ] **Beta-test the self-update panel's richer progress detail (plan.md
      §659)** — on `beta`, trigger a real self-update while a commit is
      pending and confirm: the progress alert shows a `detail` suffix naming
      which image is building (`frontend`/`backend`) one at a time rather
      than a single flat "Building…" line; while apps are updating, the
      detail shows `<app> (n/total)` and advances as each app is pulled and
      recreated; and if `origin` is briefly unreachable when a run starts,
      the run shows `checking` for the duration of that fetch and lands as
      an `error` row (visible in run history) rather than the trigger
      request hanging with no row at all.
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

- [ ] **Beta-test the social-drafts publish path (plan.md §660)** — on
      `beta`: configure the shared mailbox and Dashboard URL in Settings,
      subscribe a real address via `POST /api/subscribers`, generate a
      draft on the Content page, click Publish, and confirm a real email
      arrives with the draft's content and a working
      `{baseUrl}/unsubscribe/{token}` link; confirm Publish is blocked with
      a clear error when the mailbox or Dashboard URL isn't set yet, and
      that an unsubscribed address stops receiving further publishes.
      Slice 2 (social-platform posting) still needs a per-platform
      token/OAuth setup and is scoped only once a specific platform is
      named.

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

- [ ] **Prove the agent WebSocket survives the Cloudflare Tunnel** — the
      server side is built and works end to end through real containers
      (plan.md §634): an agent dials out to `/agent/connect`, authenticates
      with its enrolment token, and browser reads relay to it live. What is
      **not** proven is the one hop that cannot be tested here — a long-lived
      WebSocket through Cloudflare Tunnel → NPM → the container. Check on
      `beta`: the socket establishes through the public hostname, survives
      longer than the tunnel's idle timeout (the 30 s ping/pong should carry
      it), and reconnects by itself after the tunnel restarts. If it does not
      hold, §627 records the fallback — timer-pushed snapshots with a cached
      API — and that is a design change, not a patch.
- [ ] **First real build and a live run of the hotel agent, on the Windows
      machine with Wintouch installed** — `apps/hotel/agent/` (plan.md §653)
      is a close, call-by-call port of the legacy's own DAO classes, and it
      builds clean against the real Wintouch assemblies (checked from WSL by
      pointing the project's `HintPath`s at the mounted DLLs and building
      with `dotnet build`) — but nothing in that session could run it. There
      is no CI job for this project either (unlike `tally-agent`'s): the
      Wintouch DLLs it references are proprietary and per-install, so they
      can never be vendored into this public repo or fetched by CI. On the
      real machine: build it (`dotnet build -c Release`, into
      `C:\wintouch\sgw` so the assemblies are on the search path), issue an
      enrolment code from hotel-core, run `Hotel.Agent.exe enrol <CODE>`,
      install the service, and confirm a tick actually completes —
      `SetCurrentUser`/`SetDatabase`/`SwitchContext` succeed, units/guests/
      reservations land in hotel-core, and a real online check-in writes
      back into Wintouch (the `observacoes` stamp shows up on the
      reservation, and `AvisarObservacoes` flags it for reception). Also
      confirm check-out billing (plan.md §656) on the same machine: flip a
      unit's check-out billing switch on, let a reservation check out so the
      agent computes its bill, settle it in hotel-admin (to the guest on
      file, and separately to an overridden entity code), and confirm the
      agent's next tick actually moves the reservation's Wintouch account —
      `Contas.GetListContasAbertas` shows the charges under the chosen
      entity, not the guest's own account, when an override was used.
- [ ] **Verify a gated secondary hostname on the live stack** — built in
      plan.md §637: an `additionalExposures` entry can now set
      `autheliaProtected: true`, and the rule generator emits it with the
      app's own group and bypass paths. What tests cannot show is whether NPM
      actually renders forward-auth for a secondary host and Authelia accepts
      the enlarged block — and this repo's history has Authelia config that
      passed tests and took the gate down on the host (§423, §425). Check on
      `beta` once `apps/hotel/` exists: the gated secondary asks for a login,
      the public ones do not, the app's bypass path still answers
      unauthenticated, and Authelia restarts cleanly rather than crash-looping.
- [ ] **Run `install.ps1` for real, on a shop machine** — plan.md §655
      collapses the tally agent's four manual install steps into one
      elevated PowerShell script, but nothing off a real Windows machine
      could run it (only parsed for syntax). Confirm: it copies itself into
      `%ProgramFiles%\Tally`, writes a correct `tally.config`, enrols
      successfully, registers and starts the `Tally.Agent` service, and
      that re-running it against an already-installed agent with a fresh
      code restarts the service rather than failing on `sc.exe create`.
- [ ] **Confirm `estado` semantics with a second Wintouch install** — §636
      reads `wsir_mst_mesas.estado` as 0 free, 1 awaiting payment, 2 occupied,
      from the labels on the legacy SQL files plus the live `vallado` data
      (161 at 0, 4 at 2). The legacy Angular read it the other way round. No
      row with `estado = 1` has been seen yet, so the awaiting-payment case is
      inferred rather than observed — worth confirming on a shop that has a
      table with the bill requested.
- [ ] **Verify `hotel-core`'s guest-email scheduler on the live stack** —
      plan.md §651, §652. Everything is proven against a real database in CI:
      the offset math, the flow/active-flag gating, and "a failed send
      leaves the row unmarked so the next tick retries" — but nothing off
      the live stack can prove the one piece that only exists when the app
      is actually exposed: that `HOTEL_CHECKIN_URL` / `HOTEL_PULSE_URL`
      resolve to the real `hotel-checkin`/`hotel-pulse` hostnames (the new
      `additionalExposures.urlEnvKey` mechanism) rather than the
      `localhost:<port>` compose default, and that a real SMTP send through
      them lands a usable link in an inbox. Check on `beta`: set a unit's
      `checkin_is_active` + a real SMTP sender, seed (or wait for the agent
      to sync) a reservation whose check-in date is within the offset, and
      confirm the email arrives with a working `https://hotel-checkin.…`
      link — then the same for a post-checkout quiz email and the
      15-minute agent-down alert. Also confirm the birthday and promo
      flows (§652, no guest link/page, so no exposure dependency): flip a
      unit's `birthday_is_active` + `promo_is_active` on, seed a reservation
      spanning today with a guest whose `birth_date` matches today, and
      confirm both the birthday email and the promo email arrive.
- [ ] **Verify `tally` starts on the live stack** — plan.md §630 registered the
      app and proved the schema against a real `postgres:17-alpine` in CI, but
      nothing has run it on `beta` yet. Check: the app starts from the
      dashboard, `TALLY_DB_PASSWORD` is generated into `apps/tally/.env` on
      first start, `/api/health` returns ok through its own hostname, the
      Authelia gate holds on admin paths while `/agent` bypasses it, and the
      scheduled `pg_dump` picks `tally-db` up. Now also: that Authelia's
      forwarded `Remote-User` / `Remote-Groups` headers actually arrive at the
      app through NPM — every admin route depends on them (plan.md §631), and
      nothing off the live stack can prove they are forwarded.