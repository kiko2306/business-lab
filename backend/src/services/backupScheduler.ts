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

    const deleted = await pruneOldBackups(config.retentionCount);
    if (deleted.length > 0) {
      logger.info('Pruned old backups after scheduled run', { deleted, retentionCount: config.retentionCount });
    }

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

/**
 * Dump every app database, then ask Duplicati to run.
 *
 * Never throws — the dashboard's own backup has already succeeded by this
 * point, and losing that to an app-data problem would be a poor trade.
 */
async function runAppDataBackup(): Promise<void> {
  const report = await dumpAllAppDatabases();
  if (report.failed > 0) {
    // Worth surfacing but not worth aborting: the dumps that succeeded are
    // still worth backing up, and a stopped app counts as a success anyway.
    logger.warn('Some app databases could not be dumped', {
      failed: report.failed,
      apps: report.outcomes.filter((o) => !o.ok).map((o) => o.app),
    });
  }

  const password = readAppEnvValue('duplicati', 'DUPLICATI_WEB_PASSWORD');
  if (!password) {
    logger.info('Skipping the app-data backup: Duplicati has no password yet');
    return;
  }

  const run = await runBackupJobNow(password);
  logger.info('App-data backup', { started: run.started, detail: run.detail, dumped: report.ok });
  await writeAuditLog({
    userId: null,
    action: 'backup_create',
    resource: 'app-data',
    result: run.started ? 'success' : 'failure',
    metadata: { trigger: 'scheduled', dumped: report.ok, failed: report.failed, detail: run.detail },
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
