# Claude CLI execution guide

This is the working instruction file for Claude CLI in this repository. The
goal is to finish the project with the fewest tokens and session resets while
preserving the project's safety rules.

## 0. First instruction: inspect Claude configuration

**Estimated session time:** 5-10 minutes.

At the start of every session, do this before reading code or selecting a task:

```text
Check .claude/settings.json and every file in .claude/hooks/ that applies to
this task. Summarize the active permissions and guards in 3-6 bullets. Do not
read real .env files. Do not bypass a guard; adapt the command or ask me for a
value through the UI/live-operation step when required.
```

The current configuration denies Read/Edit/Write access to the root and app
`.env` files. `bash-guards.sh` also blocks shell access to real `.env` contents
and blocks root `docker compose down`. `require-version-bump.sh` requires a
version bump in both packages, matching lockfile versions, a CHANGELOG entry,
and the README version line when a commit ships non-test code under
`backend/src` or `frontend/src`.

## 1. Session opening

**Estimated session time:** 10-15 minutes.

Paste this as the first prompt after the configuration check:

```text
Read README.md's TODO section first. Then read plan-index.md and only the
plan.md section(s) referenced by the TODO I am taking up, plus the tail of
plan.md for the current stopping point. Check git status. Do not map the whole
repository. Propose the next smallest coherent task and its cheapest focused
validation; wait for my approval before editing.
```

Use `plan.md` as the project memory. Read one section at a time through the
ranges in `plan-index.md`; never load the whole file. Use nearby code, tests,
and existing implementations as the primary design reference.

For each approved task, Claude should:

1. State one local hypothesis about the controlling code path and one check
	that could disprove it.
2. Make the smallest edit that tests that hypothesis.
3. Immediately run the narrowest relevant test, typecheck, lint, or live check.
4. Repair and rerun that same check before widening the investigation.
5. Append a numbered `plan.md` section recording the result and rejected paths.
6. Update `README.md` by deleting the completed TODO item, then regenerate
	`plan-index.md` with `./scripts/plan-index.sh`.
7. Check the diff and status. Commit and push only after the required checks
	pass. Never commit `.env`, secrets, or an unverified checkpoint.

## 2. Token and session rules

**Estimated session time:** 2-5 minutes to prepare the compact context; use
`/compact` or `/clear` immediately when the stated boundary is reached.

Use this compact operating prompt at the beginning of an approved task:

```text
Work only on this one TODO item. Read the smallest relevant plan range and
nearby implementation/test. Prefer existing helpers and patterns. After the
first edit, run focused validation immediately. Keep updates concise. Do not
explore unrelated backlog items. Record the outcome in plan.md, remove the
finished README TODO, regenerate plan-index.md, and commit/push only when
verified.
```

Use `/compact` when a milestone is complete: the focused check passes, the
plan/README/index updates are done, and the commit has landed. Before
compacting, ask Claude to preserve only: current TODO, files changed, tests
run, live evidence, rejected approaches, and the next decision.

Use `/clear` when the topic changes. A topic change includes moving between
unrelated TODO families, switching from implementation to a live-host action,
or starting a new investigation after a completed commit. Start the new
session with the Session opening prompt above rather than carrying broad
conversation history forward.

Do not use `/compact` to hide an unfinished or failing task. Do not use
`/clear` between the edit and its first focused validation.

## 3. Work order

Follow this order. A later queue must not be started until its prerequisite
evidence exists.

### Queue A: Claude can complete without your intervention

**Estimated time per session:** 30 minutes to 3 hours, depending on the
focused test, container startup, and scope of the selected TODO. Reserve one
session per numbered task unless the task is purely documentation.

These tasks need repository edits, automated tests, or disposable local
containers only. Work through them one at a time, using the normal commit and
`/compact` boundary after each coherent milestone.

1. **Beszel proxy trust** *(estimated: 2-4 hours)*: build `beszelSync.ts` from the design in plan §229,
	add its permission and trigger wiring, configure the trusted header, and
	prove the record lookup/header refresh in a scratch stack. Keep password
	authentication enabled until the proof succeeds.
2. **Docker-touching E2E coverage** *(estimated: 2-4 hours)*: extend the existing Playwright live-stack
	mode for start/stop, exposure test-connection, and backup flows. Keep it
	local-only and separate from the socket-less CI suite.
3. **Kopia remotes** *(estimated: 2-5 hours per remote)*: add native B2, SFTP, or gdrive support only when the
	destination contract and credentials can be tested without inventing a
	manual console procedure. Prefer one remote at a time and prove restore.
4. **Remaining automatable platform work** *(estimated: 1-4 hours per slice)*: implement the VPN-only exposure
	policy, the applicable proxy-trust integrations, Mealie import research, or
	n8n workflow import only when the relevant prerequisite in README/plan is
	closed. Each integration gets its own focused test and live-proof note.
5. **Documentation and audit work** *(estimated: 20-90 minutes per document set)*: update runbooks, licence records, sales
	material, diagrams, and setup documentation when a code or decision task
	makes them stale. Documentation-only commits do not need a version bump.

Do not silently take over tasks marked `@mat` in Queue B. Do not add Postiz,
SQL Server, MeshCentral, or a new app merely because it appears in the
backlog; first use the TODO order and licence/architecture gates.

### Queue B: you must perform these actions

**Estimated time per session:** 20 minutes to 4 hours. Claude prepares the
run sheet in one short session; your live execution may need a separate
session, especially for rebuilds, external destinations, or physical devices.

Claude should prepare exact commands, UI paths, expected results, and a
rollback/recovery note, then stop and ask you to perform the live action. No
secret should be pasted into chat or read from a real `.env`.

1. **Estimated: 30-60 minutes.** Run the E2E live-stack specs against the real dashboard and report selector
	drift or failures.
2. **Estimated: 30-90 minutes.** Prove Guacamole SSO through the real NPM host after applying the documented
	Authelia auth-request snippet; confirm there is no second Guacamole form.
3. **Estimated: 1-4 hours.** Recreate the self-update infrastructure on the real host, click **Update
	now**, and verify fetch, pull, build, all installed-app updates, service
	restarts, reconnect, and user-role authorization. Confirm the Authelia
	config-file ownership fix during the backend recreate.
4. **Estimated: 30-90 minutes.** Run `sudo ./setup_server.sh` on the real host and verify the fixed-IP
	`netplan try` and passwordless-sudo prompts. Treat this as outage-risky.
5. **Estimated: 15-30 minutes.** Register Nextcloud's `/shared` tree through its interactive Admin settings
	flow, which requires fresh password confirmation.
6. **Estimated: 1-3 hours.** Prove one real external Kopia destination and restore against a NAS or
	production-like server: disk, SMB, or NFS.
7. **Estimated: 1-3 hours per device/integration.** Perform physical or account-dependent Home Assistant work: identify the
	three unlabeled devices by power-cycle/re-sweep, test the washing-machine
	Bluetooth path, and decide whether to buy/use the Ariston eBus adapter.
8. **Estimated: 1-3 hours per account or client setup.** Complete any third-party-account or client-provisioning work: Cloudflare
	account/token, social-platform developer/tester access, client domain,
	Authelia users, and backup destination.
9. **Estimated: 2-5 hours.** Run the VPS fresh-setup test when a disposable clean VPS is available.

For every live task, report: exact command/UI path used, timestamp, relevant
success/failure output, and whether the result is safe to repeat. Claude then
records the evidence in `plan.md` and removes the matching TODO.

### Queue C: blocked until Queue B evidence exists

**Estimated time per session:** 30 minutes to 4 hours per unlocked slice,
plus the waiting time for any required live proof. Do not spend an entire
session implementing a blocked item before its prerequisite is recorded.

Do not implement or claim these complete before their live prerequisite is
proven:

- **Estimated: 1-3 hours after prerequisite.** Drop native logins in favor of Authelia-only for apps affected by the LAN
  bypass. First close the NPM loopback binding task and verify every exposed
  hostname through Cloudflare.
- **Estimated: 30-60 minutes after prerequisite.** Enable Beszel `DISABLE_PASSWORD_AUTH`; first prove trusted-header session
  resolution and keep a recovery path.
- **Estimated: 15-30 minutes after prerequisite.** Treat Nextcloud external storage registration as complete; code alone only
  supplies the mount and permissions.
- **Estimated: 30-90 minutes per app after prerequisite.** Claim Guacamole, Mealie, Paperless, Immich, Vikunja, Homebox, NocoDB,
  Nextcloud, or Home Assistant proxy/OIDC login changes as working; each needs
  its own live proof and may expose version-specific behavior.
- **Estimated: 30-90 minutes after observation.** Schedule CrowdSec alert deduplication; first observe whether real pushes are
  noisy enough to justify Redis-backed state.
- **Estimated: 1-3 hours after account proof.** Build social publishing around Meta assumptions; first verify Instagram and
  Facebook development-mode behavior with a real tester/admin account.
- **Estimated: 2-6 hours per client or decision set.** Finish per-client provisioning or the turnkey build/commercial position;
  first settle the client's domain, Cloudflare ownership, credentials,
  backup/key custody, hardware profile, and data-protection decisions.

## 4. Queue handoff prompts

**Estimated session time:** 5-15 minutes for Claude to prepare a handoff or
reconcile returned evidence.

After Queue A work is verified and committed:

```text
Queue A milestone is complete. Read the remaining README TODOs and identify
the next Queue B action whose prerequisites are satisfied. Prepare a concise
live-run sheet with commands/UI steps, expected evidence, risks, and recovery.
Do not perform the live-host action or request secrets in chat.
```

After you return live evidence:

```text
Use this live evidence only for the named TODO. Read its plan section and
nearby code, reconcile the result, and make only the necessary follow-up edit.
Run the focused validation, append the plan outcome, delete the completed
README item, regenerate plan-index.md, and commit/push if verified.
```

When a Queue B result unlocks Queue C, start a new topic with `/clear`, then
use:

```text
The prerequisite live proof is now recorded in plan.md. Re-read that section
and the blocked TODO. Implement the smallest next slice, preserving the
recovery path and testing the exact behavior that was previously blocked.
```

## 5. Stop conditions

Stop and ask one focused question when a required value is genuinely unknown,
when a live action could lock out access, or when a test contradicts the local
hypothesis. Do not ask broad planning questions that the README, plan, code,
or tests can answer. Never work around `.claude` guards, the no-router rule,
the no-console-configuration rule, or the no-guarantees dev/test boundary.

## 6. Exact inputs in order

```text
Check .claude/settings.json and every file in .claude/hooks/ that applies to
this task. Summarize the active permissions and guards in 3-6 bullets. Do not
read real .env files. Do not bypass a guard; adapt the command or ask me for a
value through the UI/live-operation step when required.
```

```text
Read README.md's TODO section first. Then read plan-index.md and only the
plan.md section(s) referenced by the TODO I am taking up, plus the tail of
plan.md for the current stopping point. Check git status. Do not map the whole
repository. Propose the next smallest coherent task and its cheapest focused
validation; wait for my approval before editing.
```

```text
Work only on this one TODO item. Read the smallest relevant plan range and
nearby implementation/test. Prefer existing helpers and patterns. After the
first edit, run focused validation immediately. Keep updates concise. Do not
explore unrelated backlog items. Record the outcome in plan.md, remove the
finished README TODO, regenerate plan-index.md, and commit/push only when
verified.
```

```text
/compact
```

```text
Preserve only: current TODO, files changed, tests run, live evidence, rejected
approaches, and the next decision.
```

```text
/clear
```

```text
Queue A milestone is complete. Read the remaining README TODOs and identify
the next Queue B action whose prerequisites are satisfied. Prepare a concise
live-run sheet with commands/UI steps, expected evidence, risks, and recovery.
Do not perform the live-host action or request secrets in chat.
```

```text
Use this live evidence only for the named TODO. Read its plan section and
nearby code, reconcile the result, and make only the necessary follow-up edit.
Run the focused validation, append the plan outcome, delete the completed
README item, regenerate plan-index.md, and commit/push if verified.
```

```text
/clear
```

```text
The prerequisite live proof is now recorded in plan.md. Re-read that section
and the blocked TODO. Implement the smallest next slice, preserving the
recovery path and testing the exact behavior that was previously blocked.
```
