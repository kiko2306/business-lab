import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can close over them: mock factories
// run before the module body.
const backup = vi.hoisted(() => ({
  createBackupArchive: vi.fn(async () => 'backup-new.tar.gz'),
  getBackupScheduleConfig: vi.fn(),
  pruneOldBackups: vi.fn(async () => [] as string[]),
  setBackupScheduleLastRun: vi.fn(async () => {}),
}));
const dumps = vi.hoisted(() => ({
  dumpAllAppDatabases: vi.fn(async () => ({
    ok: 0,
    failed: 0,
    outcomes: [] as { app: string; kind: string; ok: boolean; detail: string }[],
  })),
}));
const duplicati = vi.hoisted(() => ({ runBackupJobNow: vi.fn(async () => ({ started: true, detail: 'ok' })) }));
const appEnv = vi.hoisted(() => ({ readAppEnvValue: vi.fn((): string | null => null) }));
const audit = vi.hoisted(() => ({
  writeAuditLog: vi.fn(
    async (_options: {
      resource?: string | null;
      result?: string;
      metadata?: Record<string, unknown>;
    }) => {}
  ),
}));

vi.mock('./backup', () => backup);
vi.mock('./appDumps', () => dumps);
vi.mock('./duplicatiClient', () => duplicati);
vi.mock('./appEnv', () => appEnv);
vi.mock('../utils/audit', () => audit);
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

describe('runAppDataBackup failure reporting', () => {
  const due = {
    enabled: true,
    frequency: 'daily' as const,
    retentionCount: 3,
    lastRunAt: null,
  };

  // The audit row for the dashboard's own archive is written first; the
  // app-data one is the row this describe block is about.
  const appDataRow = () =>
    audit.writeAuditLog.mock.calls.map((call) => call[0]).find((options) => options.resource === 'app-data');

  beforeEach(() => {
    vi.clearAllMocks();
    backup.pruneOldBackups.mockResolvedValue([]);
    backup.getBackupScheduleConfig.mockResolvedValue(due);
    appEnv.readAppEnvValue.mockReturnValue('duplicati-password');
    duplicati.runBackupJobNow.mockResolvedValue({ started: true, detail: 'ok' });
  });

  it('records which apps failed to dump and why, not just how many', async () => {
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 1,
      failed: 2,
      outcomes: [
        { app: 'vaultwarden', kind: 'sqlite', ok: true, detail: 'snapshot 272 KB' },
        { app: 'nextcloud', kind: 'postgres', ok: false, detail: 'could not resolve host nextcloud-db' },
        { app: 'immich', kind: 'postgres', ok: false, detail: 'network homelab-net not found' },
      ],
    });

    await runScheduledBackupCheck();

    // §86.3: "failed: 2" alone cannot tell you that a whole class of dump went
    // down together, which is exactly the question that could not be answered
    // about the 2026-09-01 run.
    expect(appDataRow()?.metadata).toMatchObject({
      dumped: 1,
      failed: 2,
      failures: [
        { app: 'nextcloud', kind: 'postgres', detail: 'could not resolve host nextcloud-db' },
        { app: 'immich', kind: 'postgres', detail: 'network homelab-net not found' },
      ],
    });
  });

  it('records the dump outcome even when the backup engine has no password', async () => {
    appEnv.readAppEnvValue.mockReturnValue(null);
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 0,
      failed: 1,
      outcomes: [{ app: 'paperless', kind: 'postgres', ok: false, detail: 'connection refused' }],
    });

    await runScheduledBackupCheck();

    // Returning silently here used to leave the archive row — which says
    // "success" — as the only trace of a run whose dumps all failed.
    const row = appDataRow();
    expect(row?.result).toBe('failure');
    expect(row?.metadata).toMatchObject({
      failed: 1,
      failures: [{ app: 'paperless', kind: 'postgres', detail: 'connection refused' }],
    });
    expect(duplicati.runBackupJobNow).not.toHaveBeenCalled();
  });

  it('caps the recorded failures while keeping the true count', async () => {
    const outcomes = Array.from({ length: 30 }, (_, i) => ({
      app: `app-${i}`,
      kind: 'sqlite',
      ok: false,
      detail: 'sqlite .backup failed',
    }));
    dumps.dumpAllAppDatabases.mockResolvedValue({ ok: 0, failed: 30, outcomes });

    await runScheduledBackupCheck();

    const metadata = appDataRow()?.metadata as { failed: number; failures: unknown[] };
    expect(metadata.failed).toBe(30);
    expect(metadata.failures).toHaveLength(25);
  });

  it('records no failures when every dump succeeded', async () => {
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 2,
      failed: 0,
      outcomes: [
        { app: 'ntfy', kind: 'sqlite', ok: true, detail: 'snapshot 60 KB' },
        { app: 'n8n', kind: 'postgres', ok: true, detail: 'dumped 442 KB' },
      ],
    });

    await runScheduledBackupCheck();

    expect(appDataRow()?.metadata).toMatchObject({ dumped: 2, failed: 0, failures: [] });
  });
});
