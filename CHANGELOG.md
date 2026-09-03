# Changelog

All notable changes to Business Lab are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[semantic](https://semver.org/) but pre-1.0, so a **minor** bump marks a new
user-facing feature or a breaking change and a **patch** bump marks a fix or a
small internal change. `MAJOR` stays `0` until a `1.0.0` is declared
deliberately.

The version here is the single source of truth for the string shown in the
dashboard footer; `backend/package.json` and `frontend/package.json` carry the
same value and the backend serves it at `GET /version`.

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
