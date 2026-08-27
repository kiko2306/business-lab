# Homelab Management System Specification

## 1. Overview
This project is a multi-container homelab management system built with an Angular frontend and a Node.js/Express (TypeScript) backend. It provides a dashboard for starting and stopping Docker-based services, viewing logs, and monitoring system resources.

The frontend, API, and database should all run as Docker containers, while the host continues to run Docker and Bash scripts that manage the individual homelab apps.

## 2. Goals
- Provide a simple dashboard for managing common homelab services, including: nginx-proxy-manager, netbird-vpn, home-assistant, cloudflare-tunnel, code-server, book-stack, file-browser, home-page, n8n, paperless, pihole, speedtest, tailscale, dozzle, beszel, mealie, portainer, vaultwarden, uptime-kuma, authelia, duplicati, nextcloud, immich, jellyfin, vikunja, and watchtower.
- Support secure first-time admin setup and JWT-based authentication.
- Allow service lifecycle control through safe host-level scripts.
- Offer clear status visibility and basic operational feedback.
- Store configuration locally with easy backup and recovery.
- Run the frontend, API, and database in containers for easier deployment and portability.

## 3. Technology Stack
- **Frontend**: Angular (latest stable), containerized with Docker
- **Backend**: Node.js + Express + TypeScript, containerized with Docker
- **Database**: SQLite or PostgreSQL, containerized with Docker
- **Runtime Environment**: Linux host with Docker and Bash

## 4. Proposed Directory Structure
The project should follow a predictable layout:

```text
/homelab-manager
├── /apps
│   ├── /nginx-proxy-manager
│   ├── /netbird-vpn
│   ├── /home-assistant
│   ├── /cloudflare-tunnel
│   ├── /code-server
│   ├── /book-stack
│   ├── /file-browser
│   ├── /home-page
│   ├── /n8n
│   ├── /paperless
│   ├── /pihole
│   ├── /speedtest
│   ├── /tailscale
│   ├── /dozzle
│   ├── /beszel
│   ├── /mealie
│   └── /portainer
├── /scripts
│   ├── start-container.sh
│   ├── stop-container.sh
│   └── update-container.sh
├── /backend
├── /frontend
├── /database
└── docker-compose.yml
```

## 5. Product Scope

### MVP
- First-time admin account setup
- JWT login/logout
- Service list dashboard
- Start/stop service actions
- Live service status refresh
- Cloudflare Tunnel token settings
- Docker containerization for frontend, API, and database

### Phase 2
- Audit logging
- Health checks beyond `docker ps`
- WebSocket or SSE-based live updates
- Database/config backups
- Export/import settings
- User management improvements

### Nice-to-Have
- Service templates
- UI theming
- Mobile-friendly refinements
- Better service recovery flows

## 6. Functional Requirements

### 6.1 Initialization and Authentication
- If no users exist, redirect all traffic to a setup page for creating the first admin.
- After the first admin is created, use standard JWT authentication.
- Successful login should redirect to `/dashboard`.
- Admin-only routes should be protected server-side and client-side.

### 6.2 Dashboard Capabilities
- Display all available services in a grid or card layout.
- Show service state clearly, at minimum as:
  - `running`
  - `stopped`
  - `starting`
  - `error`
  - `unknown`
- Provide explicit Start and Stop buttons for each service.
- Allow admins to manage users.
- Provide a settings panel for Cloudflare Tunnel token management.

### 6.3 Service Control
- The API must execute host scripts using Node.js `child_process`.
- Start and stop operations must be asynchronous.
- The UI should disable action buttons while a request is in progress.
- The UI should refresh service status after each operation.

### 6.4 Service Status
- Status should not depend only on `docker ps`.
- Prefer container state from Docker plus optional app-level health checks.
- Return a consolidated JSON payload to the frontend.

## 7. API Design

### Authentication
- Protect all private endpoints with JWT.
- Keep first-time setup endpoints available only until initial admin creation is complete.

### Service Endpoints
- `POST /api/services/:name/start`
- `POST /api/services/:name/stop`
- `GET /api/services/status`

### API Response Expectations
- Use consistent JSON shapes.
- Return clear error messages.
- Include enough information for UI toast messages and status refresh.

## 8. Safety and Operational Rules
- Only allow service names from a strict allowlist.
- Normalize and validate all paths before executing scripts.
- Do not pass raw user input directly into shell commands.
- Log every service action with user, time, and result.
- Avoid blocking the event loop during Docker startup or shutdown.

## 9. Cloudflare Tunnel Requirements
The Cloudflare Tunnel token should require scoped permissions only:
- **Account -> Cloudflare Tunnel -> Edit**
- **Zone -> DNS -> Edit**

The frontend settings panel should ideally include:
- masked token input
- show/hide toggle
- test connection button
- validation feedback
- permission explanation

## 10. Backup and Recovery
- Support configuration backups.
- Support database backups.
- Include a recovery path for password reset or setup-mode re-entry.
- Consider an emergency local-only access mode for host recovery.

## 11. Real-Time Updates
Preferred update strategies, in order:
1. WebSockets
2. Server-Sent Events
3. Polling fallback

## 12. Implementation Notes
- Keep service definitions configurable instead of hardcoding them.
- Consider one config file per service with metadata such as label, path, icon, and healthcheck method.
- If all apps follow a shared `compose.yml` structure, standardize scripts around `docker compose up -d` and `docker compose down`.

## 13. Suggested Roadmap

### Milestone 1: Core Platform
- [x] Project scaffold
- [x] Docker Compose setup for frontend, API, and database
- [x] Database schema
- [x] Authentication flow
- [x] First-time admin setup
- [x] Basic dashboard shell

### Milestone 2: Service Management
- [x] Service config loading
- [x] Start/stop script execution
- [x] Service status API
- [x] Frontend service grid
- [x] Loading and error states

### Milestone 3: Administration
- [x] Audit logs
- [x] User management
- [x] Permission checks — every account is an administrator, so there is no
      restricted role tier to gate; all `/users`, `/settings`, `/backups`, etc.
      routes require a valid JWT.
- [x] Backup/export features

### Milestone 4: Reliability and UX
- [x] Health checks
- [x] Real-time updates
- [x] Recovery workflows
- [ ] UI polish and mobile refinement

## 13.1 Priority and Estimate Reference

### Priority Levels

| Level | Description |
|-------|-------------|
| **P0** | Critical path — must complete before MVP release. Blocks other work or is essential to core functionality. |
| **P1** | High value — planned for MVP or shortly after. Important for usability, reliability, or security. |
| **P2** | Nice-to-have — deferred to Phase 2 or later. Improves experience but not blocking. |

### Estimate Sizes

| Size | Duration | Effort |
|------|----------|--------|
| **S** (Small) | 1–2 hours | Straightforward, isolated task. Low risk of unknowns. |
| **M** (Medium) | 3–8 hours | Moderate complexity. May require coordination across a few areas. |
| **L** (Large) | 1–3 days | Significant scope. Likely spans multiple components or requires design review. |
| **XL** (Extra Large) | 3+ days | Major undertaking. Requires architecture changes, extensive testing, or significant learning curve. |

---

## 14. Implementation Tasks

### Phase A: Infrastructure and Containerization
- [x] Create a root `docker-compose.yml` for frontend, backend, and database. **Priority: P0** — **Estimate: L**
- [x] Add Dockerfiles for the Angular app and Node.js API. **Priority: P0** — **Estimate: M**
- [x] Define persistent volumes for the database and configuration data. **Priority: P0** — **Estimate: M**
- [x] Add container networking so the frontend can reach the API and the API can reach the database. **Priority: P0** — **Estimate: S**
- [x] Add environment variable handling for secrets, API URLs, and database connection settings. **Priority: P0** — **Estimate: M**

### Phase B: Database and Auth Foundation
- [x] Design the database schema for users, roles, settings, and service definitions. **Priority: P0** — **Estimate: M**
- [x] Implement the first-admin bootstrap flow. **Priority: P0** — **Estimate: L**
- [x] Add JWT login, logout, and route protection. **Priority: P0** — **Estimate: L**
- [x] Create middleware for checking whether setup mode is still enabled. **Priority: P0** — **Estimate: M**

### Phase C: Service Management Backend
- [x] Create an allowlisted service registry. **Priority: P0** — **Estimate: M**
- [x] Implement start/stop endpoints using asynchronous `child_process` execution. **Priority: P0** — **Estimate: L**
- [x] Add status aggregation logic for Docker container state and service metadata. **Priority: P0** — **Estimate: L**
- [x] Normalize error handling and return consistent API responses. **Priority: P1** — **Estimate: S**
- [x] Add structured logging for service operations. **Priority: P1** — **Estimate: M**

### Phase D: Frontend Dashboard
- [x] Build the login and first-time setup pages. **Priority: P0** — **Estimate: L**
- [x] Build the dashboard shell and service grid. **Priority: P0** — **Estimate: L**
- [x] Add start/stop buttons with loading states. **Priority: P0** — **Estimate: M**
- [x] Add status indicators and refresh behavior. **Priority: P0** — **Estimate: M**
- [x] Create the Cloudflare token settings panel. **Priority: P0** — **Estimate: M**
- [x] Add admin user management screens. **Priority: P1** — **Estimate: L**

### Phase E: Operational Features
- [x] Add audit logging. **Priority: P1** — **Estimate: M**
- [x] Add backup and restore workflows. **Priority: P1** — **Estimate: L**
- [x] Add optional health checks. **Priority: P2** — **Estimate: L**
- [x] Add WebSocket or SSE support for live updates. **Priority: P2** — **Estimate: XL**
- [x] Add recovery mode and admin reset tooling. **Priority: P2** — **Estimate: M**

### Phase F: Hardening and Delivery
- [x] Add validation and security checks for all inputs. **Priority: P0** — **Estimate: M**
- [x] Test Dockerized deployment end-to-end. **Priority: P0** — **Estimate: L**
- [x] Document setup, deployment, and recovery steps. **Priority: P1** — **Estimate: M**
- [x] Add smoke tests for the startup flow and service control APIs. **Priority: P1** — **Estimate: M**

## 15. Acceptance Criteria
- [x] A new installation can create its first admin account safely.
- [x] An authenticated admin can view and manage services.
- [x] Start and stop actions run asynchronously without blocking the API.
- [x] Service status is visible and refreshes correctly.
- [x] Cloudflare token settings can be saved and updated.
- [x] The frontend, API, and database run in Docker containers.
- [x] The system is structured for backups and recovery.

## 16. Implemented: First-Start Public Exposure Provisioning

### 16.0 Implementation Status
Implemented per the plan below:
- `backend/src/services/executor.ts` — fixed the secrets-validation helper
  scoping bug that made `ensureServiceSecrets` unreachable (it was nested
  inside an unrelated `exec()` callback).
- `service_exposure` table (`database/init.sql`, with a startup migration in
  `backend/src/utils/database.js` for existing databases).
- `backend/src/routes/settings.js` — `GET`/`PUT /api/settings/exposure` for
  base domain, Cloudflare account/zone/tunnel IDs, and Nginx Proxy Manager
  URL/credentials (reuses the existing Cloudflare API token).
- `backend/src/routes/services.js` — `GET`/`PUT /api/services/:name/exposure`
  for per-service opt-in, upstream host/port/scheme, and websocket support.
- `backend/src/services/npmClient.js` — idempotent Nginx Proxy Manager proxy
  host client.
- `backend/src/services/cloudflareTunnelClient.js` — idempotent Cloudflare
  Tunnel ingress route client.
- `backend/src/services/exposure.js` — orchestrates provisioning after a
  successful `docker compose up -d`; never fails the start, records
  status/errors on `service_exposure`, and audits the outcome.
- Frontend: an "Exposure provisioning" section in the settings panel for the
  global config, and a per-service "Exposure settings" panel on each service
  card for enabling/configuring and viewing provisioning status.

**Not yet done / needs live validation**: this was built and syntax/type
checked, but not exercised against a real Nginx Proxy Manager or Cloudflare
account (none were available in this environment). Before relying on it,
test against a real NPM instance and Cloudflare tunnel, and confirm the
`nginx-proxy-manager:80` origin URL assumption matches your Docker network
setup.

### 16.1 Goal
When a user starts a managed container from the frontend for the first time, the
backend should automatically expose it through Nginx Proxy Manager and ensure
Cloudflare Tunnel has a matching public hostname route pointing traffic to
Nginx.

Because the homelab uses a dynamic public IP, the first implementation should
use Cloudflare Tunnel public hostnames instead of public `A`/`AAAA` DNS records.
Service hostnames should be derived as `<service>.<base-domain>`, for example
`paperless.example.com`.

### 16.2 Current State
- The Angular dashboard starts services through `ServiceStateService` and
  `POST /api/services/:name/start`.
- The backend service route calls `executor.startService(serviceName, userId)`.
- Services are defined in `backend/src/config/services.ts`.
- Cloudflare API token storage and verification already exists in
  `backend/src/routes/settings.js`.
- Nginx Proxy Manager has a compose stack under `apps/nginx-proxy-manager/`.
- `cloudflare-tunnel` exists in the backend service registry, but
  `apps/cloudflare-tunnel/` still needs to be added.

### 16.3 Required Configuration
- Cloudflare account ID, zone ID, and tunnel ID/name, or permission to discover
  them from the API token and base domain.
- Base domain used to derive public hostnames as `<service>.<base-domain>`.
- Cloudflare Tunnel token stored/configured from the dashboard.
- Nginx Proxy Manager admin API URL reachable from the backend.
- Nginx Proxy Manager credentials or API token.
- Cloudflare Tunnel origin URL for Nginx Proxy Manager, for example
  `http://nginx-proxy-manager:80` or another URL reachable by `cloudflared`.
- Per-service upstream scheme, host, port, websocket support, and whether
  exposure is enabled by default.
- TLS/certificate preference for Nginx Proxy Manager.

### 16.4 Implementation Plan
1. Fix and verify service start prerequisites.
   - Check `backend/src/services/executor.ts` helper scoping before wiring
     provisioning into service starts.
   - Preserve current validation, error handling, and audit logging patterns.
2. Add exposure metadata.
   - Add a DB-backed or registry-backed exposure config with base domain,
     derived hostname, upstream scheme/host/port, exposure enabled flag, and
     optional TLS settings.
   - Validate hostnames, ports, URLs, and policy fields.
3. Add the Cloudflare Tunnel app stack and dashboard configuration.
   - Add `apps/cloudflare-tunnel/compose.yaml` and `.env.example` for running
     `cloudflared` in Docker using a tunnel token.
   - Add backend settings endpoints for base domain, account/zone/tunnel
     identifiers, tunnel token, and Nginx origin URL.
   - Add dashboard controls to configure, mask, save, and test the tunnel
     settings.
4. Add a Nginx Proxy Manager client.
   - Authenticate to Nginx Proxy Manager.
   - Idempotently find, create, or update proxy hosts for service hostnames.
   - Store NPM endpoint and credentials safely in settings.
5. Add a Cloudflare Tunnel client.
   - Reuse the stored Cloudflare token.
   - Discover or use configured account, zone, and tunnel identifiers.
   - Idempotently ensure Cloudflare Tunnel public hostname routes so
     `<service>.<base-domain>` routes to the Nginx Proxy Manager origin.
6. Add provisioning orchestration.
   - After `docker compose up -d` succeeds, run provisioning once for services
     with exposure enabled.
   - Persist provisioning state in Postgres with service name, hostname, NPM
     object ID, Cloudflare object IDs, status, last error, and timestamps.
   - Return provisioning details or warnings in the start-service response and
     audit log the outcome.
7. Update frontend service feedback.
   - Show exposure/provisioning status on service cards or in a details panel.
   - Surface warnings if the container starts but provisioning is incomplete.
8. Update API and operational documentation.
   - Document new settings endpoints, service exposure fields, Cloudflare/NPM
     permissions, and failure modes.
9. Validate.
   - Add targeted backend or smoke coverage for provisioning idempotency and
     validation.
   - Build the Angular frontend when UI changes are made.
   - Test against mocked or dry-run external APIs before using live credentials.

### 16.5 Default Behavior
- Exposure should be opt-in per service.
- Public hostnames should use `<service>.<base-domain>`.
- Provisioning should be idempotent and look up existing Nginx Proxy Manager and
  Cloudflare Tunnel objects by hostname before creating anything.
- A container start should succeed if Docker starts successfully, even when
  external provisioning fails. The API should return a warning and store/audit
  the provisioning failure instead of silently ignoring it.
- Cloudflare Access and dynamic DNS updates are deferred until after the
  Cloudflare Tunnel + Nginx Proxy Manager flow is working.

## 17. Session Log — 2026-08-26: Exposure validated live, security fix, one-command setup

### 17.0 Status at start of session
Section 16 above had been implemented but never exercised against a real NPM
instance or Cloudflare account. This session validated it end-to-end against
this deployment's real Nginx Proxy Manager and Cloudflare Tunnel, using
`paperless` as the proof case, and fixed everything that broke along the way.

**As of this entry, the changes below are uncommitted in the working tree**
(last commit on `main` is `5e905a7`). Verified in this session:
`backend`: `tsc --noEmit` clean, `vitest run` passing (6 tests in
`services.test.ts`). `frontend`: `ng build` succeeds (pre-existing initial
bundle-size budget warning only, unrelated to this session).

### 17.1 Done this session
- [x] **Exposure upstream auto-derivation** — removed the manual upstream
      scheme/host/port/websocket fields from the per-service exposure API and
      UI. `backend/src/services/exposure.ts` now derives them itself: scheme
      is fixed `http`, port comes from `getPublishedUpstreamPort()` (parses
      the app's compose file — see `backend/src/config/services.ts`), host is
      `getHostGatewayIp()` (`backend/src/utils/network.ts`, resolves
      `host.docker.internal` to a literal IP once and caches it), websocket
      upgrade is always allowed. The exposure panel is now an enable toggle
      plus a read-only "forwarding to..." line.
- [x] **`exposureEnvKeys` mechanism** — a service can declare env keys in its
      `services.ts` registry entry (see `paperless`) that get computed from
      the exposed hostname and injected at every start, without writing to
      the read-only `apps/` mount. Fixes apps (like Paperless) that need their
      own public-URL/allowed-hosts env vars to accept traffic through the
      tunnel.
- [x] **NPM API bug** — `websocket_upgrade` is not a real Nginx Proxy Manager
      field; the correct one is `allow_websocket_upgrade`. Silent no-op
      before this fix.
- [x] **`host.docker.internal` proxy_pass bug** — nginx's resolver for
      variable-based `proxy_pass` upstreams is DNS-only and never consults
      `/etc/hosts`, so the hostname resolved on the host but not from inside
      nginx. Fixed by resolving to the literal gateway IP once, up front
      (`getHostGatewayIp`), instead of passing the hostname through.
- [x] **Health-status default bug** — services in the registry without a
      configured health check (most of them) were reported as `check failed`
      instead of `healthy` while their container was running, because the
      `healthy` flag defaulted to `false` whenever no check was configured.
      Now defaults to `true` for a running service with no check configured;
      `check failed` is reserved for a check that actually ran and failed.
- [x] **Secret leak: `.env.save`** — a file with a live, still-active
      `JWT_SECRET` was committed to git (introduced in `5cafdfb`). Rotated the
      secret, deleted the file from disk and tracking, broadened `.gitignore`
      to `.env.*` (with `.env.example` explicitly re-allowed). The old value
      is still visible in git history at `5cafdfb` — rotation makes it inert,
      but scrubbing it fully would need a history rewrite.
- [x] **Docker socket proxy** — the backend no longer mounts
      `/var/run/docker.sock` directly. `tecnativa/docker-socket-proxy` now
      holds the real socket; the backend talks to it over
      `DOCKER_HOST=tcp://docker-socket-proxy:2375` on the internal network
      only, scoped to containers/images/networks/volumes + start/stop —
      `exec`/`build`/`secrets`/`swarm`/`plugins` stay off. Narrows blast
      radius; does not sandbox what a compose file itself can bind-mount.
- [x] **Removed `apps/cloudflare-tunnel/` Docker stack** — this deployment
      runs `cloudflared` via host systemd, not the Docker stack shipped in
      the repo; that stack had no `.env` and had never been started here. Its
      registry entry was removed too.
- [x] **Dropped `service_configs` table** — empty, zero code references
      (`database/init.sql` and the live DB).
- [x] **`start.sh`** — one-command bootstrap (`./start.sh`): generates
      `.env` on first run (random `JWT_SECRET`/`JWT_REFRESH_SECRET`/
      `POSTGRES_PASSWORD`, auto-detected `APPS_DIR`/`DOCKER_GID`), best-effort
      `chgrp`/`chmod`s `apps/` so the dashboard can write per-app `.env`
      files, then `docker compose up -d --build`. Safe to re-run (never
      overwrites a secret already set).
- [x] **Per-app `.env` editing moved into the dashboard** —
      `backend/src/services/appEnv.ts` (new) + `backend/src/utils/envFile.ts`
      (new, minimal `.env` parser) read/write `apps/<name>/.env` directly.
      `APPS_DIR` is now mounted read-write (previously read-only) for this.
      Secret-looking keys (`PASSWORD`/`SECRET`/`TOKEN`/`*_KEY`/`APIKEY`
      pattern) are write-only in the UI — reported as "configured" or not,
      never echoed back.
- [x] Started backend test coverage — `backend/src/config/services.test.ts`
      (new, 6 tests covering `extractComposeEnvVars`) and `vitest` added as a
      dev dependency with a `test` script. First test file in the repo.

### 17.1a Continued same session: expanded backend test coverage
- [x] `services.test.ts` — added 6 tests for `getPublishedUpstreamPort`
      (literal port, `${VAR:-default}` fallback, `.env` override of the
      default, no `ports:` mapping, no compose file installed, unknown
      service name). Uses a temp `APPS_DIR` + a real registry key
      (`paperless`) so it doesn't depend on the checked-in `apps/` fixtures
      staying in sync.
- [x] `npmClient.test.ts` (new, 7 tests) — `buildProxyHostPayload` shape, and
      `ensureProxyHost` create/update/no-op/ownership-conflict/login-failure
      paths, with `requestJson` mocked via `vi.mock('../utils/httpJson')`.
- [x] `cloudflareTunnelClient.test.ts` (new, 5 tests) — `ensureIngressRoute`
      insert-before-catch-all, no-op when rule+DNS already correct, update
      when hostname exists pointing elsewhere, DNS-ownership-conflict
      rejection, and tunnel-config-read failure, same `requestJson` mocking
      approach.
- Backend suite is now 23 tests across 3 files; `tsc --noEmit` and
  `vitest run` both verified clean (via `node:20-alpine` in Docker, since
  this environment has no local Node/npm — see 17.4).
- **Not yet covered**: `exposure.ts` itself (the orchestration layer —
  needs DB mocking, more setup) and the frontend has zero `*.spec.ts` tests.
  Both remain open in 17.3.

### 17.2 Deployment fact worth remembering
This deployment's real Cloudflare Tunnel runs as a **host-level systemd
service**, not the `apps/cloudflare-tunnel/` compose stack (now removed
anyway). Public hostnames already live: `homelab.tx-home-utils.com` (frontend)
and `api-homelab.tx-home-utils.com` (backend) — meaning the dashboard itself
is internet-facing independent of the per-service exposure feature it
provides. Keep this in mind before assuming anything about the tunnel is
driven by a Docker stack in this repo.

### 17.3 Outstanding TODO (carried into future sessions)

**Add**
- [ ] **CI pipeline** — no `.github/workflows/` yet; `smoke-tests.sh`,
      `docker-e2e-test.sh`, and both `tsc`/`ng build` checks only run
      manually. **Priority: P1** — **Estimate: M**
- [ ] **Automated tests, remaining gaps** — `npmClient.ts`,
      `cloudflareTunnelClient.ts`, and `getPublishedUpstreamPort` now have
      unit coverage (23 tests, see 17.1a). Still needed: `exposure.ts` itself
      (the orchestration layer that ties them together — needs DB mocking)
      and any frontend (`*.spec.ts`) tests at all — zero exist today.
      **Priority: P1** — **Estimate: M**
- [ ] **"Test connection" action for exposure settings** — NPM credentials
      and Cloudflare account/zone/tunnel IDs are only exercised the next time
      a service starts. A validate-now button in Settings would have caught
      several of this session's misconfigurations immediately instead of
      after a failed provisioning attempt. **Priority: P2** — **Estimate: M**
- [ ] **Exposure drift detection** — nothing notices if NPM's or Cloudflare's
      live state diverges from `service_exposure` (e.g. someone hand-edits
      the proxy host in NPM's UI). Add periodic reconciliation, or at least a
      "re-verify" button. **Priority: P2** — **Estimate: M**
- [ ] **2FA for admin accounts** — worth prioritizing given the dashboard is
      already internet-facing via the tunnel (see 17.2), independent of the
      per-service exposure feature. **Priority: P1** — **Estimate: M**
- [ ] **Scheduled/automated backups** — confirm whether `POST
      /backups/create` is manual-trigger only; if so, add a cron-driven
      schedule with retention. **Priority: P2** — **Estimate: S**
- [ ] **Extend `exposureEnvKeys` to other apps** — only `paperless` declares
      one today. Any other app with its own Host-header/CSRF allowlist will
      hit the same bug class the first time exposure is enabled for it.
      **Priority: P2** — **Estimate: S per app**
- [ ] **Health check URLs still assume host ports** — entries use
      `localhost:<port>`, rewritten via `SERVICE_HEALTH_HOST`. Apps not
      published to the host, or published on a non-default port, will still
      misreport `check failed`. Distinct from the no-check-configured default
      bug fixed this session. **Priority: P2** — **Estimate: M**

**Commit hygiene**
- [ ] **This session's work is entirely uncommitted** — 32 modified files
      plus new `backend/src/config/services.test.ts`,
      `backend/src/services/appEnv.ts`, `backend/src/utils/envFile.ts`,
      `backend/src/utils/network.ts`, `start.sh`. Review and commit (likely
      as a few focused commits: security fix / docker-socket-proxy /
      exposure auto-derivation / start.sh+appEnv / README+plan docs) before
      starting new work, so it isn't sitting at risk of being lost or
      tangled with whatever comes next.

**Already done, kept for history**
- [x] `.env.save` secret leak — removed, rotated, `.gitignore` broadened.
- [x] `apps/cloudflare-tunnel/` Docker stack — removed (see 17.2).
- [x] `service_configs` table — dropped.
- [x] Manual upstream host/port/scheme/websocket exposure fields — removed
      from API and UI; now auto-derived (see 17.1).
- [x] Docker socket proxy — direct socket mount replaced.

### 17.4 Environment note for future sessions
This dev/agent environment has no local `node`/`npm` (only `docker`).
Backend `typecheck`/`test` and the frontend `ng build` were run/verified via:
```bash
docker run --rm -v "$PWD":/app -w /app node:20-alpine sh -c "npm install && npm run typecheck && npm test"
```
(swap the command for `npx ng build` in `frontend/`). `node_modules` isn't
committed and wasn't left installed on disk outside the container — re-run
`npm install` (in a container or wherever Node is available) before trying
to run anything directly.

## 18. Session Log — 2026-08-26 (cont.): live health-check fixes, TODO reordered

### 18.1 code-server / bookstack health checks fixed live
Both were live-deployed bugs, found and fixed against the real running stack
(this environment has `docker` access to the actual deployment — see §17.2).

- **`code-server`**: `services.ts` and the app's own
  `apps/code-server/docker-compose.yml` healthcheck both assumed HTTPS with a
  self-signed cert on 8443 (`curl -fk https://localhost:8443/health`). The
  running container's own logs said otherwise: `HTTP server listening on
  http://[::]:8443/` / `Not serving HTTPS` — confirmed live by `curl` failing
  with `SSL routines::wrong version number` (client sent TLS, server spoke
  plain HTTP). `/health` also doesn't exist (401); the real endpoint is the
  public, unauthenticated `/healthz` (returns `{"status":"alive",...}`).
  Fixed both files to `http://localhost:8443/healthz`. A first fix attempt
  (switching to `https://` plus `rejectUnauthorized: false` in
  `backend/src/services/status.ts`) was wrong and was reverted — worth
  remembering: don't trust an app's own Docker healthcheck definition as
  ground truth without confirming what the container is actually doing,
  since that definition itself can be stale/copied-from-a-template.
- **`bookstack`**: `services.ts` checked `/health` (doesn't exist on this
  Laravel-based image, 404). Its own container healthcheck already correctly
  probes `/login`; matched the registry entry to it.
- Verified live: `code-server-code-server-1`'s own Docker healthcheck flipped
  from `unhealthy` (`FailingStreak: 22`) to `healthy` after rebuilding
  `code-server` (compose recreate) and the `homelab-management-backend-1`
  image (`docker compose up -d --build backend`).
- Committed as `1c4cffe` (first, wrong https attempt + correction squashed
  into the session's work — see git log for the actual fix commit once this
  session's remaining work is committed).

### 18.2 TODO reordered by dependency/logic, not just priority label
The flat P1/P2 list in §17.3 is superseded by this ordering — same items,
sequenced so each one's output feeds the next rather than by label alone.
Numbers below double as the reference used elsewhere in this log (e.g.
"item 3").

1. [x] **Scheduled/automated backups** — smallest, standalone. Implemented
   this session — see §18.3 for what shipped.
2. [x] **CI pipeline** — added `.github/workflows/ci.yml` with two jobs
   (`backend`: `npm ci` + `typecheck` + `test`; `frontend`: `npm ci` +
   `build`), triggered on push to `main` and on pull requests. No frontend
   `ng test` step — zero spec files exist and karma/jasmine aren't even
   installed (see item 3), so it would only fail. Verified both jobs pass
   locally via the same `node:20-alpine` commands (see §17.4).
   **Priority: P1** — **Estimate: M**
3. [x] **`exposure.ts` + frontend test coverage** — added
   `backend/src/services/exposure.test.ts` (7 tests, DB/settings/network/
   npmClient/cloudflareTunnelClient mocked, same pattern as
   `npmClient.test.ts`/`cloudflareTunnelClient.test.ts`; backend suite now
   36 tests). Frontend had zero test infrastructure at all — karma/jasmine
   weren't even in `devDependencies`, so `ng test` only ever failed. Added
   them plus `frontend/karma.conf.js` (launches Chrome via puppeteer's
   bundled Chromium as `ChromeHeadlessCI`, `--no-sandbox`, so it doesn't
   depend on a system Chrome install) and a `test:ci` script, wired into
   the CI frontend job (commit `22f0a59`). First spec files: `authGuard`,
   `guestGuard`, `AuthService` (login/session/refresh), `LoginComponent`
   (validation, success/error submit, paste sanitization) — 14 tests, all
   verified passing headless via `node:20-slim` + puppeteer deps in this
   session. **Priority: P1** — **Estimate: M**
4. [x] **"Test connection" action for exposure settings** — added
   `npmClient.testNpmConnection` / `cloudflareTunnelClient.
   testCloudflareTunnelAccess` (read-only login/config/zone checks,
   nothing created or changed), `POST /api/settings/exposure/test`
   (tests the currently saved global config, same one a service start
   uses), and a "Test connection" button in the settings panel showing a
   pass/fail alert per service (NPM, Cloudflare). 5 new backend tests
   (46 total); frontend build + full spec suite (14 tests) verified
   passing. **Priority: P2** — **Estimate: M**
5. [x] **Exposure drift detection** — added a "re-verify" button rather than
   periodic reconciliation: `POST /api/services/:name/exposure/verify`
   re-runs `provisionServiceIfEnabled` on demand, which both detects *and*
   fixes drift in one call since `ensureProxyHost`/`ensureIngressRoute` are
   already idempotent — no separate detection logic needed. Service card
   gained a "Re-verify" button next to Save (shown once a hostname exists).
   Verified live: both new routes 401 unauthenticated, backend boots clean.
   **Priority: P2** — **Estimate: M**
6. [ ] **Extend `exposureEnvKeys` to other apps** — only `paperless`
   declares one today (see §17.1). Not schedulable as a single task; handle
   incrementally each time exposure is enabled for a new app, informed by
   whatever that app actually needs. **Priority: P2** — **Estimate: S per app**
7. [ ] **Health check host-port assumption cleanup** — deprioritized:
   §18.1's real failures turned out to be protocol/path mismatches
   (`http` vs `https`, wrong path), not the `SERVICE_HEALTH_HOST` host-port
   issue this item originally assumed. Revisit generically only if another
   service actually exhibits that specific pattern. **Priority: P2** —
   **Estimate: M**
8. [ ] **2FA for admin accounts** — labeled M but realistically the largest
   lift here (TOTP enrollment, backup codes, login-flow changes, UI); do
   last and with its own dedicated plan rather than folding it into a quick
   pass. Still worth prioritizing given the dashboard is already
   internet-facing via the tunnel (see §17.2). **Priority: P1** —
   **Estimate: M (likely undersized)**
9. [x] **Organize dashboard apps by type** — the service grid was one flat
   list of 25+ cards with no grouping. Implemented this session — see §18.4.
   **Priority: P2** — **Estimate: S**
10. [x] **Manage Authelia's admin account from the dashboard** — username,
    display name, email, and password lived only in
    `apps/authelia/config/users_database.yml`, editable by hand only.
    Implemented this session — see §18.5. **Priority: P2** — **Estimate: S**

### 18.3 Item 1 (backups) — implementation notes
Implemented as an opt-in schedule (default off) rather than adding a cron
library — a `setInterval` poll every hour, comparing "now" against a stored
last-run timestamp against the configured frequency, is enough to cover the
two frequencies offered and avoids a new dependency for something this
small. `POST /backups/create` (manual trigger, pre-existing) was untouched
in behavior; the new code sits alongside it.

- **`backend/src/services/backup.ts`** (new) — pulled the shared backup
  mechanics (`BACKUP_DIR`, `createBackupArchive()`, path/exec helpers) out of
  `routes/backup.ts` so both the route and the new scheduler can call them.
  Also owns the schedule settings: `BACKUP_SCHEDULE_SETTINGS_KEYS`
  (`backup_schedule_enabled` / `_frequency` / `_retention_count` /
  `_last_run_at`, stored as plain rows in the existing `settings`
  key/value table — no new table needed), `getBackupScheduleConfig()` /
  `saveBackupScheduleConfig()` / `setBackupScheduleLastRun()`, and
  `pruneOldBackups(retentionCount)` (deletes oldest `.tar.gz` files beyond
  the retention count, by mtime).
- **`backend/src/services/backupScheduler.ts`** (new) — `shouldRunScheduledBackup(now, lastRunAt, frequency)`
  is a pure function (unit tested, 6 cases in
  `backupScheduler.test.ts`) so the due/not-due decision doesn't depend on
  wall-clock timing in tests. `runScheduledBackupCheck()` loads config,
  no-ops if disabled or not due, otherwise creates a backup, audit-logs it
  (`userId: null`, `metadata: { trigger: 'scheduled' }` — the existing
  `writeAuditLog` already supports a null user and the audit UI already
  renders that as no username), then prunes. `startBackupScheduler()` runs
  one check immediately at boot (catches up a missed run after a restart)
  and then every hour.
- **`backend/src/routes/backup.ts`** — trimmed to routing/HTTP-shape only;
  added `GET /schedule` and `PUT /schedule` (Joi-validated via new
  `backupScheduleUpdate` schema in `middleware/validation.ts`). The manual
  `POST /create` route now also runs `pruneOldBackups()` after a successful
  create, but only when the schedule is enabled — leaves today's
  unlimited-accumulation behavior alone for anyone who doesn't opt in.
- **`backend/src/index.ts`** — calls `startBackupScheduler()` at boot,
  alongside the other fire-and-forget startup hooks (`dropLegacyRoleColumn`,
  `ensureServiceExposureTable`).
- Widened the backup archive's own settings-export filter
  (`backup.ts` → now `services/backup.ts`) to `... OR key LIKE
  'backup_schedule_%'` so the schedule config itself round-trips through
  backup/restore. (Noted but out of scope: the same filter still does *not*
  capture `exposure_*` settings — a pre-existing gap, not introduced here.)
- **Frontend**: `operations.service.ts` gained `getBackupSchedule()` /
  `updateBackupSchedule()`; `models.ts` gained `BackupScheduleConfig`. UI is
  a small card inside the existing `#backups` section on the dashboard
  (`dashboard.component.html`) — an "Automatic backups" toggle, a
  frequency select (Daily/Weekly) and a retention-count number input shown
  only when enabled, a "Last scheduled backup" timestamp, and a Save button.
  No new page/route.
- **Verified**: `tsc --noEmit` and `vitest run` clean (29 tests, up from 23
  — 6 new for `shouldRunScheduledBackup`); `ng build` clean (same
  pre-existing bundle-size budget warning as before, unrelated). Deployed
  live (`docker compose up -d --build backend frontend`): backend booted
  without error, the scheduler's immediate startup check correctly no-op'd
  (feature defaults to disabled, confirmed zero `backup_schedule_%` rows in
  the live `settings` table after boot), and `GET /api/backups/schedule`
  returns `401` unauthenticated, confirming the route is live and gated
  correctly. **Not verified**: the authenticated round-trip (toggling the
  switch in the browser, confirming a scheduled run actually fires) — no
  admin session was available in this environment to exercise it through
  the UI. Worth a manual pass next time the dashboard is open.

### 18.4 Item 9 (organize apps by type) — implementation notes
Added a `category: ServiceCategory` field to the service registry rather than
inferring grouping client-side from label/description text, so the mapping
lives in one place (`backend/src/config/services.ts`) and is explicit.

- **`backend/src/types/index.ts`** — new `ServiceCategory` union (7 values:
  Networking & Security, Monitoring & Management, Media, Backup & Storage,
  Productivity, Home Automation, Development); `category` added as a
  required field on `ServiceDefinition` and optional on `ServiceStatusPayload`
  (optional there so older/partial payloads on the error path still typecheck).
- **`backend/src/config/services.ts`** — every one of the 25 registered
  services tagged with a category.
- **`backend/src/services/status.ts`** — `getServiceStatus` now copies
  `service.category` onto both the success and error-path response payloads.
- **`frontend/src/app/core/models.ts`** — mirrored `ServiceCategory` union;
  `ServiceStatus.category` added as optional (older cached API responses or a
  service missing from the registry shouldn't break rendering).
- **`frontend/src/app/pages/dashboard/dashboard.component.ts`** — added a
  `groupServicesByCategory()` function grouping the flat service list into
  category buckets, ordered by a fixed `CATEGORY_ORDER` array with an
  "Other" bucket last as a fallback for anything uncategorized.
- **`frontend/src/app/pages/dashboard/dashboard.component.html`** — the
  service grid now iterates category groups, each rendered as its own
  `<h2>` heading followed by its row of cards, instead of one flat grid.
  `allServices` passed to `app-service-card` is still the full unfiltered
  list (needed for its own `dependsOn` lookups across categories), not the
  per-group slice.
- **Verified**: backend `tsc --noEmit` and `vitest run` clean (49 tests, up
  from 46 — no new tests added, but two `exposure.test.ts` mock service
  objects needed a `category` field added to satisfy the now-required type).
  Frontend `ng build` clean (same pre-existing bundle-size budget warning as
  before, unrelated). **Not verified**: the existing Karma/Jasmine frontend
  spec suite — this environment's apt-installed Chromium version didn't
  match what Puppeteer expected, an unrelated pre-existing tooling gap (no
  dashboard/service-card spec files exist yet to cover this change anyway).
  Not exercised live in a browser against the real deployment.

### 18.5 Item 10 (Authelia admin account panel) — implementation notes
Authelia's file authentication backend stores its admin account in
`config/users_database.yml` (YAML, argon2-hashed password) — a different
file and format from the generic per-app `.env` editor added in §17.1, so
this needed its own read/write path rather than reusing `appEnv.ts`.

- **Scope, decided with the user up front**: edit the single account tagged
  `admins` in the file (falls back to the first entry) — not full multi-user
  CRUD, matching how this and presumably every deployment of this app is
  actually set up. Saving auto-restarts the Authelia container so the change
  takes effect immediately (a few seconds of SSO downtime for anything
  behind it), rather than silently reporting success on a stale container.
- **Password hashing**: reused `bcryptjs` (already a dependency, via the
  existing `utils/password.ts` `hashPassword()` used for the dashboard's own
  accounts) instead of adding a new `argon2` native dependency. Verified
  compatible with Authelia's file backend empirically against the live
  `authelia/authelia:latest` image in this environment: generated a bcrypt
  hash with `authelia crypto hash generate bcrypt` (produces a `$2b$12$...`
  digest — same prefix bcryptjs produces), then confirmed a bcryptjs
  digest passes `authelia crypto hash validate`.
- **`backend/src/services/autheliaUsers.ts`** (new) — `getAutheliaAdminUser()`
  / `updateAutheliaAdminUser()`. Reads `apps/authelia/config/users_database.yml`
  via `js-yaml` (new dependency — nothing YAML-capable existed in the
  codebase before this). Splits the file into the header-comment preamble
  and the parsed `users:` document so a save preserves the human-written
  comments at the top instead of clobbering them with a bare re-dump.
  Renaming the username (a YAML map key) is handled by deleting the old key
  and inserting the new one. A blank/omitted password keeps the existing
  hash unchanged, same convention as every other secret field in this app.
- **`backend/src/services/executor.ts`** — new `restartService()`. No-ops
  (reports success without running anything) if the service isn't currently
  running, since there's nothing to restart and the new config applies on
  next start anyway — avoids erroring out when an admin edits the account
  while Authelia happens to be stopped.
- **`backend/src/config/services.ts` / `types/index.ts`** — new
  `supportsAdminUserManagement` flag on `ServiceDefinition` (set only on
  `authelia`), surfaced to the frontend as `adminUserManagementSupported` on
  `ServiceStatusPayload`/`ServiceStatus`, mirroring the existing
  `setupTokenSupported` pattern — capability-driven, not a hardcoded service
  name check in the UI.
- **`backend/src/routes/services.ts`** — `GET`/`PUT /api/services/:name/admin-user`,
  gated by the new capability flag (404 for any service that doesn't set it).
  `PUT` calls `updateAutheliaAdminUser()` then `executor.restartService()`,
  audit-logs the username and whether the password changed (never the
  password itself).
- **Frontend**: a collapsible "Admin account" panel on the service card
  (`service-card.component.ts`/`.html`), shown only when
  `service.adminUserManagementSupported` is true — username, display name,
  email, and a password field (blank = keep current), with copy noting the
  restart/downtime up front before the admin saves.
- **Verified**: backend `tsc --noEmit` and `vitest run` clean (55 tests, up
  from 49 — 6 new in `autheliaUsers.test.ts`, covering read, the
  multi-user "admins"-tag fallback, rename + preamble preservation, bcrypt
  hashing of a new password, and the 404 path when the file is missing).
  Frontend `ng build` clean (same pre-existing budget warning, unrelated).
  Deployed live (`docker compose up -d --build backend frontend`): backend
  booted without error, `GET /api/services/authelia/admin-user` returns
  `401` unauthenticated, confirming the route is live and gated correctly.
  **Deliberately not exercised**: the live `PUT` was never actually called
  against this deployment's real `users_database.yml` — doing so would have
  changed this environment's actual Authelia login and forced a real restart
  of the production Authelia container outside of a deliberate user action.
  The rename/rehash/restart-skip-when-stopped logic is covered by the unit
  tests above against a synthetic copy of the real file's exact format
  instead. Worth a manual pass through the browser next time the dashboard
  is open, using a throwaway password change to confirm the full
  save-then-login round trip.

## 19. Session Log — 2026-08-27: Running-apps ports table

### 19.1 Requested
Add a table to the dashboard, positioned above the existing per-category
service card list, showing every currently-running app and which host
port(s) it's published on. Goal is an at-a-glance port map without having
to open each service card or run `docker ps` by hand.

- [x] Backend: derive live published ports per service from `docker ps`
      (filtered by the same `com.docker.compose.project` label already
      used for container state), not from static compose-file parsing —
      catches every container in a project (e.g. NetBird's dashboard +
      management containers) and reflects what's actually bound right now.
      Surface as `ports: ServicePortMapping[]` on `ServiceStatusPayload`.
- [x] Frontend: new table section in `dashboard.component.html`, placed
      before the categorized service-card grid, listing app label + host
      port + container port + protocol for every `running` service that
      publishes at least one port.

### 19.2 Implementation notes
- **`backend/src/services/status.ts`** — new `getContainerPorts(projectName)`,
  same `docker ps --filter label=com.docker.compose.project=...` pattern as
  the existing `getContainerStatus`, format `{{.Ports}}`. A regex
  (`PORT_MAPPING_PATTERN`) pulls host port, container port, and protocol out
  of each comma-separated entry (e.g. `0.0.0.0:8080->80/tcp`), handling port
  ranges (`80-81->80-81/tcp`) and skipping unpublished container-only ports
  (no `->`, e.g. `5432/tcp`). Results are deduped by `hostPort/protocol`
  (IPv4 and IPv6 both list the same port) and sorted numerically. Called
  from `getServiceStatus()` only when `state === 'running'`.
- **`backend/src/types/index.ts`** — new `ServicePortMapping` interface,
  `ports?: ServicePortMapping[]` added to `ServiceStatusPayload`. Mirrored on
  the frontend in `core/models.ts` (`ServicePortMapping`, `ServiceStatus.ports`).
- **`frontend/src/app/pages/dashboard/dashboard.component.ts`** — new
  `getRunningServicePorts()`, flattens all running services' `ports` into
  one row per port mapping, sorted by app label then host port.
- **`dashboard.component.html`** — new "Running app ports" table section,
  placed directly above the categorized service-card grid as requested,
  bound once via `*ngIf="getRunningServicePorts(services) as portRows"` so
  the flatten only runs once per template check.
- **Verified**: backend `tsc --noEmit` and `vitest run` clean (55 tests,
  unchanged — no new tests added for the port-parsing regex; worth adding
  if this logic grows more edge cases). Frontend `ng build` clean (same
  pre-existing budget warning, unrelated). Deployed live
  (`docker compose up -d --build backend frontend`); called
  `getAllServiceStatus()` directly inside the running backend container
  against the real Docker socket-proxy and confirmed correct output for
  every currently-running app, including NetBird's two-container project
  (ports 8080 + 8081), nginx-proxy-manager's port range (`80-81`) plus a
  single port (`443`), and Portainer's two separate ports (9000, 9443).
  **Not verified**: the rendered table in an actual browser — no browser
  tool was available in this session and the dashboard's own login
  credentials weren't on hand. Worth a quick visual pass next time the
  dashboard is open.

## 20. Session Log — 2026-08-27 (cont.): NetBird "peers not showing"

### 20.1 Reported
NetBird's dashboard `/peers` page shows no peers.

### 20.2 Investigated
Checked the live deployment directly (all three `netbird-vpn-*` containers
running, ~3h uptime):
- **`netbird-management` logs**: on boot, `No records in table peers, no
  migration needed` — the peers table is genuinely empty, not a rendering
  bug. Across the container's full uptime there is exactly one `/api/peers`
  request logged, my own manual `curl` just now (`401`, expected without a
  token) — **zero peer registration/login attempts have ever reached
  management**. No client has ever run `netbird up` against this server.
- **OIDC/auth plumbing**: healthy. Management fetches Authelia's OIDC config
  successfully after one transient `502` retry at boot (cold-start race
  between containers, not a config error — self-recovers, unrelated to
  peers). The dashboard's own login flow completes fine — its access log
  shows a real browser session hitting `/nb-auth` then `/peers` with a
  `200`, i.e. dashboard login through Authelia already works.
- **Public exposure**: both hostnames are provisioned and reachable —
  `netbird-vpn.tx-home-utils.com` (dashboard) and
  `netbird-vpn-api.tx-home-utils.com` (management API, the second hostname
  the SPA calls directly from the browser per `additionalExposures` in
  `backend/src/config/services.ts`). Confirmed live: `service_exposure` DB
  rows for both show `status: provisioned` with no `last_error`, and
  `curl https://netbird-vpn-api.tx-home-utils.com/api/peers` returns a
  correct `401` (reachable, auth-gated, not a 502/timeout/DNS failure).
- **STUN/TURN**: `data/management.json` has `"Stuns": []` and
  `"TURNConfig": {"Turns": []}` — none configured. This doesn't affect
  whether a peer *registers* (shows up in the list at all), only whether two
  registered peers can actually establish a direct/relayed connection to
  each other afterward. Worth fixing before this is relied on for real
  connectivity, but it isn't the cause of an empty peers list.

### 20.3 Conclusion
Not a bug in this deployment's NetBird setup as far as could be verified —
the peers list is empty because **no device has ever connected a NetBird
client to this management server**, not because of a broken dashboard,
auth, or exposure path. All the infrastructure a peer enrollment would need
(public hostnames, OIDC, management API) checks out live. Could not verify
further in this environment: there is no NetBird client available here to
actually attempt `netbird up --management-url
https://netbird-vpn-api.tx-home-utils.com` end-to-end.

### 20.4 Root causes found and fixed (live debugging with the user)
Two independent bugs, found by walking the browser dashboard and the mobile
app through the failure live rather than guessing from logs alone.

**Bug 1 — dashboard: missing `offline_access` scope.**
`apps/netbird-vpn/docker-compose.yml`'s `AUTH_SUPPORTED_SCOPES` was `"openid
profile email"` — no `offline_access` — even though Authelia's
`netbird-dashboard` OIDC client (`apps/authelia/config/configuration.yml`)
already allows `offline_access` and the `refresh_token` grant. Without
requesting it, Authelia never issues a refresh token, so the dashboard's
access token simply expired with no way to renew it, and every API call
(including the peers list) started failing with `401 token expired` —
confirmed live via the browser console. **Fixed**: added `offline_access`
to `AUTH_SUPPORTED_SCOPES`; redeployed
(`docker compose up -d --force-recreate netbird-dashboard`).

**Bug 2 (the real blocker) — mobile/native clients: gRPC needs HTTP/2, proxy
was HTTP/1.1-only.** After fixing Bug 1, the mobile app still failed with
`failed to check SSO support: failed getting management service public
key`. Root cause: NPM's proxy host for `netbird-vpn-api.tx-home-utils.com`
had `http2 off;` / `proxy_http_version 1.1;`. That's fine for the browser
dashboard (grpc-web tunnels over plain HTTP/1.1), but native NetBird clients
(mobile/desktop/CLI) speak real gRPC, which needs HTTP/2 end-to-end —
`proxy_pass` never speaks HTTP/2 to the upstream no matter what. This is
almost certainly why the peers table was empty in the first place (§20.2):
no native client could ever complete the initial gRPC handshake, through
any reverse-proxy path, regardless of the dashboard bug above.

**Fixed and automated**, not just patched live:
- `backend/src/types/index.ts` — `ServiceAdditionalExposure` gained an
  optional `grpc?: boolean` field.
- `backend/src/config/services.ts` — netbird-vpn's `additionalExposures`
  entry (the `-api` hostname) now sets `grpc: true`.
- `backend/src/services/npmClient.ts` — new `buildGrpcAdvancedConfig(host,
  port)` builds a `location / { grpc_pass grpc://host:port; }` block (fully
  replacing NPM's auto-generated one, same pattern as the existing Authelia
  block). `buildProxyHostPayload` now sets `http2_support: true` and this
  `advanced_config`, and forces `allow_websocket_upgrade` off, whenever
  `grpc` is true. `ensureProxyHost`'s drift check now also compares
  `http2_support`, so a live host that regresses gets self-healed on the
  next provisioning run (e.g. the existing "re-verify" button).
- `backend/src/services/exposure.ts` — threads `grpc` from each
  `additionalExposures` entry through to `ensureProxyHost` (primary hostname
  always passes `grpc: false`).
- Tests: `npmClient.test.ts` (+3: payload shape with `grpc: true`, drift
  detection when grpc turns on) and `exposure.test.ts` (updated to assert
  `grpc: true`/`false` land on the right hostname). Backend suite now 57
  tests, `tsc --noEmit` clean.
- **Verified live**: rebuilt and redeployed the backend
  (`docker compose up -d --build backend`), then called
  `provisionServiceIfEnabled('netbird-vpn', 1)` directly inside the running
  container — this is the same path a real service start/re-verify takes,
  not a one-off script. Confirmed `/data/nginx/proxy_host/10.conf` now has
  `http2 on;` and `location / { grpc_pass grpc://172.17.0.1:8080; }`,
  `nginx -t` passes, and `GET /api/peers` still correctly returns `401`
  (REST traffic still works through the same `grpc_pass`'d location — the
  management server's combined HTTP+gRPC handler serves both fine, this
  isn't an either/or).
- **This is now automated for every future setup** — a fresh deployment or
  a rebuilt backend image provisions gRPC support on NetBird's API hostname
  from the registry entry alone, no manual NPM/nginx editing needed. Any
  other future service that mixes real gRPC with REST on one port can reuse
  the same `grpc: true` flag on its `additionalExposures` entry.
- **Not yet confirmed**: an actual end-to-end peer enrollment from the
  mobile app (the user was retrying at the time this was written). If it
  still fails after both fixes, the next thing to check is
  `apps/netbird-vpn/data/management.json`'s empty `Stuns`/`TURNConfig.Turns`
  — that wouldn't block registration but could block two registered peers
  from actually connecting to each other.

### 20.5 Status: still broken after both fixes — pick up here next session
Both fixes in §20.4 are live and confirmed applied (not just "should be
applied" — actually checked): NPM's `10.conf` has `http2 on;` +
`grpc_pass grpc://172.17.0.1:8080;` (`nginx -t` passes), and Cloudflare's
tunnel config for `netbird-vpn-api.tx-home-utils.com` has
`originRequest.http2Origin: true` (confirmed via `GET
.../cfd_tunnel/{id}/configurations` directly, not just "we wrote it").
`journalctl -u cloudflared` shows cloudflared reloaded that exact config at
`2026-08-27T10:45:28Z` (`event=... Updated to new configuration ...
netbird-vpn-api.tx-home-utils.com ... originRequest:{"http2Origin":true}`).

**Yet the mobile app retry after all of this still fails with the same
`failed to check SSO support: failed getting management service public
key`.** Don't re-apply either fix again next session — both are verifiably
live. The bug is somewhere past them. Two concrete leads, unexplored:

1. **No request-level cloudflared log for `netbird-vpn-api` at all, before
   or after the config reload.** `journalctl -u cloudflared --since <retry
   time>` shows nothing hostname-matching `netbird-vpn-api` — not a success,
   not a `502`, nothing. Either the mobile app's request never actually
   reaches Cloudflare's edge for this hostname (DNS? a client-side cached
   failure without a new attempt? wrong hostname/port entered in the app?),
   or cloudflared logs gRPC-level failures at a level below `INF` (default).
   **Next step**: run `cloudflared` with `--loglevel debug` (or bump the
   systemd unit's log level, then `journalctl -u cloudflared -f`) and watch
   it live during a fresh mobile-app retry, to see whether the request
   arrives at all and if so exactly how it fails.
2. **`http2Origin` may require an HTTPS origin to mean anything.**
   Cloudflare's own docs describe `http2Origin` as negotiating HTTP/2 via
   ALPN — which is a TLS handshake feature. The origin service here is
   `http://192.168.1.23` (confirmed live, in both the NPM payload and the
   cloudflared config dump above) — **plain HTTP, no TLS**, because this
   whole chain (NPM → management) was built as an internal cleartext hop
   with TLS terminated at Cloudflare's edge. If `http2Origin` is a no-op
   against a non-TLS origin, cloudflared may still be talking HTTP/1.1 to
   NPM regardless of the flag, which would explain the persisting failure
   even with everything upstream of that hop fixed. **Not yet confirmed
   either way** — needs the debug-log check in (1) to see what protocol
   cloudflared actually negotiates, or a targeted search of cloudflared's
   docs/source for whether `http2Origin` silently no-ops on an `http://`
   service URL.
   - If confirmed, the fix would be giving NPM's `netbird-vpn-api` host a
     real TLS listener (self-signed is fine, `noTLSVerify: true` on the
     Cloudflare Tunnel side) so cloudflared can ALPN-negotiate HTTP/2 for
     real, matching NetBird's own documented nginx reverse-proxy examples
     (which assume `listen 443 ssl http2;`, not a cleartext listener). That
     would mean widening `additionalExposures`/`ensureProxyHost` further:
     an `https`-scheme origin option for `grpc` exposures specifically,
     since every other exposure in this app deliberately stays plain HTTP
     internally (TLS only at the edge) — this one may be the exception.

**Also still unconfirmed** (unrelated to the above, don't forget): whether
`Stuns`/`TURNConfig.Turns` being empty in
`apps/netbird-vpn/data/management.json` would block anything further even
if enrollment itself starts working — irrelevant until enrollment succeeds
at all.

### 20.5a New detail from the user, changes the leading hypothesis
The mobile app's actual error also includes **`403` with an unexpected
`Content-Type: text/html`** (the user reported this after the write-up
above was already logged). This reframes things:

- A `403` + HTML body is Cloudflare's own edge block/challenge page shape
  (WAF rule or Bot Fight Mode), not something NPM or the management
  container would produce for a gRPC call — nginx's own 403 error page is
  also HTML by default, but see below for why Cloudflare's edge is more
  likely than nginx here.
- This lines up with the already-noted oddity in 20.5 item 1: **zero
  request-level cloudflared log entries for `netbird-vpn-api`, before or
  after the config reload, across multiple retries.** If Cloudflare's edge
  is blocking/challenging the request before it ever reaches the tunnel,
  cloudflared would never log it at all — which is exactly what's observed.
  A native gRPC client (Go-based user agent, binary protobuf POST body, no
  browser session/cookies, first contact with no prior page load) is a very
  typical profile for Cloudflare's Bot Fight Mode or a managed WAF rule to
  challenge, since it looks nothing like a browser.
- Also worth reconsidering: nginx's `grpc_pass` does **not** require the
  downstream (client-facing) leg to already be HTTP/2 — it translates
  whatever protocol the client used into HTTP/2 toward the upstream
  regardless. That's consistent with the earlier `curl .../api/peers` test
  succeeding over what was almost certainly a plain HTTP/1.1 hop. So the
  `http2Origin`/TLS-ALPN theory from 20.5 item 2 is weaker than first
  thought — nginx's own protocol translation may make it unnecessary. Don't
  chase that lead first next session; chase the Cloudflare edge one below.

### 20.6 Outstanding TODO (superseded — see 20.7 for what actually happened)
- [x] **Get Claude access to Cloudflare Security Events/WAF for this zone.**
      Done — user widened the existing exposure API token's permissions
      (Zone Settings, Firewall Services, Zone WAF, Analytics, all Read) in
      the Cloudflare dashboard. The app reads the same stored token, so no
      code change was needed.
- [x] **Check Cloudflare's zone security settings.** Done — checked
      `security_level` (medium, default), `/firewall/rules` (empty, 0
      legacy rules), and `/rulesets` (only the 3 stock managed rulesets,
      no custom ones). Security Events (`firewallEventsAdaptive` via
      GraphQL) came back empty even for requests that were actively being
      403'd live — the block turned out not to be a WAF/Bot Fight Mode
      event at all, hence nothing logged there. See 20.7.
- [x] **~~Add a WAF/Bot Fight Mode exception~~ — not applicable.** The real
      cause wasn't WAF/bot related. See 20.7.
- [ ] **Debug-log cloudflared during a live mobile-app retry** — no longer
      needed; root cause found without it (20.7). Leaving unchecked only in
      case the HTTPS-origin work in 20.7's TODO surfaces something new that
      needs it.
- [x] **Determine whether `http2Origin` needs an HTTPS origin.** Confirmed
      yes — `http2Origin` sets Go's `http.Transport.ForceAttemptHTTP2`,
      which only affects TLS (ALPN) connections and is a no-op against a
      plain `http://` origin. See 20.7 for the fix this implies.
- [ ] **Confirm a real peer actually enrolls and shows up** — still open,
      blocked on the HTTPS-origin work in 20.7. **Priority: P0** —
      **Estimate: S**
- [ ] **Configure STUN/TURN** — `Stuns`/`TURNConfig.Turns` are both empty in
      `apps/netbird-vpn/data/management.json`. Won't block registration, but
      peers behind NAT likely can't connect to each other without it. Not
      worth touching until enrollment itself works. **Priority: P1** —
      **Estimate: S–M**

### 20.7 Session continued (2026-08-27, same day): real root cause found — Cloudflare's zone-level gRPC toggle was off
With Security Events access in hand, the WAF/Bot Fight Mode lead from 20.5a
turned out to be a dead end — `firewallEventsAdaptive` was empty even
seconds after reproducing the 403 live, meaning nothing was logging it as a
WAF/bot decision at all. That absence was the actual clue.

**Root cause, confirmed by isolation testing:** Cloudflare has a dedicated,
dashboard-only **gRPC toggle** per zone (**Network tab → gRPC**). When it's
off, the edge itself rejects *any* request carrying a
`content-type: application/grpc` (or `application/grpc+proto`) header with
a bare `403 Forbidden` / `text/html` body — before the request ever reaches
the tunnel or origin, and without generating a WAF/Bot Fight Mode event.
This is documented behavior
(https://developers.cloudflare.com/network/grpc-connections/), not a
misconfiguration on our side.

Proved this two ways:
1. Sent a POST with `content-type: application/grpc` (real gRPC framing,
   no `te: trailers` even needed to trigger it) directly to
   `netbird-vpn-api.tx-home-utils.com` — got the exact 403/text-html the
   mobile app reports, byte-for-byte (`<hr><center>cloudflare</center>`
   template). The request never showed up in NPM's
   `proxy-host-10_access.log` at all — confirming it never left Cloudflare's
   edge.
2. Sent the *same header* to **`paperless.tx-home-utils.com`** (a
   completely unrelated, already-working host on the same zone) — also
   403'd. Proved it's a zone-wide setting, not anything specific to the
   `netbird-vpn-api` proxy host or its NPM/tunnel config, before touching
   any of that config further.

**User enabled the gRPC toggle this session.** That clears the edge-level
block, but it does **not** by itself make gRPC work end-to-end — Cloudflare
requires the *origin* to speak real TLS + HTTP/2 via ALPN on port 443
(https://developers.cloudflare.com/network/grpc-connections/, "origin must
listen on 443, support TLS, and advertise HTTP/2 over ALPN"). This confirms
lead 2 from 20.5 was right: our origin is `http://192.168.1.23` (plain,
cleartext) with `http2Origin: true` on the tunnel side — and `http2Origin`
only forces HTTP/2 over an *existing* TLS connection (it maps to Go's
`http.Transport.ForceAttemptHTTP2`, which is meaningless for a non-TLS
`http://` URL; cloudflared has no h2c/cleartext-HTTP2 support to the
origin). So even with the zone toggle on, this specific host will still
fail until the origin hop is real TLS.

### 20.8 Implemented and verified live: real TLS origin for grpc exposures
Built and shipped the fix described above:
- `backend/src/services/npmClient.ts`: added `ensureGrpcCertificate` —
  idempotently finds or creates a self-signed `"other"`-provider NPM
  certificate for the hostname (`openssl req -x509 ...`, uploaded via
  NPM's `/api/nginx/certificates` + `/upload` multipart endpoint) and
  attaches it (`certificate_id`, `ssl_forced: true`) only when `grpc` is
  true. `buildProxyHostPayload`/`ensureProxyHost`'s drift-detection now
  also compares `certificate_id`/`ssl_forced`.
- `backend/src/utils/httpJson.ts`: `requestJson` gained a `rawBody` option
  so the multipart cert upload could reuse the same mockable client
  instead of hand-rolling a second raw `http`/`https` request path.
- `backend/src/services/cloudflareTunnelClient.ts`:
  `EnsureIngressRouteOptions`/`ensureIngressRoute` gained `noTLSVerify` and
  `originServerName`, alongside the existing `http2Origin`, with drift
  detection extended to cover all three.
- `backend/src/services/exposure.ts`: added `getNpmGrpcOriginUrl`
  (`https://` on 443, vs. the plain-`http://` `getNpmOriginUrl` every other
  exposure uses) and wired `noTLSVerify`/`originServerName` into
  `provisionHostname`'s `ensureIngressRoute` call, both keyed off the
  existing `grpc` flag.
- `backend/Dockerfile`: added the `openssl` package (cert generation shells
  out to it).

All covered by unit tests (`npmClient.test.ts`, `cloudflareTunnelClient.test.ts`,
`exposure.test.ts`) and rebuilt/redeployed live. Re-ran
`POST /api/services/netbird-vpn/exposure/verify` after deploying — both
exposures provisioned with no error. Confirmed on the actual infra:
- NPM's `10.conf` now has `listen 443 ssl` + `http2 on` with a real
  self-signed cert (`/data/custom_ssl/npm-1/`), still `grpc_pass
  grpc://172.17.0.1:8080;`.
- The Cloudflare tunnel ingress rule for `netbird-vpn-api.tx-home-utils.com`
  now reads `"service": "https://192.168.1.23"` with
  `originRequest: { http2Origin: true, noTLSVerify: true, originServerName:
  "netbird-vpn-api.tx-home-utils.com" }`.
- **End-to-end proof**: a real gRPC call (`content-type: application/grpc`,
  `POST /management.ManagementService/GetServerKey`) through the public
  hostname now returns `HTTP/2 200` with `content-type: application/grpc`
  — this is the exact call the mobile app's SSO check makes first. NPM's
  access log shows it landing correctly: `POST https ... 200 200 ...
  Sent-to 172.17.0.1`.

### 20.9 Real mobile-app retry: new failure — cloudflared drops gRPC trailers (upstream bug, not ours)
20.7/20.8 were necessary but **not sufficient**. Retried with the actual
NetBird Android app (not just synthetic `curl`) against
`https://netbird-vpn-api.tx-home-utils.com` and got a *new*, different
error:

> failed to check SSO support: failed getting management service public
> key: rpc error: code = Internal desc = server closed the stream without
> sending trailers

Live evidence pointed the same way before the app confirmed it: NPM's
access log showed the real client (`grpc-go/1.80.0` user agent, not curl)
successfully calling `GetServerKey` and getting `200` — repeatedly, every
few seconds, in a tight loop, never progressing. That pattern (success
status, no visible error, but no forward progress) is consistent with a
gRPC client that never received a `grpc-status` trailer and is silently
retrying. Re-ran the same call manually with `curl -v --http2`: got the
`200` response headers and a correctly-framed protobuf body, but **no
trailing HEADERS frame with `grpc-status` at all** — curl's verbose output
ends right after the body, nothing further.

**Root cause: this is an open, unresolved cloudflared bug, not a config
problem.** Found
https://github.com/cloudflare/cloudflared/issues/1641 ("gRPC response body
and trailers stripped through tunnel even with TLS+ALPN+h2 origin") —
symptom, setup, and error message match ours exactly:
`code = Internal desc = server closed the stream without sending
trailers`, reproduced with the exact same origin shape we now have
(self-signed TLS origin, `http2Origin: true`, `noTLSVerify: true`).
Reported against cloudflared 2025.8.1 and 2026.3.0, still open, no
workaround documented. The dashboard (browser) works fine because it uses
**grpc-web over HTTP/1.1** — a completely different, unaffected code path
— not real gRPC. Real gRPC (what every native client — mobile, desktop,
CLI — uses) apparently cannot complete a unary call through a Cloudflare
Tunnel right now, regardless of origin config on our end.

**Do not re-attempt more Cloudflare Tunnel / `http2Origin` / cert tuning
next session** — 20.7/20.8's origin-TLS work is correct and necessary
(confirmed: NPM correctly serves `grpc_pass` over real TLS+HTTP2 now,
verified independently of this bug), but no amount of NPM/tunnel
configuration fixes a bug in cloudflared's own frame handling.

### 20.10 Proposed fix (not yet implemented — needs user's router): bypass the tunnel for this one host
Only real way around a transport-level bug in cloudflared is to stop using
cloudflared for this hostname. Plan, pending the user setting up a
port-forward (can't be done remotely from here):

1. **Router**: port-forward 443 (or a chosen public port) directly to the
   NPM host's LAN IP. Needs a static public IP or DDNS if the ISP doesn't
   give one — unconfirmed which the user has.
2. **DNS**: switch `netbird-vpn-api.tx-home-utils.com` to **unproxied**
   (grey-cloud) in Cloudflare, so traffic goes client → router → NPM
   directly instead of through the tunnel. Every other exposure in this
   app stays proxied/tunneled as-is — this would be the one exception.
3. **Certificate**: the self-signed cert from 20.8 (`ensureGrpcCertificate`
   in `npmClient.ts`) only worked because `noTLSVerify: true` on the tunnel
   side skipped validation. A directly-exposed client (the real NetBird
   app) will do normal CA validation, so this host needs a **real**
   Let's Encrypt cert instead. NPM already supports DNS-01 issuance via a
   Cloudflare plugin (`certbot-dns-cloudflare`, confirmed present in NPM's
   `/app/certbot/dns-plugins.json` — needs
   `dns_cloudflare_api_token=<token>`, and the app's existing stored
   Cloudflare API token already has DNS edit rights, since it already
   creates DNS records). This avoids needing port 80 exposed for an
   HTTP-01 challenge. Implementation-wise: `ensureGrpcCertificate` needs a
   second path (`provider: 'letsencrypt'`, `meta.dns_challenge: true`,
   `meta.dns_provider: 'cloudflare'`) instead of the self-signed `'other'`
   provider one, used only for hosts that go this direct-exposure route.
4. **App code**: needs a way to mark a given `additionalExposures` entry
   (or the primary exposure) as "direct" vs "tunneled" — right now
   everything assumes the Cloudflare Tunnel unconditionally. This is a
   bigger change than 20.7/20.8 was; size it up properly before starting,
   don't rush it in like the gRPC flag was.
5. Once live, retest the mobile app the same way as this session.

**Alternative not yet explored**: whether NetBird's own `Relay`/`Signal`
components (separate from the Management API) could stand in for direct
enrollment instead of reworking exposure topology — lower priority, only
worth a look if the router port-forward turns out to be impractical.

### 20.11 Outstanding TODO
- [ ] **User: confirm whether a router port-forward + (static IP or DDNS)
      is feasible** for `netbird-vpn-api` before any of 20.10 is
      implemented — this is the actual blocker, not more code.
      **Priority: P0**
- [ ] **Implement 20.10** once the above is confirmed feasible: DNS-01 cert
      path in `ensureGrpcCertificate`, a "direct exposure" mode in the
      exposure config/DB schema, grey-clouding the DNS record, and the
      router-side port-forward (user). **Priority: P0** — **Estimate: L**
- [ ] **Confirm a real peer actually enrolls and shows up** — blocked on
      20.10. **Priority: P0** — **Estimate: S**
- [ ] **Configure STUN/TURN** — `Stuns`/`TURNConfig.Turns` are both empty in
      `apps/netbird-vpn/data/management.json`. Won't block registration, but
      peers behind NAT likely can't connect to each other without it. Not
      worth touching until enrollment itself works. **Priority: P1** —
      **Estimate: S–M**
