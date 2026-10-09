# Homelab Management

Angular dashboard + Node/Express (TypeScript) API + Postgres, all in Docker. Start, stop, configure, show ~36 self-host app live under `apps/`. Host run Docker. Dashboard drive it.

## Non-negotiable principles

From `plan.md` §0. Bind every change. Design no meet them? No ship until can.

1. **No router changes.** No port forward, no static WAN IP/DDNS, no firewall rule. All ingress be Cloudflare Tunnel, or overlay VPN for peer.
2. **No console configuration.** Only command human run on host be `./start.sh`. Everything else — credential, exposure, per-app config, secret — go in through dashboard UI. No hand-edit YAML/env/conf, no `docker exec`, no `cscli` step in runbook.
3. **Automate everything automatable.** System have enough info to derive or make setting? Must do it, no user step. Ask only for what truly cannot get (e.g. third-party API token) — and then in UI, once.

Fix thing by hand on live host be diagnostic, never fix: it vanish on next fresh clone, because `apps/*/data/` be gitignored. Once work by hand, delete it, make code do it, then prove code path.

## `tx-home-utils.com` be no-guarantees dev/test box

No uptime guarantee, no data-durability guarantee. Service down: fine. Data vanish: fine. It exist to prove code path against real stack. No build feature, test or doc that assume state there survive, or that service stay up.

Internet-exposed be **not** what make it dev/test. Production / per-client deployment be also internet-exposed, same Cloudflare Tunnel + NPM model, but **separate deployment** with own domain and credential — there uptime and client data do matter. Difference be promise, not exposure.

## plan.md is the project's memory

`plan.md` be spec **and** session log. Numbered section; new work append as new `## NN. ...` section. Record what tried and rejected, not just what land (§75.7) — that half be what keep section worth read later.

Read **one section at time, never whole**: `./scripts/plan-section.sh <N>` (or `<first> <last>` for run). It find section from `plan.md` own heading, so look up §649 no mean load all 78 KB of `plan-index.md` for one `sed` range. `grep -n` that index when section number unknown; never `Read` it whole. Re-run `./scripts/plan-index.sh` after append or squash.

## Commands

**No Node on this host** — everything run in container. `./scripts/check.sh <backend|frontend> <test|typecheck|build>`. It find repo root itself; mounting `$PWD` direct break, because some backend test resolve path up to repo root. `frontend test` build `business-lab-frontend-test` image on first use (plain `node:20` miss Chrome and library headless Chrome need). Rebuild that image (`docker build -t business-lab-frontend-test -f frontend/Dockerfile.test frontend`) when `frontend/package-lock.json` `puppeteer` version change — `Dockerfile.test` pin match Chrome download.

`./scripts/smoke-tests.sh` run on host against already-run backend. CI run backend typecheck+test, frontend test:ci+build, `apps/price-compare/app` test, and Playwright E2E (`scripts/e2e-tests.sh`); smoke test no in CI. Run affected workspace check before say change done. Run `scripts/e2e-tests.sh` when change touch auth, shell/nav, Users page or 2FA flow.

## Session cost: cheap by default

Every token in context be re-read every turn, so startup size and session length drive usage limit (`docs/session-habits.md`, plan.md §894, §909).

- **One task per session**, then fresh. Prefer `/compact` over `/clear`.
- **Delegate wide work.** `locate` agent (pinned Haiku) for "where is X / what calls Y" instead of inline Grep fan-out. `checks` agent (pinned Haiku) to run `scripts/check.sh` — green run come back three line instead of thousand. Both in `.claude/agents/`.
- **Trim output.** Pipe log through `tail -n 40` or `grep`; read only failing line.
- **No `cd <repo> &&` prefix.** Shell already start in repo root, and permission rule match command string from start, so that prefix turn an allowed `grep` into fresh prompt. 2221 of 14279 past Bash call carry it. Use plain command, or absolute path as argument.
- **Read narrowly.** `plan-section.sh` for plan.md. SessionStart hook already list open item — no re-read README TODO to find them.

## Commits go to `dev`; `dev` → `beta` → `main`

All work commit to rolling `dev` — never straight to `beta` or `main`. `dev` always safe to push: every change land there once affected workspace check pass. Live-stack verify be **not** gate for `dev`. No leave finished work uncommitted; one commit per coherent change, push as it land.

Merge `dev` into `beta` only when commit truly give user something new to test there — it touch Docker/exposure/network/backup, or finish slice now reachable end-to-end. Doc/plan-only fix, or backend-only slice nothing yet expose, stay on `dev` and wait for change that make it reachable. Judgment call each time, not fixed file-path list.

When commit clear that bar, merge be **only** merge and push (fast-forward when can) — no rebuild, no restart, no live-stack test, no need ask permission. User pull code onto run box themself via dashboard self-update panel (Update page, track `beta`) — that trigger be theirs, not yours. Say plain when merge land, and that README listed test still need run before `main`. Say it too when you hold commit back from `beta`.

`beta` → `main` happen only when user explicit ask for `beta` test and that test pass — that ask-and-pass be go-ahead, no separate confirm. Run exactly what README item describe; one fail, report it and no merge. Never test `beta` or merge to `main` on own idea.

Branch off `dev` to isolate spike or throwaway experiment; merge back into `dev`, and delete branch once it serve purpose. Check `git status` before commit — repo be public, `.env` must never be in diff.

## The working loop

1. **Take open item from SessionStart hook list.** It print agent-actionable item already, plus count of host-verify queue. Read item full text — deliberately long, "what to check and how" be point — only for one being pick up. Host-verify item be user's to run; no propose them.
2. **Propose.** Name task you would do next, or short list to choose from. No pick one and start.
3. **Implement, test first**: write test that describe change, run it, watch it fail for right reason, then write code and run it green. Behaviour cannot exercise in container (host file ownership, live Authelia/NPM, Windows agent)? Say so before code, and either pull logic out so it can test or name README beta-test that carry proof. Compose-only or doc-only change have no unit-test surface; its README beta item be test.
4. **Update `plan.md` and `README.md`.** New numbered section say what done and why; finished item **deleted** from README; re-run `./scripts/plan-index.sh`. Scale section to work — real hunt get full story with what tried and rejected; mechanical item get few line. Pad trivial item to look like hunt be exactly cost this rule avoid. Change touch Docker/exposure/network/backup? Add README item naming what must test on `beta` and how.
5. **Commit and push to `dev`** once affected check pass, then apply branch rule above.
6. **Back to step 1** — unless item be part of pre-approved batch, then take next in batch with no re-propose.

Work arrive as list rather than single task? Planning pass before step 2: append plan to `plan.md`, add each piece to README, then propose. Intent then survive session that get cut off, and build order stay user call.

Proposal can ask batch approval: name several independent, already-planned item, run all through step 3-5 with no stop between. Each still get own step 4 record and own step 5 commit. Save it for item truly independent (no item output feed next); stop batch moment one outcome change what later one should do.

## TODOs live in README.md, and get deleted

`README.md` TODO section be **only** place open work track — no `// TODO` comment, no second list in `plan.md`, no note in doc page.

Item finish: **delete it**. No tick box left behind — done work be what `plan.md` and `git log` for. Same for item that turn out wrong or no longer want; say why in commit message.

New work found mid-task go in as new item, no fix in passing, unless truly part of change at hand.

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

## Never

- Commit any `.env`, secret, token or password. Repo be **public** (`kiko2306/business-lab`). `.env.example` template only.
- `docker compose down` **at repo root** — it tear down run dashboard (frontend, backend, database, socket proxy). Restart individual service instead. `docker compose down` on *managed app* own project be fine — it how app get stopped, and how removed app leftover get cleaned (`removedAppCleanup.ts`).
- Edit app compose file from backend code. Backend make `.env` file (`appEnv.ts`) and managed config file; compose file be read-only to it.
- Claim something work because it type-check. This project history full of thing that pass CI and fail on host — verify against real stack when change touch Docker, exposure, network or backup.
- Assume data on `tx-home-utils.com` safe or service there stay up. Production be separate, per-client deployment.

SessionStart hook print the enforced guard each session — those refusal be rule work, so find another way rather than route around.

`VERSION` be single truth source: backend read it live from bind-mount checkout and serve at `GET /version` (plan.md §343), so version-only bump deploy as bare `git pull`, no rebuild. `package.json` version field frozen — do **not** bump them. Bump with `scripts/bump-version.sh <patch|minor> <Category> "<bullet>"`, never hand-edit the three file; review its diff before commit.

## Agent skills

- **Issue tracker** — GitHub Issues (`kiko2306/business-lab`) via `gh`, for mattpocock skill only. README TODO stay tracker for this repo own loop. `docs/agents/issue-tracker.md`.
- **Triage labels** — default five-label vocabulary. `docs/agents/triage-labels.md`.
- **Domain docs** — single-context. `docs/agents/domain.md`.

## Caveman Behavior Rules

These override any conflicting rule above.

- **Commits:** Execute `caveman-commit`. Max 50 chars. Lowercase. No trailing periods (e.g. `feat(api): add post route`).
- **Plan Maintenance:** Execute `caveman-compress` on `plan.md`. No fluff word. Bracket for state: `[x] done`, `[-] active`, `[ ] todo`.
- **Chat:** Reply in short fragment. Never say "Sure, I can help."
