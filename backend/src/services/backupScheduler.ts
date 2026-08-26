import { writeAuditLog } from '../utils/audit';
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
