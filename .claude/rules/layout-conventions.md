---
paths:
  - "backend/src/**"
  - "frontend/src/**"
  - "apps/**"
  - "docs/**"
  - "start.sh"
---

## Layout

| Path | What |
|---|---|
| `backend/src/config/services.ts` | Service registry — allowlist of every manageable app. Add app start here. |
| `backend/src/services/` | Business logic: compose run, exposure, backup, per-app config make. |
| `backend/src/routes/` | Express route, thin. |
| `frontend/src/app/` | Angular 18 standalone component, Bootstrap 5. |
| `apps/<name>/` | One compose project per app: `docker-compose.yml`, `.env.example`, gitignored `.env` + `data/`. |
| `docs/` | Operator doc — `ports.md`, `app-credentials.md`, `first-run.md`, `licences.md` keep current, not dream. |
| `start.sh` | Host bootstrap: daemon config, port allocation, first run. |
| `.claude/agents/` | `locate` and `checks`, both pinned Haiku. |
| `plan-index.md` | Made map of `plan.md` — section title and `sed` range for each. |

## Conventions

- **Tests** live beside code as `*.test.ts` (vitest, backend). Cover parse/derive logic; no test Docker itself.
- **Comments explain why, not what.** This codebase lean on them heavy — non-obvious port pin, dependency order, workaround for upstream behaviour all get sentence say what break without it. Match that.
- **Ports** follow `docs/ports.md`: core stack `10000`–`10099`, managed app `10100`+ alphabetical in ten. Below `10000` be on purpose and documented (NPM `80`/`443`, Pi-hole `53`, Home Assistant `8123`) — allocator only manage compose default `>= 10000`.
- **Adding an app**: compose + `.env.example` in `apps/<name>/`, `services.ts` entry, port per scheme, rows in `docs/ports.md`, `docs/app-credentials.md` **and `docs/licences.md`** (licence check mandatory; AGPL/fair-code/source-available/non-software ToS = no go in).
- **Exposure is automatic** (`plan.md` §331). No per-app toggle, no `PUT …/exposure`; `ensureAutoExposure()` set `enabled` from `getExposability()`. `lanOnly` and `overlayOnly` stay off tunnel.
- **Exposed running apps get a Home Page tile** from `homepageConfig.ts`; `homepage.*` compose label (`group`, `name`, `icon`, `description`, `href`) mandatory, `hideFromHomePage: true` for support-only app.
- **Dependencies** in `services.ts`: `dependsOn` = cannot boot without (block start); `requires` = need for its job (warn only). Never declare `nginx-proxy-manager`.
- Full rules for the last four: `docs/app-conventions.md`.
