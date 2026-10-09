# Session habits that save usage

Every token in context is re-read on every later turn, so startup size and session
length drive the usage limit (plan.md §894, §909).

Measured startup for this repo, 2026-10-09: ~130 KB (≈33k tokens) before the first
prompt, of which ~94 KB was plugin skill descriptions for plugins this repo never
uses. Trimming those plus the hook and `CLAUDE.md` took ~63 KB off it, leaving ~68 KB (≈17k).

## Enforced

- `scripts/test-session-summary.sh` caps the SessionStart hook at 3 KB and
  `CLAUDE.md` at 14 KB, and runs as the `session-startup` CI job. It also checks
  every open README item lands in exactly one bucket, so none can go missing.
- The hook lists only agent-actionable open items, capped at 12, and reports the
  host-verify queue as a count. Classification is by headline verb — an item
  starting `Beta-test`, `Prove`, `Verify`, `Confirm`, `Show`, `Check`, `Run`,
  `Compare`, `One-off` or `First real build` is the user's to run on home-srv-01.

## Habits

- **One task per session.** Finish it, commit, then start fresh.
- **Prefer `/compact` over `/clear`.** `/clear` re-pays startup.
- **Delegate wide work to the pinned-Haiku agents** in `.claude/agents/`: `locate`
  for "where is X / what calls Y", `checks` for running `scripts/check.sh`. Their
  output is a table or a verdict, so the long reads and logs never enter the main
  context, and they cost Haiku rates rather than the session's model.
- **Trim command output.** Pipe through `tail -n 40` or `grep`; read only the
  failing lines.
- **Read narrowly.** `./scripts/plan-section.sh <N>` for plan.md; `grep -n` the
  index, never `Read` it. The hook already lists the open items — don't re-read the
  README TODO section to find them.
- **Keep plugins per-repo honest.** `enabledPlugins` in `~/.claude/settings.json` is
  user-wide: a design or video plugin enabled there costs this repo tokens at every
  turn. Disable with `/plugin` what this repo doesn't use.

## Measuring

- `/context` — what currently fills the window.
- `/caveman-stats` — this session's output and cache-read tokens.
- The `usage-limits` plugin puts session and weekly percentages in the status line.
- Plugin cost: `find ~/.claude/plugins/cache/<name> -name SKILL.md -exec head -12 {} \; | wc -c`
  approximates what its skill list adds to every prompt.
