# Homelab Management

Angular dashboard + Node/Express (TypeScript) API + Postgres, all in Docker. Start, stop, configure, show ~36 self-host app live under `apps/`. Host run Docker. Dashboard drive it.

## Non-negotiable principles

These come from `plan.md` §0. Bind every change. Design no meet them? No ship until can.

1. **No router changes.** No port forward, no static WAN IP/DDNS, no firewall rule. All ingress be Cloudflare Tunnel, or overlay VPN for peer.
2. **No console configuration.** Only command human run on host be `./start.sh`. Everything else — credential, exposure, per-app config, secret — go in through dashboard UI. No hand-edit YAML/env/conf, no `docker exec`, no `cscli` step in runbook.
3. **Automate everything automatable.** System have enough info to derive or make setting? Must do it, no user step. Ask only for what truly cannot get (e.g. third-party API token) — and then in UI, once.

Fix thing by hand on live host be diagnostic, never fix: it vanish on next fresh clone, because `apps/*/data/` be gitignored. Once work by hand, delete it, make code do it, then prove code path.

## This host is a no-guarantees dev/test box

Deployment this repo grow against — `tx-home-utils.com` — have **no uptime guarantee and no data-durability guarantee**. Service go down on it: fine. Data change or vanish: fine. It exist to prove code path against real stack (principle 3 above). Everything on it throwaway. No build feature, test, or doc that assume state on this host survive, or that service must stay run.

Internet-exposed be **not** what make it dev/test. Production / per-client deployment be *also* internet-exposed — same Cloudflare Tunnel + NPM model — but be **separate deployment** with own domain and own credential/token, and there uptime and client data do matter. Difference be promise, not exposure.

Verification model unchanged: this box be what `beta`'s README-listed test run against — user pull `beta` onto it via self-update panel and ask for test — before anything go to `main`. That exactly what no-guarantees dev/test box for.

## plan.md is the project's memory

`plan.md` be spec **and** run session log. Numbered section; new work append as new `## NN. ...` section. Read tail before start — last section usually say where thing stand and what to pick up. Record what tried and rejected, not just what land.

It read **one section at time, never whole**. To read one, use `./scripts/plan-section.sh <N>` (or `<first> <last>` for run) — it find section from `plan.md` own heading, so look up §649 no mean load all 62 KB of `plan-index.md` to get one `sed` range out. `plan-index.md` still be map to *browse* when number unknown: it list every section with `sed` range, and regenerate with `./scripts/plan-index.sh` after append or squash. Record of what tried and rejected be half that keep matter (§75.7) — squash keep that, just drop iteration detail once code be truth source. Nothing load file automatic anyway.

## Commands

**No Node on this host** — everything run in container. Use `./scripts/check.sh <backend|frontend> <test|typecheck|build>`, e.g. `./scripts/check.sh backend test` or `./scripts/check.sh frontend test`. It find repo root itself, so work even if shell cwd drift into `backend/` or `frontend/` — mount `$PWD` direct break there, because some backend test resolve path up to repo root, not just own workspace. `frontend test` build `business-lab-frontend-test` image on first use if missing (Karma/Jasmine + headless Chrome no run on plain `node:20` — no Chrome, and `node:20` Debian base miss shared library headless Chrome need). `./scripts/smoke-tests.sh` run on host against already-run backend.

Rebuild `business-lab-frontend-test` (`docker build -t business-lab-frontend-test -f
frontend/Dockerfile.test frontend`) if `frontend/package-lock.json` `puppeteer` version change (`Dockerfile.test` pin match Chrome download).

CI (`.github/workflows/ci.yml`) run backend typecheck+test, frontend test:ci+build, `apps/price-compare/app` test, and browser E2E job (`scripts/e2e-tests.sh` — Playwright against `docker-compose.test.yml` stack). Host-only smoke test (`scripts/smoke-tests.sh`) no in CI. Run affected workspace check before say change done; run `scripts/e2e-tests.sh` when change touch auth, shell/nav, Users page or 2FA flow.

## Commits go to `dev`; `dev` → `beta` → `main`

Real branch flow have three stage: `dev` → `beta` → `main`. All work commit to rolling `dev` branch — never straight to `beta` or `main`.

`dev` always safe to commit and push to — that what it for. Every change and new feature go there as it land, once affected workspace check (typecheck/test) pass; live-stack verify be **not** gate for `dev`. No leave finished work sit uncommitted, and no batch several unrelated change into one commit: one commit per coherent change, push as it land. Beside it, add to README TODO exactly what still need test on `beta` before change trustworthy there (what to check, and how) — same item delete once that test pass, per TODO rule below.

Merge `dev` into `beta` only when commit truly give user something new to test there — it touch Docker/exposure/network/backup, or else finish slice that now reachable/usable end-to-end. Doc/plan-only fix, or backend-only slice nothing yet expose (e.g. API endpoint build before frontend or exposure that reach it), stay on `dev` and wait — merge into `beta` together with, or right after, change that truly make it reachable. This be judgment call each time, not fixed list of file path.

When commit do clear that bar, merge be **only** merge and push (fast-forward when can) — no rebuild, no restart, no live-stack test on own idea, and no need ask permission first (judgment call above be only gate). User pull that code onto run box themself, via dashboard own self-update panel (Update page, track `beta` branch) — that update be theirs to trigger, not yours. Every time merge to `beta` land, say so plain and flag that README listed test still need run there before `main`.

`beta` → `main` happen only when user explicit ask for `beta` test and that test pass — that ask-and-pass be go-ahead, not separate confirm on top. Run exactly check README item describe; if one fail, report what fail and no merge. Never test `beta` or merge to `main` on own idea.

Branch off `dev` as much as need to keep something isolated mid-hunt (spike, throwaway experiment); merge back into `dev`, not `beta` or `main`, and delete branch once it serve purpose.

Check `git status` before commit — repo be public, and `.env` file must never be in diff.

## The working loop

Every task run through same six step, in order, every time:

1. **Read the README TODO list.** It be source of what open — not memory, not last thing talked. Read cheap way: `grep -n '^- \[ \] \*\*' README.md` list every open item headline in ~40 line, against ~30 KB for whole section. Read item full text — deliberately long, because "what to check and how" be point — only for one being pick up.
2. **Propose.** Name task you would do next, or show short list to choose from. No pick one and start.
3. **Implement** — that one task, **test first**: write test that describe change, run it and watch it fail for right reason, then write code and run it green. If behaviour cannot exercise in container (host file ownership, live Authelia/NPM, Windows agent), say so before code and either pull logic out so it can test or name README beta-test that carry proof. Compose-only or doc-only change have no unit-test surface; its README beta item be test.
4. **Update `plan.md` and `README.md`.** New numbered `plan.md` section say what done and why, finished item **deleted** from README list, and `./scripts/plan-index.sh` re-run so index cover new section. Scale section to work: real hunt or decision get full story, include what tried and rejected — that record be what make section worth read later. Small, mechanical item (rename, one-line config fix, something with no dead end behind) get few line: what change and why, no more. Pad trivial item to look like hunt be exactly token/session-time cost this rule should avoid. If change touch Docker/exposure/network/backup, also add README TODO item name exactly what must test on `beta` and how — delete it once that test pass.
5. **Commit and push to `dev` once the affected workspace's checks pass.** `dev` have no live-stack gate; push as it land. Then merge into `beta` only if this commit truly give user something new to test there (touch Docker/exposure/network/backup, or finish slice that now reachable/usable end-to-end) — doc/plan-only fix or backend-only slice nothing yet expose stay on `dev` and wait for change that make it reachable. When it do clear that bar, merge be only merge and push, done without ask each time — no rebuild, no live-stack test here. Say plain that merge land and that README listed test still need run on `beta` before `main`; if you hold commit back from `beta`, say that too. `beta` → `main` be separate step, trigger only by user explicit ask for `beta` test — do that test, and merge only on pass; never on own idea.
6. **Back to step 1.** Report, re-read list, propose again — unless item just finish be part of pre-approved batch (below), then move to next item in that batch with no re-propose.

When work arrive as list rather than single task, slip planning pass before step 2: append plan to `plan.md`, add each piece to README list, and then propose. That way intent survive session that run long or get cut off, and order thing build in stay user call.

That proposal can ask for batch approval: name several independent, already-planned item and ask to run all through step 3-5 with no stop to re-propose each. Each item still get own step 4 (sized per rule above) and own step 5 commit — batch remove between-item pause, not per-item record or one-commit-per-change rule. Save it for item truly independent (no item output feed next) and already agreed in plan just proposed; stop batch and re-propose moment one item outcome change what later one should do. Default to un-batched loop — batch only when ask for, or when propose list of small, clear independent item where re-ask after each be pure overhead.

## TODOs live in README.md, and get deleted

`README.md` TODO section be **only** place open work track. Not scattered `// TODO` comment, not second list in `plan.md`, not note in doc page — if it be outstanding work, it be item there.

When item finish, **delete it**. No tick box and leave behind: list of done work be what `plan.md` and `git log` for, and README carry both open and closed item stop being readable as list of what left. Same go for item that turn out wrong or no longer want — delete it, and say why in commit message.

New work found mid-task go in as new item rather than fix in passing, unless it truly part of change at hand.

## Layout

| Path | What |
|---|---|
| `backend/src/config/services.ts` | Service registry — allowlist of every manageable app. Add app start here. |
| `backend/src/services/` | Business logic: compose run, exposure, backup, per-app config make. |
| `backend/src/routes/` | Express route, thin. |
| `frontend/src/app/` | Angular 18 standalone component, Bootstrap 5. |
| `apps/<name>/` | One compose project per app: `docker-compose.yml`, `.env.example`, gitignored `.env` + `data/`. |
| `docs/` | Operator doc — `ports.md`, `app-credentials.md`, `first-run.md`, `licences.md` keep current, not dream. `licences.md` get row per app **and per image** on every add (see Conventions). |
| `start.sh` | Host bootstrap: daemon config, port allocation, first run. |
| `plan-index.md` | Made map of `plan.md` — section title and `sed` range for each. |

## Conventions

- **Tests** live beside code as `*.test.ts` (vitest, backend). Cover parse/derive logic; no test Docker itself.
- **Comments explain why, not what.** This codebase lean on them heavy — non-obvious port pin, dependency order, workaround for upstream behaviour all get sentence say what break without it. Match that.
- **Ports** follow `docs/ports.md`: core stack `10000`–`10099`, managed app `10100`+ alphabetical in ten. Below `10000` be on purpose and documented (NPM `80`/`443`, Pi-hole `53`, Home Assistant `8123`) — allocator only manage compose default `>= 10000`.
- **Adding an app**: compose + `.env.example` in `apps/<name>/`, `services.ts` entry, port per scheme, rows in `docs/ports.md`, `docs/app-credentials.md` **and `docs/licences.md`** (licence check is mandatory; AGPL/fair-code/source-available/non-software ToS = no go in). Full rules: `docs/app-conventions.md`.
- **Exposure is automatic (`plan.md` §331).** No per-app toggle, no `PUT …/exposure`; `ensureAutoExposure()` sets `enabled` from `getExposability()`. `lanOnly` and `overlayOnly` stay off tunnel. Details: `docs/app-conventions.md`.
- **Exposed running apps get a Home Page tile** from `homepageConfig.ts`; `homepage.*` compose labels (`group`, `name`, `icon`, `description`, `href`) are mandatory, `hideFromHomePage: true` for support-only apps. Details: `docs/app-conventions.md`.
- **Dependencies** in `services.ts`: `dependsOn` = cannot boot without (blocks start); `requires` = needs for its job (warns only). Never declare `nginx-proxy-manager`. Details: `docs/app-conventions.md`.

## Never

- Commit any `.env`, secret, token or password. Repo be **public** (`kiko2306/business-lab`). `.env.example` template only.
- `docker compose down` **at repo root** — it tear down run dashboard (frontend, backend, database, socket proxy). Restart individual service instead. `docker compose down` on *managed app* own project be fine — it how app get stopped, and how removed app leftover get cleaned (`removedAppCleanup.ts`).
- Edit app compose file from backend code. Backend make `.env` file (`appEnv.ts`) and managed config file; compose file be read-only to it.
- Claim something work because it type-check. This project history full of thing that pass CI and fail on host — verify against real stack when change touch Docker, exposure, network or backup.
- Assume data on `tx-home-utils.com` safe or that service there must stay up — it be no-guarantees dev/test box (see section above). Production be separate, per-client deployment.

First two of those enforced, not just asked for. `.claude/settings.json` deny Read/Edit/Write tool on `.env` file, and `.claude/hooks/bash-guards.sh` cover what per-tool rule cannot: it refuse `docker compose down` aimed at repo root (down target file under `apps/` allowed), and refuse shell command that read or write real `.env` (`.env.example` template, `ls`, `find` and `git` left alone). Refusal from either be rule work — find another way rather than route around it.

Version-bump rule enforced same way: `.claude/hooks/require-version-bump.sh` block `git commit` that change non-test file under `backend/src` or `frontend/src` unless same commit bump repo-root `VERSION` file and add `CHANGELOG.md` entry (also update `**Version X.Y.Z**` line under README title). Doc/plan/test-only commit untouched.

`VERSION` be single truth source: backend read it live from bind-mount checkout and serve at `GET /version` (plan.md §343), so version-only bump deploy as bare `git pull` with no rebuild. `package.json` version field frozen and unused — do **not** bump them.

Do bump with `scripts/bump-version.sh <patch|minor> <Category> "<bullet>"` rather than hand-edit three file — it write `VERSION`, README line, and `CHANGELOG.md` entry from one truth source. Review its diff before commit.

## Agent skills

### Issue tracker

GitHub Issues (`kiko2306/business-lab`) via `gh`, for mattpocock skill only. README TODO stay tracker for this repo own working loop. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

single-context. See `docs/agents/domain.md`.

## Caveman Behavior Rules

These override any conflicting rule above.

- **Commits:** Execute `caveman-commit`. Max 50 chars. Lowercase. No trailing periods. (e.g., `feat(api): add post route`).
- **Plan Maintenance:** Execute `caveman-compress` on `plan.md`. No fluff words. Use brackets for state: `[x] done`, `[-] active`, `[ ] todo`.
- **Chat:** Reply in short fragments. Never say "Sure, I can help."
