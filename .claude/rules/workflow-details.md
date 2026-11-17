---
paths:
  - "README.md"
  - "plan.md"
  - "plan-index.md"
  - "VERSION"
  - "scripts/bump-version.sh"
---

## Commits go to `dev`; `dev` → `beta` → `main`

All work commit to rolling `dev` — never straight to `beta` or `main`. `dev` always safe to push: every change land there once affected workspace check pass. Live-stack verify be **not** gate for `dev`. No leave finished work uncommitted; one commit per coherent change, push as it land.

Merge `dev` into `beta` only when commit truly give user something new to test there — it touch Docker/exposure/network/backup, or finish slice now reachable end-to-end. Doc/plan-only fix, or backend-only slice nothing yet expose, stay on `dev` and wait for change that make it reachable. Judgment call each time, not fixed file-path list.

When commit clear that bar, merge be **only** merge and push (fast-forward when can) — no rebuild, no restart, no live-stack test, no need ask permission. User pull code onto run box themself via dashboard self-update panel (Update page, track `beta`) — that trigger be theirs, not yours. Say plain when merge land, and that README listed test still need run before `main`. Say it too when you hold commit back from `beta`.

`beta` → `main` happen only when user explicit ask for `beta` test and that test pass — that ask-and-pass be go-ahead, no separate confirm. Run exactly what README item describe; one fail, report it and no merge. Never test `beta` or merge to `main` on own idea.

Branch off `dev` to isolate spike or throwaway experiment; merge back into `dev`, and delete branch once it serve purpose. Check `git status` before commit — repo be public, `.env` must never be in diff.

## Batches and planning passes

Work arrive as list rather than single task? Planning pass before step 2: append plan to `plan.md`, add each piece to README, then propose. Intent then survive session that get cut off, and build order stay user call.

Proposal can ask batch approval: name several independent, already-planned item, run all through step 3-5 with no stop between. Each still get own step 4 record and own step 5 commit. Save it for item truly independent (no item output feed next); stop batch moment one outcome change what later one should do.

## TODOs live in README.md, and get deleted

`README.md` TODO section be **only** place open work track — no `// TODO` comment, no second list in `plan.md`, no note in doc page.

Item finish: **delete it**. No tick box left behind — done work be what `plan.md` and `git log` for. Same for item that turn out wrong or no longer want; say why in commit message.

New work found mid-task go in as new item, no fix in passing, unless truly part of change at hand.

## Version

`VERSION` be single truth source: backend read it live from bind-mount checkout and serve at `GET /version` (plan.md §343), so version-only bump deploy as bare `git pull`, no rebuild. `package.json` version field frozen — do **not** bump them. Bump with `scripts/bump-version.sh <patch|minor> <Category> "<bullet>"`, never hand-edit the three file; review its diff before commit.
