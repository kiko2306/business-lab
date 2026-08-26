# Homelab Management System Specification

## 1. Overview
This project is a multi-container homelab management system built with an Angular frontend and a Node.js/Express (TypeScript) backend. It provides a dashboard for starting and stopping Docker-based services, viewing logs, and monitoring system resources.

The frontend, API, and database should all run as Docker containers, while the host continues to run Docker and Bash scripts that manage the individual homelab apps.

## 2. Goals
- Provide a simple dashboard for managing common homelab services, including: nginx-proxy-manager, netbird-vpn, home-assistant, cloudflare-tunnel, code-server, book-stack, file-browser, home-page, n8n, paperless, pihole, speedtest, tailscale, dozzle, beszel, mealie, and portainer.
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
