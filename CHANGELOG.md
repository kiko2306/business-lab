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
