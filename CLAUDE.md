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

**No Node on this host** — everything run in container: `./scripts/check.sh <backend|frontend> <test|typecheck|build>` (finds repo root itself). Run the affected workspace check before say change done; run `scripts/e2e-tests.sh` when change touch auth, shell/nav, Users page or 2FA flow. Details (test image, smoke tests, CI): `.claude/rules/commands.md`, loaded when you work in `scripts/`, `backend/`, `frontend/` or `.github/`.

## Session cost

Global `cost.md` applies. Project specifics:

- **Delegate wide work.** `locate` agent (pinned Haiku) for "where is X / what calls Y"; `checks` agent (pinned Haiku) to run `scripts/check.sh` — green run come back three line instead of thousand. Both in `.claude/agents/`.
- **No `cd <repo> &&` prefix.** Shell already start in repo root, and permission rule match command string from start, so that prefix turn an allowed `grep` into fresh prompt. Use plain command, or absolute path as argument.
- **Read narrowly.** `plan-section.sh` for plan.md. SessionStart hook already list open item — no re-read README TODO to find them.

## Commits go to `dev`; `dev` → `beta` → `main`

All work commit to rolling `dev` — never straight to `beta` or `main`. One commit per coherent change, push as it land, once the affected workspace check pass. Merge `dev` into `beta` only when the commit give user something new to test there. `beta` → `main` only when user explicit ask. Repo be public: check `git status` before commit, `.env` must never be in diff. Full rules: `.claude/rules/workflow-details.md`, loaded when you touch README, plan.md or `VERSION`.

## The working loop

1. **Take open item from SessionStart hook list.** It print agent-actionable item already, plus count of host-verify queue. Read item full text — deliberately long, "what to check and how" be point — only for one being pick up. Host-verify item be user's to run; no propose them.
2. **Propose.** Name task you would do next, or short list to choose from. No pick one and start.
3. **Implement, test first**: write test that describe change, run it, watch it fail for right reason, then write code and run it green. Behaviour cannot exercise in container (host file ownership, live Authelia/NPM, Windows agent)? Say so before code, and either pull logic out so it can test or name README beta-test that carry proof. Compose-only or doc-only change have no unit-test surface; its README beta item be test.
4. **Update `plan.md` and `README.md`.** New numbered section say what done and why; finished item **deleted** from README; re-run `./scripts/plan-index.sh`. Scale section to work — real hunt get full story with what tried and rejected; mechanical item get few line. Pad trivial item to look like hunt be exactly cost this rule avoid. Change touch Docker/exposure/network/backup? Add README item naming what must test on `beta` and how.
5. **Commit and push to `dev`** once affected check pass, then apply branch rule above.
6. **Back to step 1** — unless item be part of pre-approved batch, then take next in batch with no re-propose.

## TODOs live in README.md, and get deleted

`README.md` TODO section be **only** place open work track. Item finish: **delete it**. New work found mid-task go in as new item, no fix in passing. Details: `.claude/rules/workflow-details.md`.

## Layout and conventions

Service registry `backend/src/config/services.ts`; business logic `backend/src/services/`; thin routes `backend/src/routes/`; Angular 18 standalone `frontend/src/app/`; one compose project per app in `apps/<name>/`; operator docs in `docs/`. Tests beside code (`*.test.ts`, vitest). Comments explain why. Adding an app, ports scheme, exposure and dependency rules: `.claude/rules/layout-conventions.md`, loaded when you work in `backend/src`, `frontend/src`, `apps/` or `docs/`.

## Never

- Commit any `.env`, secret, token or password. Repo be **public** (`kiko2306/business-lab`). `.env.example` template only.
- `docker compose down` **at repo root** — it tear down run dashboard (frontend, backend, database, socket proxy). Restart individual service instead. `docker compose down` on *managed app* own project be fine — it how app get stopped, and how removed app leftover get cleaned (`removedAppCleanup.ts`).
- Edit app compose file from backend code. Backend make `.env` file (`appEnv.ts`) and managed config file; compose file be read-only to it.
- Claim something work because it type-check. This project history full of thing that pass CI and fail on host — verify against real stack when change touch Docker, exposure, network or backup.
- Assume data on `tx-home-utils.com` safe or service there stay up. Production be separate, per-client deployment.

SessionStart hook print the enforced guard each session — those refusal be rule work, so find another way rather than route around.

Version bump: `VERSION` be single truth source; bump only with `scripts/bump-version.sh` (never hand-edit, never bump `package.json` version). Details: `.claude/rules/workflow-details.md`.

## Agent skills

- **Issue tracker** — GitHub Issues (`kiko2306/business-lab`) via `gh`, for mattpocock skill only. README TODO stay tracker for this repo own loop. `docs/agents/issue-tracker.md`.
- **Triage labels** — default five-label vocabulary. `docs/agents/triage-labels.md`.
- **Domain docs** — single-context. `docs/agents/domain.md`.

## Conventions that replace the old caveman rules

- **Commits:** Conventional Commits, subject max 50 chars, lowercase, no trailing period (e.g. `feat(api): add post route`). Global `git.md` applies.
- **plan.md:** keep entries short, no fluff; state in brackets: `[x] done`, `[-] active`, `[ ] todo`.
- **Chat:** short fragments (global `caveman-voice.md`).
