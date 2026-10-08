# Session habits that save usage

Every token in context is re-read on every later turn, so session length and startup size drive the usage limit (plan.md §894).

- **One task per session.** Finish it, commit, then start fresh. Long sessions re-read their whole history each turn.
- **Prefer `/compact` or just continuing over `/clear`.** `/clear` re-runs the SessionStart hook and pays startup again.
- **Trim command output.** Pipe test, build and log output through `tail -n 40` or `grep`; run `./scripts/check.sh` and read only the failing lines.
- **Read narrowly.** Use `./scripts/plan-section.sh <N>` for plan.md, `grep -n '^- \[ \] \*\*' README.md` for open items; never read `plan.md`, `plan-index.md` or the full README TODO whole.
- **Offload big sweeps to a subagent.** Repo-wide searches and long test runs stay out of the main context.
- **Keep startup small.** `scripts/test-session-summary.sh` caps the SessionStart hook at 10 KB; keep `CLAUDE.md` and `MEMORY.md` lean and move rarely needed rules into `docs/`.
