import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factory below can close over it: mock factories run
// before the module body.
const backup = vi.hoisted(() => ({
  createBackupArchive: vi.fn(async () => 'backup-new.tar.gz'),
  getBackupScheduleConfig: vi.fn(),
  pruneOldBackups: vi.fn(async () => [] as string[]),
  setBackupScheduleLastRun: vi.fn(async () => {}),
}));

vi.mock('./backup', () => backup);
vi.mock('./appDumps', () => ({ dumpAllAppDatabases: vi.fn(async () => ({ ok: 0, failed: 0, outcomes: [] })) }));
vi.mock('./duplicatiClient', () => ({ runBackupJobNow: vi.fn(async () => ({ started: true, detail: 'ok' })) }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn(() => null) }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runScheduledBackupCheck, shouldRunScheduledBackup } from './backupScheduler';

describe('shouldRunScheduledBackup', () => {
  it('runs immediately when there is no prior run', () => {
    expect(shouldRunScheduledBackup(new Date('2026-08-26T12:00:00Z'), null, 'daily')).toBe(true);
  });

  it('runs immediately when the stored last-run value is unparseable', () => {
    expect(shouldRunScheduledBackup(new Date('2026-08-26T12:00:00Z'), 'not-a-date', 'daily')).toBe(true);
  });

  it('does not run daily backups before 24 hours have elapsed', () => {
    const lastRunAt = '2026-08-26T00:00:00Z';
    const now = new Date('2026-08-26T23:59:00Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'daily')).toBe(false);
  });

  it('runs daily backups once 24 hours have elapsed', () => {
    const lastRunAt = '2026-08-26T00:00:00Z';
    const now = new Date('2026-08-27T00:00:01Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'daily')).toBe(true);
  });

  it('does not run weekly backups before 7 days have elapsed', () => {
    const lastRunAt = '2026-08-20T00:00:00Z';
    const now = new Date('2026-08-26T23:59:00Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'weekly')).toBe(false);
  });

  it('runs weekly backups once 7 days have elapsed', () => {
    const lastRunAt = '2026-08-19T00:00:00Z';
    const now = new Date('2026-08-26T00:00:01Z');
    expect(shouldRunScheduledBackup(now, lastRunAt, 'weekly')).toBe(true);
  });
});

describe('runScheduledBackupCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backup.pruneOldBackups.mockResolvedValue([]);
  });

  it('enforces retention even when no backup is due, so a lowered count takes effect', async () => {
    backup.getBackupScheduleConfig.mockResolvedValue({
      enabled: true,
      frequency: 'daily',
      retentionCount: 3,
      lastRunAt: new Date().toISOString(),
    });

    await runScheduledBackupCheck();

    expect(backup.createBackupArchive).not.toHaveBeenCalled();
    expect(backup.pruneOldBackups).toHaveBeenCalledWith(3);
  });

  it('prunes after making a backup when one is due', async () => {
    backup.getBackupScheduleConfig.mockResolvedValue({
      enabled: true,
      frequency: 'daily',
      retentionCount: 5,
      lastRunAt: null,
    });

    await runScheduledBackupCheck();

    expect(backup.createBackupArchive).toHaveBeenCalled();
    expect(backup.pruneOldBackups).toHaveBeenCalledWith(5);
  });

  it('leaves the directory alone while automatic backups are off', async () => {
    backup.getBackupScheduleConfig.mockResolvedValue({
      enabled: false,
      frequency: 'daily',
      retentionCount: 1,
      lastRunAt: null,
    });

    await runScheduledBackupCheck();

    expect(backup.pruneOldBackups).not.toHaveBeenCalled();
  });

  it('does not let a failed prune escape the check', async () => {
    backup.getBackupScheduleConfig.mockResolvedValue({
      enabled: true,
      frequency: 'daily',
      retentionCount: 3,
      lastRunAt: new Date().toISOString(),
    });
    backup.pruneOldBackups.mockRejectedValue(new Error('permission denied'));

    await expect(runScheduledBackupCheck()).resolves.toBeUndefined();
  });
});
