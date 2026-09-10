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

import { spawn, type ExecFileOptions } from 'child_process';
import logger from '../utils/logger';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { runCommand } from './backup';
import { updateAllInstalledApps } from './executor';
import { getAppVersion } from '../version';
import { HttpError } from '../types';

const composeFilePath = (repoRoot: string) => `${repoRoot}/docker-compose.yml`;

/**
 * Run git with umask 002, so every loose object / ref / index it writes into
 * `.git` stays group-writable. The backend container runs as uid 100 with the
 * default umask 022; without this, a deploy's `git fetch`/`pull` leaves
 * `.git/objects/**` owned by uid 100 and not writable by the host `mat`
 * account, and the next check's `git fetch` (whichever user it runs as) then
 * dies with "insufficient permission for adding an object" — `origin/main`
 * silently freezes and the panel shows "up to date" forever (§351).
 * `sh -c` because execFile has no umask option; args pass through argv, so no
 * shell-quoting concerns.
 */
function runGit(args: string[], options: ExecFileOptions = {}): Promise<string> {
  return runCommand('sh', ['-c', 'umask 002 && exec git "$@"', 'git', ...args], options);
}

// A `docker compose build` of both images (npm ci + ng build included) is
// slow — much slower than the 15-minute allowance `executor.ts` gives a
// first-run image pull — and its progress output is as chatty as a pull's.
const BUILD_TIMEOUT_MS = 30 * 60_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;

// Compose defaults to the buildx container-based builder, which spins up its
// own `buildx_buildkit_default` container and `docker exec`s into it to run
// the build — that needs EXEC on docker-socket-proxy, deliberately left off
// (its own comment: "narrows things like arbitrary docker exec into any
// container on the host"). Confirmed live (plan.md §290): every exec/start
// against the buildkit container came back 403, and the run failed with
// "unable to upgrade to tcp, received 403" before ever reaching BUILD's own
// /build endpoint. DOCKER_BUILDKIT=0 forces the classic, pre-buildx builder
// — a single HTTP POST to /build against the same daemon, exactly what
// BUILD=1 on the proxy already grants — instead of weakening EXEC just for
// this.
const BUILD_ENV: NodeJS.ProcessEnv = { ...process.env, DOCKER_BUILDKIT: '0' };

/**
 * Every build and every app recreate leaves behind a dangling image (the old
 * tag's layers, now unreferenced) and, under the classic builder, stray
 * intermediate build cache — neither is cleaned up anywhere else (§209: this
 * is the only place images move at all any more). Across enough self-update
 * runs that silently piles up — 43GB of reclaimable images and 24GB of build
 * cache were found live on tx-home-utils.com — and adds to the memory/swap
 * pressure a run already puts on the host by never coming back down. Run at
 * the two natural boundaries below (after the dashboard's own build, and
 * after every app's pull+recreate) rather than only at the end, so the
 * reclaim lands before the next heavy step instead of piling on top of it.
 * Best-effort and silent on failure: a prune is cleanup, not part of the
 * update itself, and must never fail or block the sequence it's tidying up
 * after.
 */
async function pruneDockerCruft(label: string): Promise<void> {
  try {
    await runCommand('docker', ['image', 'prune', '-f'], { timeout: 120_000, maxBuffer: COMMAND_MAX_BUFFER });
    await runCommand('docker', ['builder', 'prune', '-f'], { timeout: 120_000, maxBuffer: COMMAND_MAX_BUFFER });
  } catch (error) {
    logger.warn(`Self-update: docker prune after ${label} failed (non-fatal)`, {
      error: (error as Error).message,
    });
  }
}

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
  await runGit(['-C', repoRoot, 'fetch', 'origin', 'main', '--quiet'], { timeout: 30_000 });
  const currentCommit = (await runGit(['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 10_000 })).trim();
  const remoteCommit = (await runGit(['-C', repoRoot, 'rev-parse', 'origin/main'], { timeout: 10_000 })).trim();
  const countOutput = await runGit(
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
  return { appVersion: getAppVersion(), check: cachedCheck, latestRun };
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

interface DeployScope {
  /** The frontend image needs `docker compose build` + a restart. */
  frontend: boolean;
  /** The backend image needs `docker compose build` + its self-restart. */
  backend: boolean;
  /**
   * Installed apps whose `apps/<name>/**` changed and so need a pull+recreate.
   * `null` means "could not read the diff — recreate every installed app", the
   * safe fallback.
   */
  apps: Set<string> | null;
}

// A changed path under one of these needs the corresponding image rebuilt.
// tsconfig / angular.json / the root compose file all change what a build
// produces; the lockfiles change what `npm ci` installs.
const BACKEND_BUILD_RE = /^backend\/(src\/|Dockerfile|package\.json|package-lock\.json|tsconfig)/;
const FRONTEND_BUILD_RE = /^frontend\/(src\/|Dockerfile|package\.json|package-lock\.json|angular\.json|tsconfig)/;
const APP_PATH_RE = /^apps\/([^/]+)\//;

/**
 * `git diff --name-only <from>..<to>` → which images to rebuild and which
 * apps to recreate. Any failure (no `from`, git error, empty output that
 * shouldn't be empty) returns the everything-changed fallback so a deploy is
 * never silently under-applied.
 */
async function classifyDeploy(repoRoot: string, fromCommit: string | null, toCommit: string): Promise<DeployScope> {
  const fallback: DeployScope = { frontend: true, backend: true, apps: null };
  if (!fromCommit || fromCommit === toCommit) {
    return fallback;
  }
  let names: string[];
  try {
    const out = await runGit(
      ['-C', repoRoot, 'diff', '--name-only', `${fromCommit}..${toCommit}`],
      { timeout: 15_000 }
    );
    names = out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (error) {
    logger.warn('Self-update: could not diff the pull — recreating every app', {
      error: (error as Error).message,
    });
    return fallback;
  }
  if (!names.length) {
    return fallback;
  }

  const apps = new Set<string>();
  let frontend = names.includes('docker-compose.yml');
  let backend = false;
  for (const name of names) {
    if (BACKEND_BUILD_RE.test(name)) backend = true;
    if (FRONTEND_BUILD_RE.test(name)) frontend = true;
    const app = APP_PATH_RE.exec(name)?.[1];
    if (app) apps.add(app);
  }
  return { frontend, backend, apps };
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
    await runGit(['-C', repoRoot, 'pull', '--ff-only', 'origin', 'main'], { timeout: 60_000 });
    const toCommit = (await runGit(['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 10_000 })).trim();
    await updateRun(runId, { toCommit });

    const scope = await classifyDeploy(repoRoot, check.currentCommit, toCommit);
    const buildTargets = [
      ...(scope.frontend ? ['frontend'] : []),
      ...(scope.backend ? ['backend'] : []),
    ];
    const willTouchApps = scope.apps === null || scope.apps.size > 0;
    logger.info('Self-update scope', {
      runId,
      build: buildTargets,
      apps: scope.apps === null ? 'all' : [...scope.apps],
    });

    // Nothing the deploy changed needs a build, an app recreate or a restart —
    // a version bump, docs, plan.md. The `git pull` above is the whole update;
    // the backend reads VERSION live so `/version` is already current (§343).
    if (!buildTargets.length && !willTouchApps) {
      await writeAuditLog({
        userId,
        action: 'self_update_trigger',
        resource: toCommit,
        metadata: { fromCommit: check.currentCommit, toCommit, scope: 'pull-only' },
      }).catch(() => {});
      await updateRun(runId, { state: 'done', finished: true });
      logger.info('Self-update: pull-only, nothing to rebuild or restart', { runId });
      return;
    }

    if (buildTargets.length) {
      await updateRun(runId, { state: 'building' });
      await runCommand(
        'docker',
        ['compose', '-f', composeFilePath(repoRoot), 'build', ...buildTargets],
        { timeout: BUILD_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, env: BUILD_ENV }
      );
      await pruneDockerCruft('building');
    }

    // Only the apps whose own files changed in the pull (or all, on the
    // fallback). Best-effort: updateAllInstalledApps never throws, it logs a
    // per-app failure and moves on.
    let appResults: Awaited<ReturnType<typeof updateAllInstalledApps>> = [];
    if (willTouchApps) {
      await updateRun(runId, { state: 'updating_apps' });
      appResults = await updateAllInstalledApps(userId, scope.apps);
      const appsFailed = appResults.filter((r) => !r.ok);
      if (appsFailed.length) {
        logger.warn(`Self-update: ${appsFailed.length}/${appResults.length} app(s) failed to update`, {
          failed: appsFailed.map((r) => r.serviceName),
        });
      }
      await pruneDockerCruft('updating_apps');
    }
    const appsFailed = appResults.filter((r) => !r.ok);

    // No `--build` on the restarts: the `building` phase already tagged the
    // image (plan.md §295/§297 — this is the step that got SIGKILLed under
    // swap pressure). `up -d` reuses the image on disk.
    if (scope.frontend) {
      await updateRun(runId, { state: 'restarting_frontend' });
      await runCommand(
        'docker',
        ['compose', '-f', composeFilePath(repoRoot), 'up', '-d', 'frontend'],
        { timeout: BUILD_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, env: BUILD_ENV }
      );
    }

    await writeAuditLog({
      userId,
      action: 'self_update_trigger',
      resource: toCommit,
      metadata: {
        fromCommit: check.currentCommit,
        toCommit,
        scope: { build: buildTargets, apps: scope.apps === null ? 'all' : [...scope.apps] },
        appsUpdated: appResults.length - appsFailed.length,
        appsFailed: appsFailed.map((r) => r.serviceName),
      },
    }).catch(() => {});

    if (!scope.backend) {
      // Backend image unchanged — no self-restart, so the run finishes here.
      await updateRun(runId, { state: 'done', finished: true });
      logger.info('Self-update: applied without a backend restart', { runId });
      return;
    }

    // Mark restarting_backend (with finished_at) *before* spawning the command
    // that replaces this process — a row stuck here after a boot is still
    // legible as "got this far", and reconcileDanglingSelfUpdateRun closes it
    // out once the new process starts.
    await updateRun(runId, { state: 'restarting_backend', finished: true });
    const child = spawn(
      'docker',
      ['compose', '-f', composeFilePath(repoRoot), 'up', '-d', 'backend'],
      { detached: true, stdio: 'ignore', env: BUILD_ENV }
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
// Every state before the two terminal ones — a run stuck in any of these
// when a new process boots is dangling, not just restarting_backend
// (originally the only one recognized here; found live, plan.md §295, when
// backend's own detached self-replacement was killed by something
// unrelated — real memory pressure under that run's own build+all-apps
// load spike — leaving the *earlier* restarting_frontend row stuck
// forever with no code path that would ever touch it again).
const DANGLING_STATES: readonly SelfUpdateRunState[] = [
  'checking',
  'pulling',
  'building',
  'updating_apps',
  'restarting_frontend',
  'restarting_backend',
];

export async function reconcileDanglingSelfUpdateRun(): Promise<void> {
  const latest = await getLatestRun();
  if (!latest || !DANGLING_STATES.includes(latest.state)) {
    return;
  }

  // This process booting is evidence *something* restarted — but only for
  // restarting_backend is that guaranteed to be the self-update sequence's
  // own restart (plan.md §131.4's original design: that state means the
  // detached final step, recreating this very container, was already
  // issued). Any earlier stuck state could just as easily be an unrelated
  // crash, a host reboot mid-run, or the backend swap finished by hand
  // afterward (as happened live) rather than by self-update's own code —
  // don't assume either way. Compare what commit is actually running
  // against what this run was trying to reach instead of guessing.
  let actualCommit: string | null = null;
  try {
    const repoRoot = requireRepoRoot();
    actualCommit = (await runGit(['-C', repoRoot, 'rev-parse', 'HEAD'], { timeout: 10_000 })).trim();
  } catch (error) {
    logger.warn('Could not read the current commit while reconciling a dangling self-update run', {
      runId: latest.id,
      error: (error as Error).message,
    });
  }

  if (actualCommit && latest.toCommit && actualCommit === latest.toCommit) {
    await updateRun(latest.id, { state: 'done', ...(latest.finishedAt ? {} : { finished: true }) });
    logger.info('Self-update completed — running commit matches this run\'s target', {
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
    return;
  }

  const message =
    'The process restarted before this self-update finished, and the commit now running does not match what this run was trying to reach — it did not complete.';
  await updateRun(latest.id, { state: 'error', errorMessage: message, finished: true });
  logger.warn('Self-update run left dangling and did not complete', {
    runId: latest.id,
    state: latest.state,
    toCommit: latest.toCommit,
    actualCommit,
  });
  await writeAuditLog({
    userId: null,
    action: 'self_update_reconcile_failed',
    resource: latest.toCommit ?? undefined,
    metadata: { state: latest.state, toCommit: latest.toCommit, actualCommit },
  }).catch(() => {});
}

