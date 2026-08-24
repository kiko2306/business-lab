# Homelab Management System Specification

## 1. Overview
This project is a multi-container homelab management system built with an Angular frontend and a Node.js/Express backend. It provides a dashboard for starting and stopping Docker-based services, viewing live status, managing users, and configuring Cloudflare Tunnel settings.

The frontend, API, and database should all run as Docker containers, while the host continues to run Docker and Bash scripts that manage the individual homelab apps.

## 2. Goals
- Provide a simple dashboard for managing common homelab services.
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
│   └── /cloudflare-tunnel
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
- Project scaffold
- Docker Compose setup for frontend, API, and database
- Database schema
- Authentication flow
- First-time admin setup
- Basic dashboard shell

### Milestone 2: Service Management
- Service config loading
- Start/stop script execution
- Service status API
- Frontend service grid
- Loading and error states

### Milestone 3: Administration
- User management
- Audit logs
- Permission checks
- Backup/export features

### Milestone 4: Reliability and UX
- Health checks
- Real-time updates
- Recovery workflows
- UI polish and mobile refinement

## 14. Implementation Tasks

### Phase A: Infrastructure and Containerization
- Create a root `docker-compose.yml` for frontend, backend, and database.
- Add Dockerfiles for the Angular app and Node.js API.
- Define persistent volumes for the database and configuration data.
- Add container networking so the frontend can reach the API and the API can reach the database.
- Add environment variable handling for secrets, API URLs, and database connection settings.

### Phase B: Database and Auth Foundation
- Design the database schema for users, roles, settings, and service definitions.
- Implement the first-admin bootstrap flow.
- Add JWT login, logout, and route protection.
- Create middleware for checking whether setup mode is still enabled.

### Phase C: Service Management Backend
- Create an allowlisted service registry.
- Implement start/stop endpoints using asynchronous `child_process` execution.
- Add status aggregation logic for Docker container state and service metadata.
- Normalize error handling and return consistent API responses.
- Add structured logging for service operations.

### Phase D: Frontend Dashboard
- Build the login and first-time setup pages.
- Build the dashboard shell and service grid.
- Add start/stop buttons with loading states.
- Add status indicators and refresh behavior.
- Create the Cloudflare token settings panel.
- Add admin user management screens.

### Phase E: Operational Features
- Add audit logging.
- Add backup and restore workflows.
- Add optional health checks.
- Add WebSocket or SSE support for live updates.
- Add recovery mode and admin reset tooling.

### Phase F: Hardening and Delivery
- Add validation and security checks for all inputs.
- Test Dockerized deployment end-to-end.
- Document setup, deployment, and recovery steps.
- Add smoke tests for the startup flow and service control APIs.

## 15. Acceptance Criteria
- A new installation can create its first admin account safely.
- An authenticated admin can view and manage services.
- Start and stop actions run asynchronously without blocking the API.
- Service status is visible and refreshes correctly.
- Cloudflare token settings can be saved and updated.
- The frontend, API, and database run in Docker containers.
- The system is structured for backups and recovery.
