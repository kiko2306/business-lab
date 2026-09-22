import { writeAuditLog } from '../utils/audit';
import { publishAlert } from '../utils/alertNotify';
import { dumpAllAppDatabases } from './appDumps';
import { snapshotAppData as snapshotKopiaAppDataNow } from './kopiaClient';
import { readAppEnvValue } from './appEnv';
import { withMaintenanceLock } from './maintenanceLock';
import { startBackupProgress, reportBackupStep, setBackupPhase, finishBackupProgress } from './backupProgress';
import logger from '../utils/logger';
import {
  BackupRunOutcome,
  BackupScheduleFrequency,
  createBackupArchive,
  getBackupScheduleConfig,
  pruneOldBackups,
  recordBackupScheduleRun,
} from './backup';

const FREQUENCY_MS: Record<BackupScheduleFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// How often to check whether a scheduled backup is due. Independent of the
// configured frequency itself, so an hourly poll can serve both daily and
// weekly schedules without a real cron parser.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * How many consecutive failures are retried at the check interval rather than
 * the configured cadence.
 *
 * A failed run should not wait a whole day to try again — that was the third
 * complaint in §86.2. But a backup failing because it is *misconfigured* (no
 * destination, no password, a revoked token) fails identically every hour, and
 * re-archiving and re-dumping thirty databases hourly forever is not a retry,
 * it is a treadmill. After this many it falls back to the normal cadence and
 * waits for a human, which is what the dashboard card in §75.2 is for.
 */
const MAX_FAST_RETRIES = 3;

export interface LastRunState {
  outcome: BackupRunOutcome | null;
  consecutiveFailures: number;
}

/**
 * The check is hourly, so `runAtTime` ("HH:mm") is honoured to the hour, not
 * the minute — the poll only ever wakes up on the hour anyway.
 */
function matchesRunAtHour(now: Date, runAtTime: string | null | undefined): boolean {
  if (!runAtTime) {
    return true;
  }
  const hour = Number.parseInt(runAtTime.slice(0, 2), 10);
  return Number.isFinite(hour) && now.getHours() === hour;
}

export function shouldRunScheduledBackup(
  now: Date,
  lastRunAt: string | null,
  frequency: BackupScheduleFrequency,
  lastRun: LastRunState = { outcome: null, consecutiveFailures: 0 },
  runAtTime: string | null = null
): boolean {
  const retrying = lastRun.outcome === 'failed' && lastRun.consecutiveFailures <= MAX_FAST_RETRIES;
  // A fast retry after a failure ignores the configured hour — waiting up to a
  // day for the next matching hour would defeat the point of retrying fast.
  if (!retrying && !matchesRunAtHour(now, runAtTime)) {
    return false;
  }
  if (!lastRunAt) {
    return true;
  }
  const lastRunMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastRunMs)) {
    return true;
  }
  return now.getTime() - lastRunMs >= (retrying ? CHECK_INTERVAL_MS : FREQUENCY_MS[frequency]);
}

export async function runScheduledBackupCheck(): Promise<void> {
  const config = await getBackupScheduleConfig();
  if (!config.enabled) {
    return;
  }
  if (
    !shouldRunScheduledBackup(
      new Date(),
      config.lastRunAt,
      config.frequency,
      { outcome: config.lastOutcome, consecutiveFailures: config.consecutiveFailures },
      config.runAtTime
    )
  ) {
    // Still enforce retention on a check with nothing due: a lowered "keep
    // last", or an archive that arrived by some other route, would otherwise
    // sit in the list contradicting the setting until the next backup runs.
    await prune(config.retentionCount);
    return;
  }

  // Claim the run as failed BEFORE doing any work, and let only a clean finish
  // overwrite it (§508). A run that takes the process down with it — a 723 MB
  // dump OOM-killing the backend — never reaches the end-of-run stamp, so the
  // old timestamp stayed put, the next boot found the backup overdue again,
  // and one crash became 853 restarts ~40 s apart. Claimed up front, a crash
  // counts as a failure and waits out the MAX_FAST_RETRIES back-off instead.
  await recordBackupScheduleRun('failed');

  try {
    const fileName = await createBackupArchive();
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: fileName,
      result: 'success',
      metadata: { trigger: 'scheduled' },
    });

    await prune(config.retentionCount);

    // The dashboard's own archive above covers the control plane. App data is
    // Kopia's job, and it needs consistent dumps first — copying live
    // Postgres files and open SQLite WALs can restore torn (§70).
    //
    // Ordering is the whole point: dump, then back up. Snapshotting first
    // would archive the *previous* dump, silently making every backup a day
    // stale.
    const appData = await runAppDataBackup();

    // Success is stamped here, at the end — not before the app data has
    // moved, and not unconditionally. Doing it the old way is why 2026-09-01
    // left a fresh timestamp, a `success` audit row and a 24-hour wait on a
    // run whose app data never left the machine (§86.2). A failed run needs
    // no second stamp: the claim above already recorded it.
    if (appData.ok) {
      await recordBackupScheduleRun('success');
    }
  } catch (error) {
    logger.error('Scheduled backup failed', { error: (error as Error).message });
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: 'backup',
      result: 'failure',
      metadata: { trigger: 'scheduled' },
    });
    await publishAlert({
      category: 'backup',
      title: 'Backup: control-plane archive failed',
      message: (error as Error).message,
      tags: ['floppy_disk'],
      priority: 4,
    });
  }
}

async function prune(retentionCount: number): Promise<void> {
  try {
    const deleted = await pruneOldBackups(retentionCount);
    if (deleted.length > 0) {
      logger.info('Pruned backups beyond the retention count', { deleted, retentionCount });
    }
  } catch (error) {
    logger.error('Backup retention cleanup failed', { error: (error as Error).message });
  }
}

/**
 * How many per-app failures are recorded on one audit row. The real count is
 * recorded separately, so a truncated list is still visibly truncated.
 */
const MAX_RECORDED_FAILURES = 25;

/**
 * Dump every app database, then ask Kopia to snapshot them.
 *
 * Never throws — for the scheduler, the dashboard's own backup has already
 * succeeded by this point and losing that to an app-data problem would be a
 * poor trade. It reports instead, so the caller can stamp the run with what
 * really happened.
 *
 * `trigger` is recorded on the audit row and is the only difference between
 * the scheduled run and the dashboard's "Full Backup" button (§74.6). The
 * button MUST come through here rather than calling `snapshotKopiaAppDataNow`
 * directly: the dump has to happen first, or Kopia snapshots the *previous*
 * dump and the manual backup is silently a generation stale.
 */
export async function runAppDataBackup(
  trigger: 'scheduled' | 'manual' = 'scheduled'
): Promise<{ ok: boolean; detail: string }> {
  // Serialise against a self-update's app-update batch
  // (executor.pullAndRecreateService, §209): a `docker compose up
  // --force-recreate` landing mid-dump aborts pg_dump for that app and the
  // run is silently short a database. The dump is ~20s, so an update
  // waiting on it — or a scheduled dump waiting on a pull — is fine.
  return withMaintenanceLock(`backup:app-data:${trigger}`, () => runAppDataBackupLocked(trigger));
}

async function runAppDataBackupLocked(
  trigger: 'scheduled' | 'manual'
): Promise<{ ok: boolean; detail: string }> {
  startBackupProgress(trigger);
  const report = await dumpAllAppDatabases((index, total, label) => reportBackupStep(index, total, label));

  // Which apps failed and why, not merely how many. §86.3: a scheduled run
  // recorded `failed: 8` and nothing else, and by the time anyone looked the
  // per-app reasons had been discarded and the backend's log files had gone
  // with the container that wrote them. Eight is also exactly the number of
  // apps with a separate database container — so an entire class of dump
  // failing at once was indistinguishable, in the record, from eight
  // unrelated hiccups. The report already carries the reasons; throwing them
  // away is what cost the diagnosis.
  const failures = report.outcomes
    .filter((o) => !o.ok)
    .slice(0, MAX_RECORDED_FAILURES)
    .map((o) => ({ app: o.app, kind: o.kind, detail: o.detail.slice(0, 200) }));

  if (report.failed > 0) {
    // Worth surfacing but not worth aborting: the dumps that succeeded are
    // still worth backing up, and a stopped app counts as a success anyway.
    logger.warn('Some app databases could not be dumped', { failed: report.failed, failures });
  }

  const password = readAppEnvValue('kopia', 'KOPIA_SERVER_PASSWORD');
  if (!password) {
    const detail = 'the backup engine has no password configured yet';
    logger.info('Skipping the app-data backup: Kopia has no password yet');
    // Still record the dump outcome. Returning silently here is how a run
    // whose dumps all failed could leave no audit trail at all — the archive
    // row above would be the only trace, and it says "success".
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: 'app-data',
      result: 'failure',
      metadata: { trigger, dumped: report.ok, failed: report.failed, failures, detail },
    });
    await publishAlert({
      category: 'backup',
      title: 'Backup: app-data snapshot failed',
      message: `App data was not backed up: ${detail}.`,
      tags: ['floppy_disk'],
      priority: 4,
    });
    finishBackupProgress(false, detail);
    return { ok: false, detail };
  }

  setBackupPhase('snapshotting');
  // Same retention the schedule shows for the local archive, so "keep last N"
  // means one thing rather than a different number on each copy.
  const { retentionCount } = await getBackupScheduleConfig();
  const run = await snapshotKopiaAppDataNow(password, retentionCount);
  logger.info('App-data backup', { started: run.started, detail: run.detail, dumped: report.ok, trigger });
  await writeAuditLog({
    userId: null,
    action: 'backup_create',
    resource: 'app-data',
    result: run.started ? 'success' : 'failure',
    metadata: { trigger, dumped: report.ok, failed: report.failed, failures, detail: run.detail },
  });
  if (!run.started) {
    await publishAlert({
      category: 'backup',
      title: 'Backup: app-data snapshot failed',
      message: `App data was not backed up: ${run.detail}.`,
      tags: ['floppy_disk'],
      priority: 4,
    });
  }

  // A run counts as successful when the app data reached the backup engine.
  // Individual dump failures are on the audit row (§88.5) and do not by
  // themselves fail the run — one app's database being unreachable should not
  // put the whole schedule into retry. A run where *nothing* dumped is
  // different: it has made nothing safe, whatever the engine then did with it.
  const ok = run.started && !(report.ok === 0 && report.failed > 0);
  const detail =
    report.failed > 0
      ? `${run.detail}; ${report.failed} database dump${report.failed === 1 ? '' : 's'} failed`
      : run.detail;
  finishBackupProgress(ok, detail);
  return { ok, detail };
}

export function startBackupScheduler(): void {
  runScheduledBackupCheck().catch((error: Error) => {
    logger.error('Initial scheduled backup check failed', { error: error.message });
  });

  setInterval(() => {
    runScheduledBackupCheck().catch((error: Error) => {
      logger.error('Scheduled backup check failed', { error: error.message });
    });
  }, CHECK_INTERVAL_MS);
}
