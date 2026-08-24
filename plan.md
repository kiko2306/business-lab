# Homelab Management System Specification

## 1. Overview
This project is a multi-container homelab management system built with an Angular frontend and a Node.js/Express backend. It provides a dashboard for starting and stopping Docker-based services, viewing logs, and monitoring system resources.

The frontend, API, and database should all run as Docker containers, while the host continues to run Docker and Bash scripts that manage the individual homelab apps.

## 2. Goals
- Provide a simple dashboard for managing common homelab services, including: nginx-proxy-manager, netbird-vpn, home-assistant, cloudflare-tunnel, code-server, book-stack, file-browser, home-page, n8n, paperless, pihole, speedtest, tailscale, dozzle, and beszel.
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
│   └── /beszel
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
- [ ] User management
- [ ] Permission checks
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
- [ ] Add admin user management screens. **Priority: P1** — **Estimate: L**

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
