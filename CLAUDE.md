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

## This host is a no-guarantees dev/test box

The deployment this repo is developed against — `tx-home-utils.com` — carries
**no uptime guarantee and no data-durability guarantee**. Services going down
on it is fine. Data on it being changed or lost is fine. It exists to prove
code paths against a real stack (principle 3 above), and anything on it is
disposable. Do not build features, tests, or docs that assume state on this
host survives, or that a service must stay running.

Being internet-exposed is **not** what makes it dev/test. A production /
per-client deployment is *also* internet-exposed — same Cloudflare Tunnel + NPM
model — but is a **separate deployment** with its own domain and its own
credentials/tokens, and there uptime and client data do matter. The difference
is the promises, not the exposure.

The verification model is unchanged: this box stays the stack every
Docker/exposure/networking/backup change is proven against before it is called
done — that is exactly what a no-guarantees dev/test box is for.

## plan.md is the project's memory

`plan.md` is the spec **and** the running session log. Numbered
sections; new work is appended as a new `## NN. ...` section. Read the tail
before starting — the last section usually says where things stand and what to
pick up. Record what was tried and rejected, not just what landed. Do not
rewrite an active section's history; append.

A **fully-superseded** run of sections — one app or one investigation, closed,
with its outcome captured in code/tests/docs — may be compacted in a bounded,
reviewable pass: replace the run with one short section that keeps the durable
facts, the **conclusion** of each rejected approach (not the blow-by-blow), and
any still-open threads, titled `... (former §X–§Y, compacted <date>)`. Do this
as its own `plan:` commit so the diff can be reviewed and reverted. Never
compact a section that later sections still build on or cross-reference.

It is read **a section at a time, never whole**. `plan-index.md` lists every
section with the `sed` range that reads it; regenerate it with
`./scripts/plan-index.sh` after appending or compacting. The record of what was
tried and rejected is the half that keeps turning out to matter (§75.7) — a
compaction keeps that, it just drops the iteration detail once the code is the
source of truth. Nothing loads the file automatically anyway.

## Commands

**There is no Node on this host** — everything runs in containers. Use
`./scripts/check.sh <backend|frontend> <test|typecheck|build>`, e.g.
`./scripts/check.sh backend test` or `./scripts/check.sh frontend test`. It
resolves the repo root itself, so it works even if the shell's cwd has
drifted into `backend/` or `frontend/` — mounting `$PWD` directly breaks
there, since some backend tests resolve paths up to the repo root, not just
their own workspace. `frontend test` builds the `homelab-frontend-test`
image on first use if it's missing (Karma/Jasmine + headless Chrome doesn't
run on plain `node:20` — no Chrome, and `node:20`'s Debian base is missing
the shared libraries headless Chrome needs). `./scripts/smoke-tests.sh` runs
on the host against an already-running backend.

Rebuild `homelab-frontend-test` (`docker build -t homelab-frontend-test -f
frontend/Dockerfile.test frontend`) if `frontend/package-lock.json`'s
`puppeteer` version changes (`Dockerfile.test` pins a matching Chrome
download).

CI (`.github/workflows/ci.yml`) runs backend typecheck+test, frontend
test:ci+build, `apps/price-compare/app` tests, and the browser E2E job
(`scripts/e2e-tests.sh` — Playwright against the `docker-compose.test.yml`
stack). The host-only smoke tests (`scripts/smoke-tests.sh`) are not in CI.
Run the affected workspace's checks before saying a change is done; run
`scripts/e2e-tests.sh` when a change touches auth, the shell/nav, the Users
page or the 2FA flow.

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

## The working loop

Every task runs through the same six steps, in order, every time:

1. **Read the README TODO list.** It is the source of what is open — not
   memory, not the last thing discussed.
2. **Propose.** Name the task you would do next, or show a short list to choose
   from. Do not pick one and start.
3. **Implement** — that one task.
4. **Update `plan.md` and `README.md`.** A new numbered `plan.md` section
   saying what was done and why, the finished item **deleted** from the
   README list, and `./scripts/plan-index.sh` re-run so the index covers the
   new section. Scale the section to the work: a real investigation or
   decision gets the full narrative, including what was tried and rejected —
   that record is what makes the section worth reading later. A small,
   mechanical item (a rename, a one-line config fix, something with no
   dead ends behind it) gets a few lines: what changed and why, no more.
   Padding a trivial item to look like an investigation is exactly the
   token/session-time cost this convention should avoid.
5. **Commit and push, on success.** Success means the affected workspace's
   checks pass and anything touching Docker/exposure/networking/backups has
   been proven against the real stack. If it is not verified, say so plainly
   and leave it uncommitted — never push a checkpoint and never call it done.
6. **Back to step 1.** Report, re-read the list, propose again — unless the
   item just finished was part of a pre-approved batch (below), in which case
   move to the next item in that batch without re-proposing.

When work arrives as a list rather than a single task, insert a planning pass
before step 2: append the plan to `plan.md`, add each piece to the README
list, and then propose. That way intent survives a session that runs long or
gets interrupted, and the order things get built in stays the user's call.

That proposal can ask for batch approval: naming several independent,
already-planned items and asking to run all of them through steps 3-5 without
stopping to re-propose each one. Each item still gets its own step 4 (sized
per the rule above) and its own step 5 commit — batching removes the
between-item pause, not the per-item record or the one-commit-per-change rule.
Reserve it for items that are genuinely independent (no item's output feeds
the next) and were already agreed to in the plan just proposed; stop the batch
and re-propose the moment one item's outcome changes what a later one should
do. Default to the un-batched loop — batch only when asked for, or when
proposing a list of small, clearly independent items where re-asking after
each one would be pure overhead.

## TODOs live in README.md, and get deleted

`README.md`'s TODO section is the **only** place open work is tracked. Not
scattered `// TODO` comments, not a second list in `plan.md`, not a note in a
doc page — if it is outstanding work, it is an item there.

When an item is finished, **delete it**. Do not tick the box and leave it
behind: a list of completed work is what `plan.md` and `git log` are for, and a
README carrying both open and closed items stops being readable as a list of
what is left. The same goes for an item that turns out to be wrong or no longer
wanted — delete it, and say why in the commit message.

New work discovered mid-task goes in as a new item rather than being fixed in
passing, unless it is genuinely part of the change at hand.

## Layout

| Path | What |
|---|---|
| `backend/src/config/services.ts` | The service registry — allowlist of every manageable app. Adding an app starts here. |
| `backend/src/services/` | Business logic: compose execution, exposure, backups, per-app config generation. |
| `backend/src/routes/` | Express routes, thin. |
| `frontend/src/app/` | Angular 18 standalone components, Bootstrap 5. |
| `apps/<name>/` | One compose project per app: `docker-compose.yml`, `.env.example`, gitignored `.env` + `data/`. |
| `docs/` | Operator docs — `ports.md`, `app-credentials.md`, `first-run.md`, `licences.md` are kept current, not aspirational. `licences.md` gets a row per app **and per image** on every addition (see Conventions). |
| `start.sh` | Host bootstrap: daemon config, port allocation, first run. |
| `plan-index.md` | Generated map of `plan.md` — section titles and the `sed` range for each. |

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
  `services.ts`, a port per the scheme, and rows in `docs/ports.md`,
  `docs/app-credentials.md` **and `docs/licences.md`**. The licence row is not
  optional: every new app **and every base/sidecar image** in its compose file
  gets its upstream licence checked against the resale model in that file
  (software not sold; setup/maintenance/hardware sold; client operates the
  box). Flag anything that is copyleft-on-network (AGPL), "fair-code" /
  source-available (n8n's Sustainable Use License, RSAL/SSPL), or carries a
  non-software ToS (WhatsApp). If a candidate app's licence fails that test, it
  does not go in.
- **A running, publicly exposed app shows up on the Home Page.** The Home Page
  is itself public at the bare domain (`plan.md` §111), so the dashboard owns
  its service list: `backend/src/services/homepageConfig.ts` generates
  `apps/home-page/data/services.yaml` from the registry, each app's live
  `service_exposure` row, and the `homepage.*` compose labels — a tile per app
  that is **both running and exposed**, linking to `https://<hostname>`, not
  `localhost`. Label auto-discovery is disabled. An app with no exposure has
  no tile (`plan.md` §112.3). The `homepage.*` labels stay **mandatory** as
  the source of name/group/icon/description: a compose file carries
  `homepage.group`, `homepage.name`, `homepage.icon`, `homepage.description`
  (and `homepage.href` for a human reading the file — the generator ignores
  it), and the registry-wide test in `services.test.ts` fails when an app is
  missing them. An app whose exposure exists only to serve another app, not a
  person (OnlyOffice, which Nextcloud's browser-side editor loads), sets
  `hideFromHomePage: true` in `services.ts` — running and exposed, but no
  tile. The `homepage.*` labels stay mandatory for it all the same.
- **Dependencies between apps** are declared in `services.ts`, in one of two
  tiers. `dependsOn` is for what an app cannot boot without (Authelia's OIDC
  provider, for something that crash-loops without it) — the API refuses the
  start and the dashboard disables the button. `requires` is for what it needs
  to do its job but not to come up (NetBird needs Tailscale for signalling);
  the dashboard lists it and warns when it is down, and never blocks a start.
  Putting a proxy or a VPN in `dependsOn` would make "that one is stopped" mean
  "nothing can be started". Do **not** declare `nginx-proxy-manager` on an app
  just because it is exposed: ingress is Cloudflare → NPM → app for everything,
  so the card derives that from the app's live exposure instead. Declare it only
  where the app's own function needs it (CrowdSec parsing NPM's logs).
- **Commits**: imperative, sentence case, describing the outcome — "Fix the VPN:
  port renumbering left Tailscale Funnel pointing at a dead port". No
  conventional-commit prefixes; `plan:` prefix for plan.md-only commits.

## Never

- Commit any `.env`, secret, token or password. The repo is **public**
  (`kiko2306/business-lab`). `.env.example` templates only.
- `docker compose down` the management stack — it tears down the running
  dashboard. Restart individual services instead.
- Edit an app's compose file from backend code. Backend generates `.env` files
  (`appEnv.ts`) and managed config files; compose files are read-only to it.
- Claim something works because it type-checks. This project's history is full
  of things that passed CI and failed on the host — verify against the real
  stack when the change touches Docker, exposure, networking or backups.
- Assume data on `tx-home-utils.com` is safe or that a service there must stay
  up — it is a no-guarantees dev/test box (see the section above). Production
  is a separate, per-client deployment.

The first two of those are enforced, not just asked for. `.claude/settings.json`
denies the Read/Edit/Write tools on `.env` files, and `.claude/hooks/bash-guards.sh`
covers what per-tool rules cannot: it refuses a root `docker compose down`, and
refuses a shell command that reads or writes a real `.env` (`.env.example`
templates, `ls`, `find` and `git` are left alone). A refusal from either is the
rule working — find another way rather than routing around it.

The version-bump rule is enforced the same way: `.claude/hooks/require-version-bump.sh`
blocks a `git commit` that changes a non-test file under `backend/src` or
`frontend/src` unless the same commit bumps `version` in both `package.json`
files and adds a `CHANGELOG.md` entry (also update the `**Version X.Y.Z**` line
under the README title). Docs/plan/test-only commits are untouched.

Do that bump with `scripts/bump-version.sh <patch|minor> <Category> "<bullet>"`
rather than editing the five files by hand — it bumps both `package.json`s,
both `package-lock.json`s (including the nested `packages[""].version`, which
has drifted out of sync with the root before with nothing catching it), the
README line, and inserts the `CHANGELOG.md` entry, all from one source of
truth. Review its diff before committing.
