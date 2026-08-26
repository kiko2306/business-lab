# Homelab Management System Specification

## 1. Overview
This project is a multi-container homelab management system built with an Angular frontend and a Node.js/Express backend. It provides a dashboard for starting and stopping Docker-based services, viewing logs, and monitoring system resources.

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
- **Backend**: Node.js + Express, containerized with Docker
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
- `backend/src/services/executor.js` — fixed the secrets-validation helper
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
- Services are defined in `backend/src/config/services.js`.
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
   - Check `backend/src/services/executor.js` helper scoping before wiring
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
