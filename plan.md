# Context: Multi-Container Homelab Management System (Angular + Node.js)

## System Architecture & Tech Stack
*   **Frontend**: Angular (latest stable) with a clean dashboard UI.
*   **Backend**: Node.js with Express API.
*   **Database**: SQLite or PostgreSQL (Preferred over MySQL for homelabs due to easy backups and low resource footprint).
*   **Host Environment**: Linux machine running Docker and Bash.

## Directory Structure Strategy
The project must adhere strictly to this layout:
/homelab-manager
│
├── /apps                     # Individual service definitions
│   ├── /nginx-proxy-manager  # Kebab-case friendly folder names
│   ├── /netbird-vpn
│   ├── /home-assistant
│   └── /cloudflare-tunnel
│
├── /scripts                  # Bash scripts for host-level management
│   ├── start-container.sh    # Accepts app folder name as argument
│   ├── stop-container.sh     # Accepts app folder name as argument
│   └── update-container.sh   # Pulls latest image and restarts
│
├── /backend                  # Node.js Express API
└── /frontend                 # Angular Application


Service Start Sequence Diagram
[ Angular Frontend ]            [ Node.js API ]             [ Linux Host ]

          |                             |                          |
          |  1. Click "Start" Button    |                          |
          |---------------------------->|                          |
          |                             |  2. Execute Bash Script  |
          |                             |     (child_process)      |
          |                             |------------------------->|
          |                             |                          |
          |                             |  3. Run:                 |
          |                             |     start-container.sh   |
          |                             |     [app-name]           |
          |                             |---------\\                |
          |                             |         | (Docker Spins  |
          |                             |         |  Up Container) |
          |                             |         |< /             |
          |                             |                          |
          |                             |  4. Script execution     |
          |                             |     success (Exit 0)     |
          |                             |<-------------------------|
          |                             |                          |
          |  5. HTTP 200 OK Response    |                          |
          |<----------------------------|                          |
          |                             |                          |
          |  6. Trigger Status Refresh  |
          |---------\\                   |                          |
          |         | (Polling / WS)    |                          |
          |         |< /                |                          |
          |                             |                          |
          |  7. GET /api/services/status|                          |
          |---------------------------->|                          |
          |                             |  8. Run: docker ps       |
          |                             |------------------------->|
          |                             |  9. Active containers list|
          |                             |<-------------------------|
          |                             |                          |
          |  10. Return JSON Payload    |                          |
          |      (Status: "Running")    |                          |
          |<----------------------------|                          |
          |                             |                          |
          |  11. Update UI Grid         |                          |
          |      (Green Indicator)      |
          |---------\\                   |                          |
          |         |                   |                          |
          |         |< /                |                          |
          |                             |                          |


Asynchronous Handling: Step 2 must use an asynchronous execution method (like exec or spawn) so the API doesn't lock up or timeout if the Docker container takes a few seconds to initialize.
Error Catching: If Step 4 fails (e.g., the script returns an exit code other than 0), the API should catch the stderr stream and return an HTTP 500 Internal Server Error containing the exact Docker error message for debugging.

## Functional Requirements & User Flows

### 1. Initialization & Authentication
*   **First-Time Launch**: If no users exist in the database, intercept all routes and force the user to a "Create Admin Account" page.
*   **Subsequent Logins**: Standard JWT-based authentication. Successful login redirects to `/dashboard`.

### 2. Angular Dashboard Capabilities
*   **User Management**: Admin users can create, view, and delete other user accounts.
*   **Service Control Grid**: 
    *   Display a grid of available services (Nginx, Netbird, Home Assistant, etc.).
    *   Show a real-time status indicator (Running/Stopped) for each service.
    *   Provide explicit "Start" and "Stop" buttons for each service.
*   **Settings Panel**: An input field to save/update the Cloudflare Tunnel Token.

### 3. Node.js API & Bash Integration
*   The API must securely execute the host's Bash scripts using Node's `child_process` (`exec` or `spawn`).
*   **Endpoint POST `/api/services/:name/start`**: Triggers `../scripts/start-container.sh [name]`.
*   **Endpoint POST `/api/services/:name/stop`**: Triggers `../scripts/stop-container.sh [name]`.
*   **Endpoint GET `/api/services/status`**: Scans the `/apps` directory, checks active docker containers via `docker ps`, and returns a consolidated JSON payload of service states to the Angular frontend.

## Cloudflare Reference (For Copilot Configuration)
To configure the Cloudflare Tunnel securely, the token used in the input field requires specific API permissions. Ensure the generated setup script uses these scoped permissions:
*   **Account -> Cloudflare Tunnel -> Edit** (To create and manage the tunnel configuration).
*   **Zone -> DNS -> Edit** (To automatically point your public domains to the tunnel).


## Suggested Improvements to Add

### 1. MVP Scope
Split the project into phases:
- **MVP**: admin bootstrap, login/logout, service list, start/stop actions, status refresh, Cloudflare token settings.
- **Phase 2**: audit logs, health checks, WebSocket updates, backups, and export/import.
- **Nice-to-have**: service templates, theming, mobile layout refinements.

### 2. Service Metadata Configuration
Instead of hardcoding services, define a config file per service with:
- service name
- folder path
- docker compose file
- display label
- icon
- healthcheck method

### 3. Better Status Model
Use richer service states:
- `running`
- `stopped`
- `starting`
- `error`
- `unknown`

### 4. Health Checks
Do not rely only on `docker ps`. Prefer:
- Docker API/container status
- app-level health endpoint
- optional uptime and restart count

### 5. Command Safety
Because scripts will be executed from the API:
- use an allowlist of service names
- validate and normalize paths
- never pass raw user input directly to shell commands
- log every command execution

### 6. UI Feedback for Actions
When a user starts/stops a service:
- disable the button while the action runs
- show a spinner/progress indicator
- show success/failure toast messages
- auto-refresh status after the action completes

### 7. Audit Logging
Track:
- who started/stopped which service
- time of action
- success/failure
- error output summary

### 8. Setup Flow Isolation
Make first-time setup explicit:
- middleware checks if an admin exists
- if not, only allow `/setup`
- after setup, lock it down or require an emergency recovery mode for re-entry

### 9. Backup and Persistence Plan
Add support for:
- database backups
- config backups
- export/import of settings
- recovery steps if the host fails

### 10. Cloudflare Token UX
Improve the settings panel with:
- masked token input
- show/hide toggle
- test connection button
- validation feedback
- explanation of required permissions

### 11. API Design Details
Specify:
- request/response format
- error format
- auth requirements per endpoint
- rate limiting on auth endpoints

### 12. Docker Compose Standardization
If each app folder contains a `compose.yml`, scripts can standardize on:
- `docker compose up -d`
- `docker compose down`
- `docker compose pull && docker compose up -d`

### 13. Recovery / Admin Reset
Add a local recovery path:
- reset admin password from CLI
- re-enable setup mode if no users exist
- emergency local-only access mode

### 14. Real-Time Updates
Use:
- WebSockets
- Server-Sent Events
- polling fallback

That gives a smoother dashboard experience.
