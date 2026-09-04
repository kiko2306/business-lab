/**
 * The "git pull + rebuild + restart" half of the self-update panel (plan.md
 * §131.4) — the other half, the footer version string, is version.ts.
 *
 * Also the *only* place managed-app images move any more (§209): once the
 * dashboard's own rebuild is done but before the (self-replacing) backend
 * restart, `executor.updateAllInstalledApps` pulls and recreates every
 * installed app against whatever tags the `git pull` that just landed pinned
 * in their compose files. There is no per-app "Update" action left — every
 * app's image now only ever advances because this ran, tying every
 * container's version to a specific commit of this repository rather than
 * letting any one app drift ahead of it independently.
 *
 * The tricky part isn't the git/compose commands, it's that the last step
 * recreates the very backend container running this code. Everything up to
 * and including the frontend restart is awaited normally; the final
 * `docker compose up -d --build backend` is fired detached and unref'd —
 * this process is about to be replaced, so nothing after that point can rely
 * on being able to keep running or write anything else down. That's also why
 * run state lives in Postgres (survives the restart) rather than in-memory
 * (like `withMaintenanceLock`, which explicitly cannot — see its doc
 * comment) — the row started before the restart is the only record that the
 * restart was ever supposed to happen, and `reconcileDanglingSelfUpdateRun`
 * closes it out on the next boot.
 *
 * Never `docker compose down` (CLAUDE.md, §Never) — every step here is
 * `up -d --build` against one or two named services, same as
 * `executor.ts`'s per-app compose calls.
 */

import { spawn } from 'child_process';
import logger from '../utils/logger';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { runCommand } from './backup';
import { updateAllInstalledApps } from './executor';
import { APP_VERSION } from '../version';
import { HttpError } from '../types';

const composeFilePath = (repoRoot: string) => `${repoRoot}/docker-compose.yml`;

// A `docker compose build` of both images (npm ci + ng build included) is
// slow — much slower than the 15-minute allowance `executor.ts` gives a
// first-run image pull — and its progress output is as chatty as a pull's.
const BUILD_TIMEOUT_MS = 30 * 60_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

export type SelfUpdateRunState =
  | 'checking'
  | 'pulling'
  | 'building'
  | 'updating_apps'
  | 'restarting_frontend'
  | 'restarting_backend'
  | 'done'
  | 'error';

export interface SelfUpdateRunRow {
  id: number;
  state: SelfUpdateRunState;
  fromCommit: string | null;
  toCommit: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SelfUpdateCheck {
  currentCommit: string;
  remoteCommit: string;
  commitsBehind: number;
  checkedAt: string;
}

let cachedCheck: SelfUpdateCheck | null = null;

export async function ensureSelfUpdateTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS self_update_runs (
      id SERIAL PRIMARY KEY,
      state VARCHAR(30) NOT NULL,
      from_commit VARCHAR(40),
      to_commit VARCHAR(40),
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `);
}

function requireRepoRoot(): string {
  const repoRoot = process.env.REPO_ROOT;
  if (!repoRoot) {
    throw { statusCode: 500, message: 'REPO_ROOT is not configured — the self-update panel needs it mounted (see .env.example).' } as HttpError;
  }
  return repoRoot;
}

function rowFromDb(row: {
  id: number;
  state: string;
  from_commit: string | null;
  to_commit: string | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
}): SelfUpdateRunRow {
  return {
    id: row.id,
    state: row.state as SelfUpdateRunState,
    fromCommit: row.from_commit,
    toCommit: row.to_commit,
    errorMessage: row.error_message,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

async function getLatestRun(): Promise<SelfUpdateRunRow | null> {
  const result = await query<{
    id: number;
    state: string;
    from_commit: string | null;
    to_commit: string | null;
    error_message: string | null;
    started_at: Date;
    finished_at: Date | null;
  }>('SELECT * FROM self_update_runs ORDER BY id DESC LIMIT 1');
  return result.rows[0] ? rowFromDb(result.rows[0]) : null;
}

async function insertRun(state: SelfUpdateRunState, fromCommit: string | null): Promise<SelfUpdateRunRow> {
  const result = await query<{
    id: number;
    state: string;
    from_commit: string | null;
    to_commit: string | null;
    error_message: string | null;
    started_at: Date;
    finished_at: Date | null;
  }>(
    `INSERT INTO self_update_runs (state, from_commit) VALUES ($1, $2) RETURNING *`,
    [state, fromCommit]
  );
  return rowFromDb(result.rows[0]);
}

async function updateRun(
  id: number,
  fields: { state?: SelfUpdateRunState; toCommit?: string; errorMessage?: string; finished?: boolean }
): Promise<void> {
  await query(
    `UPDATE self_update_runs
     SET state = COALESCE($2, state),
         to_commit = COALESCE($3, to_commit),
         error_message = COALESCE($4, error_message),
         finished_at = CASE WHEN $5 THEN NOW() ELSE finished_at END
     WHERE id = $1`,
    [id, fields.state ?? null, fields.toCommit ?? null, fields.errorMessage ?? null, fields.finished ?? false]
  );
}

/**
 * `git fetch` + compare against `origin/main`. Deliberately not called from
 * a live status poll — a fetch against a slow/unreachable remote shouldn't
 * hang the panel — so it's cached here and refreshed by the sweeper (and by
 * the "Check now" button) rather than on every poll.
 */
export async function checkForUpdate(): Promise<SelfUpdateCheck> {
  const repoRoot = requireRepoRoot();
  await runCommand('git', ['-C', repoRoot, 'fetch', 'origin', 'main', '--quiet'], { timeout: 30_000 });
  const currentCommit = (await runCommand('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 10_000 })).trim();
  const remoteCommit = (await runCommand('git', ['-C', repoRoot, 'rev-parse', 'origin/main'], { timeout: 10_000 })).trim();
  const countOutput = await runCommand(
    'git',
    ['-C', repoRoot, 'rev-list', '--count', `${currentCommit}..${remoteCommit}`],
    { timeout: 10_000 }
  );
  cachedCheck = {
    currentCommit,
    remoteCommit,
    commitsBehind: parseInt(countOutput.trim(), 10) || 0,
    checkedAt: new Date().toISOString(),
  };
  return cachedCheck;
}

export function startSelfUpdateCheckSweeper(): void {
  const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
  const run = () => {
    checkForUpdate().catch((error: Error) => {
      logger.warn('Self-update check failed', { error: error.message });
    });
  };
  run();
  setInterval(run, SWEEP_INTERVAL_MS).unref();
}

export interface SelfUpdateStatus {
  appVersion: string;
  check: SelfUpdateCheck | null;
  latestRun: SelfUpdateRunRow | null;
}

export async function getSelfUpdateStatus(): Promise<SelfUpdateStatus> {
  const latestRun = await getLatestRun();
  return { appVersion: APP_VERSION, check: cachedCheck, latestRun };
}

function isRunInProgress(run: SelfUpdateRunRow | null): boolean {
  return run !== null && run.finishedAt === null;
}

/**
 * Kicks off the pull → build → restart sequence and returns as soon as the
 * run row exists — the caller (the route handler) must not await the whole
 * thing, since the process serving that request is the one that gets
 * replaced partway through.
 */
export async function triggerSelfUpdate(userId: number | null): Promise<SelfUpdateRunRow> {
  const existing = await getLatestRun();
  if (isRunInProgress(existing)) {
    throw { statusCode: 409, message: 'A self-update is already in progress.' } as HttpError;
  }

  const repoRoot = requireRepoRoot();
  const check = await checkForUpdate();
  const run = await insertRun('checking', check.currentCommit);

  void runSelfUpdateSequence(run.id, repoRoot, check, userId).catch((error: Error) => {
    logger.error('Self-update sequence failed unexpectedly', { error: error.message, runId: run.id });
  });

  return run;
}

async function runSelfUpdateSequence(
  runId: number,
  repoRoot: string,
  check: SelfUpdateCheck,
  userId: number | null
): Promise<void> {
  if (check.commitsBehind === 0) {
    await updateRun(runId, { state: 'done', toCommit: check.currentCommit, finished: true });
    return;
  }

  try {
    await updateRun(runId, { state: 'pulling' });
    await runCommand('git', ['-C', repoRoot, 'pull', '--ff-only', 'origin', 'main'], { timeout: 60_000 });
    const toCommit = (await runCommand('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 10_000 })).trim();

    await updateRun(runId, { state: 'building', toCommit });
    await runCommand(
      'docker',
      ['compose', '-f', composeFilePath(repoRoot), 'build', 'frontend', 'backend'],
      { timeout: BUILD_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER }
    );

    // Every installed app's image, pulled and recreated against whatever the
    // `git pull` above just landed in its compose file (§209) — the only
    // place this happens now, replacing the old per-app "Update" button.
    // Best-effort: updateAllInstalledApps never throws, it logs a per-app
    // failure and moves on, so one app's broken pull can't block the
    // dashboard's own rebuild/restart from completing below.
    await updateRun(runId, { state: 'updating_apps' });
    const appResults = await updateAllInstalledApps(userId);
    const appsFailed = appResults.filter((r) => !r.ok);
    if (appsFailed.length) {
      logger.warn(`Self-update: ${appsFailed.length}/${appResults.length} app(s) failed to update`, {
        failed: appsFailed.map((r) => r.serviceName),
      });
    }

    await updateRun(runId, { state: 'restarting_frontend' });
    await runCommand(
      'docker',
      ['compose', '-f', composeFilePath(repoRoot), 'up', '-d', '--build', 'frontend'],
      { timeout: BUILD_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER }
    );

    // Mark this as reached (with finished_at) *before* spawning the command
    // that replaces this process — a row stuck here after a boot is still
    // legible as "got this far", and reconcileDanglingSelfUpdateRun closes
    // it out for good once the new process starts.
    await updateRun(runId, { state: 'restarting_backend', finished: true });
    await writeAuditLog({
      userId,
      action: 'self_update_trigger',
      resource: toCommit,
      metadata: {
        fromCommit: check.currentCommit,
        toCommit,
        appsUpdated: appResults.length - appsFailed.length,
        appsFailed: appsFailed.map((r) => r.serviceName),
      },
    }).catch(() => {});

    const child = spawn(
      'docker',
      ['compose', '-f', composeFilePath(repoRoot), 'up', '-d', '--build', 'backend'],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
  } catch (error) {
    const message = (error as Error).message || 'Self-update failed.';
    await updateRun(runId, { state: 'error', errorMessage: message, finished: true });
    logger.error('Self-update failed', { runId, error: message });
  }
}

/**
 * Called once on boot (same idiom as `reconcileRemovedServices`): a run row
 * left in `restarting_backend` already has `finished_at` set — its state
 * simply hasn't been observed by a process that survived it. This process
 * booting *is* that proof, so flip it to `done` and audit it as complete —
 * otherwise the panel would have no way to distinguish "still restarting"
 * from "restarted fine" once it can reach the API again.
 */
export async function reconcileDanglingSelfUpdateRun(): Promise<void> {
  const latest = await getLatestRun();
  if (!latest || latest.state !== 'restarting_backend') {
    return;
  }
  await updateRun(latest.id, { state: 'done' });
  logger.info('Self-update completed — backend restarted into the new build', {
    runId: latest.id,
    fromCommit: latest.fromCommit,
    toCommit: latest.toCommit,
  });
  await writeAuditLog({
    userId: null,
    action: 'self_update_complete',
    resource: latest.toCommit ?? undefined,
    metadata: { fromCommit: latest.fromCommit, toCommit: latest.toCommit },
  }).catch(() => {});
}

