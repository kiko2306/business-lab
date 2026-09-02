import { writeAuditLog } from '../utils/audit';
import { dumpAllAppDatabases } from './appDumps';
import { runBackupJobNow } from './duplicatiClient';
import { readAppEnvValue } from './appEnv';
import logger from '../utils/logger';
import {
  BackupScheduleFrequency,
  createBackupArchive,
  getBackupScheduleConfig,
  pruneOldBackups,
  setBackupScheduleLastRun,
} from './backup';

const FREQUENCY_MS: Record<BackupScheduleFrequency, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

// How often to check whether a scheduled backup is due. Independent of the
// configured frequency itself, so an hourly poll can serve both daily and
// weekly schedules without a real cron parser.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function shouldRunScheduledBackup(now: Date, lastRunAt: string | null, frequency: BackupScheduleFrequency): boolean {
  if (!lastRunAt) {
    return true;
  }
  const lastRunMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastRunMs)) {
    return true;
  }
  return now.getTime() - lastRunMs >= FREQUENCY_MS[frequency];
}

export async function runScheduledBackupCheck(): Promise<void> {
  const config = await getBackupScheduleConfig();
  if (!config.enabled) {
    return;
  }
  if (!shouldRunScheduledBackup(new Date(), config.lastRunAt, config.frequency)) {
    // Still enforce retention on a check with nothing due: a lowered "keep
    // last", or an archive that arrived by some other route, would otherwise
    // sit in the list contradicting the setting until the next backup runs.
    await prune(config.retentionCount);
    return;
  }

  try {
    const fileName = await createBackupArchive();
    await setBackupScheduleLastRun(new Date().toISOString());
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: fileName,
      result: 'success',
      metadata: { trigger: 'scheduled' },
    });

    await prune(config.retentionCount);

    // The dashboard's own archive above covers the control plane. App data is
    // Duplicati's job, and it needs consistent dumps first — copying live
    // Postgres files and open SQLite WALs can restore torn (§70).
    //
    // Ordering is the whole point: dump, then back up. Running Duplicati first
    // would archive the *previous* dump, silently making every backup a day
    // stale.
    await runAppDataBackup();
  } catch (error) {
    logger.error('Scheduled backup failed', { error: (error as Error).message });
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: 'backup',
      result: 'failure',
      metadata: { trigger: 'scheduled' },
    }).catch(() => {});
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
 * Dump every app database, then ask Duplicati to run.
 *
 * Never throws — the dashboard's own backup has already succeeded by this
 * point, and losing that to an app-data problem would be a poor trade.
 */
async function runAppDataBackup(): Promise<void> {
  const report = await dumpAllAppDatabases();

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

  const password = readAppEnvValue('duplicati', 'DUPLICATI_WEB_PASSWORD');
  if (!password) {
    logger.info('Skipping the app-data backup: Duplicati has no password yet');
    // Still record the dump outcome. Returning silently here is how a run
    // whose dumps all failed could leave no audit trail at all — the archive
    // row above would be the only trace, and it says "success".
    await writeAuditLog({
      userId: null,
      action: 'backup_create',
      resource: 'app-data',
      result: 'failure',
      metadata: {
        trigger: 'scheduled',
        dumped: report.ok,
        failed: report.failed,
        failures,
        detail: 'the backup engine has no password configured yet',
      },
    }).catch(() => {});
    return;
  }

  const run = await runBackupJobNow(password);
  logger.info('App-data backup', { started: run.started, detail: run.detail, dumped: report.ok });
  await writeAuditLog({
    userId: null,
    action: 'backup_create',
    resource: 'app-data',
    result: run.started ? 'success' : 'failure',
    metadata: { trigger: 'scheduled', dumped: report.ok, failed: report.failed, failures, detail: run.detail },
  }).catch(() => {});
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
