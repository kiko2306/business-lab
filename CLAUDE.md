# Homelab Management

Angular dashboard + Node/Express (TypeScript) API + Postgres, all in Docker, that
starts, stops, configures and exposes ~36 self-hosted apps living under `apps/`.
The host runs Docker; the dashboard drives it.

## Non-negotiable principles

These come from `plan.md` §0 and constrain every change. If a design can't meet
them, it doesn't ship until it can.

1. **No router changes.** No port forwarding, no static WAN IP/DDNS, no firewall
   rules. All ingress is the Cloudflare Tunnel, or the overlay VPNs for peers.
2. **No console configuration.** The only command a human runs on the host is
   `./start.sh`. Everything else — credentials, exposure, per-app config,
   secrets — is entered and applied through the dashboard UI. No hand-edited
   YAML/env/conf, no `docker exec`, no `cscli` steps in a runbook.
3. **Automate everything automatable.** If the system has enough information to
   derive or generate a setting, it must do so with no user step. Prompt only
   for what it genuinely cannot obtain (e.g. a third-party API token) — and then
   in the UI, once.

Fixing something by hand on the live host is a diagnostic, never a fix: it
evaporates on the next fresh clone, since `apps/*/data/` is gitignored. Once it
works by hand, delete it and make the code do it, then prove the code path.

## plan.md is the project's memory

`plan.md` (~8800 lines) is the spec **and** the running session log. Numbered
sections; new work is appended as a new `## NN. ...` section. Read the tail
before starting — the last section usually says where things stand and what to
pick up. Record what was tried and rejected, not just what landed. Never rewrite
history in it; append.

## Commands

**There is no Node on this host** — everything runs in containers. Mount the
repo root (not just the workspace: some tests resolve paths up to it) and run
the workspace script inside `node:20`:

```bash
docker run --rm -v "$PWD":/repo -w /repo/backend node:20 npm test
```

Swap `npm test` for `npm run typecheck`, or `-w /repo/frontend` with
`npm run test:ci` / `npm run build`. `./scripts/smoke-tests.sh` runs on the host
against an already-running backend.

CI (`.github/workflows/ci.yml`) runs backend typecheck+test, frontend
test:ci+build, and `apps/price-compare/app` tests; the smoke tests are
local-only. Run the affected workspace's checks before saying a change is done.

## After a change lands, commit and push

When an implementation is done and verified — the affected workspace's checks
pass, and anything touching Docker/exposure/networking/backups has been proven
against the real stack — commit it and push to `main`. Don't leave finished work
sitting uncommitted, and don't batch several unrelated changes into one commit:
one commit per coherent change, pushed as it lands.

Verified is the gate. A change that type-checks but hasn't been run is not done,
and does not get committed as though it were. If something is half-finished, say
so and leave it uncommitted rather than pushing a checkpoint.

Check `git status` before committing — the repo is public, and `.env` files must
never be in the diff.

## Layout

| Path | What |
|---|---|
| `backend/src/config/services.ts` | The service registry — allowlist of every manageable app. Adding an app starts here. |
| `backend/src/services/` | Business logic: compose execution, exposure, backups, per-app config generation. |
| `backend/src/routes/` | Express routes, thin. |
| `frontend/src/app/` | Angular 18 standalone components, Bootstrap 5. |
| `apps/<name>/` | One compose project per app: `docker-compose.yml`, `.env.example`, gitignored `.env` + `data/`. |
| `docs/` | Operator docs — `ports.md`, `app-credentials.md`, `first-run.md` are kept current, not aspirational. |
| `start.sh` | Host bootstrap: daemon config, port allocation, first run. |

## Conventions

- **Tests** live beside the code as `*.test.ts` (vitest, backend). Cover the
  parsing/derivation logic; don't test Docker itself.
- **Comments explain why, not what.** This codebase leans on them heavily — a
  non-obvious port pin, a dependency ordering, a workaround for upstream
  behaviour all get a sentence saying what breaks without it. Match that.
- **Ports** follow `docs/ports.md`: core stack `10000`–`10099`, managed apps
  `10100`+ alphabetically in tens. Below `10000` is deliberate and documented
  (NPM `80`/`443`, Pi-hole `53`, Home Assistant `8123`) — the allocator only
  manages compose defaults `>= 10000`.
- **Adding an app**: `apps/<name>/` with compose + `.env.example`, an entry in
  `services.ts`, a port per the scheme, and rows in `docs/ports.md` and
  `docs/app-credentials.md`.
- **Commits**: imperative, sentence case, describing the outcome — "Fix the VPN:
  port renumbering left Tailscale Funnel pointing at a dead port". No
  conventional-commit prefixes; `plan:` prefix for plan.md-only commits.

## Never

- Commit any `.env`, secret, token or password. The repo is **public**
  (`kiko2306/homelab-management`). `.env.example` templates only.
- `docker compose down` the management stack — it tears down the running
  dashboard. Restart individual services instead.
- Edit an app's compose file from backend code. Backend generates `.env` files
  (`appEnv.ts`) and managed config files; compose files are read-only to it.
- Claim something works because it type-checks. This project's history is full
  of things that passed CI and failed on the host — verify against the real
  stack when the change touches Docker, exposure, networking or backups.

The first two of those are enforced, not just asked for. `.claude/settings.json`
denies the Read/Edit/Write tools on `.env` files, and `.claude/hooks/bash-guards.sh`
covers what per-tool rules cannot: it refuses a root `docker compose down`, and
refuses a shell command that reads or writes a real `.env` (`.env.example`
templates, `ls`, `find` and `git` are left alone). A refusal from either is the
rule working — find another way rather than routing around it.
