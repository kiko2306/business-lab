import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can close over them: mock factories
// run before the module body.
const backup = vi.hoisted(() => ({
  createBackupArchive: vi.fn(async () => 'backup-new.tar.gz'),
  getBackupScheduleConfig: vi.fn(),
  pruneOldBackups: vi.fn(async () => [] as string[]),
  recordBackupScheduleRun: vi.fn(async (_outcome: 'success' | 'failed') => {}),
}));
const dumps = vi.hoisted(() => ({
  dumpAllAppDatabases: vi.fn(async () => ({
    ok: 0,
    failed: 0,
    outcomes: [] as { app: string; kind: string; ok: boolean; detail: string }[],
  })),
}));
const duplicati = vi.hoisted(() => ({ runBackupJobNow: vi.fn(async () => ({ started: true, detail: 'ok' })) }));
const kopia = vi.hoisted(() => ({
  snapshotAppData: vi.fn(async () => ({ started: true, detail: 'triggered a Kopia snapshot of /source/apps' })),
}));
// readAppEnvValue is shared by both engines; the key it is called with tells
// them apart. Default: neither has a password.
const appEnv = vi.hoisted(() => ({ readAppEnvValue: vi.fn((_app: string, _key: string): string | null => null) }));
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
vi.mock('./kopiaClient', () => kopia);
vi.mock('./appEnv', () => appEnv);
vi.mock('../utils/audit', () => audit);
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runAppDataBackup, runScheduledBackupCheck, shouldRunScheduledBackup } from './backupScheduler';

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
      lastOutcome: 'success',
      lastSuccessAt: new Date().toISOString(),
      consecutiveFailures: 0,
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
      lastOutcome: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
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
      lastOutcome: null,
      lastSuccessAt: null,
      consecutiveFailures: 0,
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
      lastOutcome: 'success',
      lastSuccessAt: new Date().toISOString(),
      consecutiveFailures: 0,
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
    lastOutcome: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
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

describe('runAppDataBackup — the on-demand "Back up now" path (§74.6)', () => {
  const appDataRow = () =>
    audit.writeAuditLog.mock.calls.map((call) => call[0]).find((options) => options.resource === 'app-data');

  beforeEach(() => {
    vi.clearAllMocks();
    appEnv.readAppEnvValue.mockReturnValue('duplicati-password');
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 3,
      failed: 0,
      outcomes: [{ app: 'n8n', kind: 'postgres', ok: true, detail: 'dumped 442 KB' }],
    });
    duplicati.runBackupJobNow.mockResolvedValue({ started: true, detail: 'queued Duplicati job 3' });
  });

  it('dumps first, then triggers Duplicati, and stamps the row as a manual run', async () => {
    const result = await runAppDataBackup('manual');

    const order = [
      dumps.dumpAllAppDatabases.mock.invocationCallOrder[0],
      duplicati.runBackupJobNow.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]); // dump before archive, or it is a generation stale
    expect(appDataRow()?.metadata).toMatchObject({ trigger: 'manual', dumped: 3, failed: 0 });
    expect(result).toEqual({ ok: true, detail: 'queued Duplicati job 3' });
  });

  it('defaults to a scheduled trigger when none is given', async () => {
    await runAppDataBackup();
    expect(appDataRow()?.metadata).toMatchObject({ trigger: 'scheduled' });
  });

  it('fails with a usable reason when the backup engine has no password', async () => {
    appEnv.readAppEnvValue.mockReturnValue(null);
    const result = await runAppDataBackup('manual');
    expect(result).toEqual({ ok: false, detail: 'the backup engine has no password configured yet' });
    expect(duplicati.runBackupJobNow).not.toHaveBeenCalled();
  });

  it('notes partial dump failures in the returned detail without failing the run', async () => {
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 2,
      failed: 1,
      outcomes: [{ app: 'immich', kind: 'postgres', ok: false, detail: 'network not found' }],
    });
    const result = await runAppDataBackup('manual');
    expect(result.ok).toBe(true);
    expect(result.detail).toBe('queued Duplicati job 3; 1 database dump failed');
  });

  it('fails when nothing dumped and the engine was never reached', async () => {
    dumps.dumpAllAppDatabases.mockResolvedValue({
      ok: 0,
      failed: 2,
      outcomes: [
        { app: 'a', kind: 'sqlite', ok: false, detail: 'x' },
        { app: 'b', kind: 'sqlite', ok: false, detail: 'y' },
      ],
    });
    duplicati.runBackupJobNow.mockResolvedValue({ started: true, detail: 'queued' });
    const result = await runAppDataBackup('manual');
    expect(result.ok).toBe(false);
  });
});

describe('recording what the run actually did', () => {
  const due = {
    enabled: true,
    frequency: 'daily' as const,
    retentionCount: 3,
    lastRunAt: null,
    lastOutcome: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    backup.pruneOldBackups.mockResolvedValue([]);
    backup.getBackupScheduleConfig.mockResolvedValue(due);
    appEnv.readAppEnvValue.mockReturnValue('duplicati-password');
    duplicati.runBackupJobNow.mockResolvedValue({ started: true, detail: 'ok' });
    dumps.dumpAllAppDatabases.mockResolvedValue({ ok: 3, failed: 0, outcomes: [] });
  });

  it('stamps the run only after the app data has moved', async () => {
    const order: string[] = [];
    dumps.dumpAllAppDatabases.mockImplementation(async () => {
      order.push('dump');
      return { ok: 3, failed: 0, outcomes: [] };
    });
    duplicati.runBackupJobNow.mockImplementation(async () => {
      order.push('engine');
      return { started: true, detail: 'ok' };
    });
    backup.recordBackupScheduleRun.mockImplementation(async () => {
      order.push('stamp');
    });

    await runScheduledBackupCheck();

    // The old order was stamp-then-dump, which is why a total app-data failure
    // still left a fresh timestamp behind it (§86.2).
    expect(order).toEqual(['dump', 'engine', 'stamp']);
  });

  it('records success when the app data reached the engine', async () => {
    await runScheduledBackupCheck();
    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('success');
  });

  it('records failure when the engine refused to start', async () => {
    duplicati.runBackupJobNow.mockResolvedValue({ started: false, detail: 'rejected the password' });

    await runScheduledBackupCheck();

    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('failed');
  });

  it('records failure when there is no password to hand the engine', async () => {
    appEnv.readAppEnvValue.mockReturnValue(null);

    await runScheduledBackupCheck();

    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('failed');
  });

  it('records failure when every dump failed, since nothing was made safe', async () => {
    dumps.dumpAllAppDatabases.mockResolvedValue({ ok: 0, failed: 4, outcomes: [] });

    await runScheduledBackupCheck();

    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('failed');
  });

  it('still records success when only some dumps failed', async () => {
    // One unreachable database must not put the whole schedule into retry.
    dumps.dumpAllAppDatabases.mockResolvedValue({ ok: 30, failed: 1, outcomes: [] });

    await runScheduledBackupCheck();

    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('success');
  });

  it('records failure when the archive itself throws', async () => {
    backup.createBackupArchive.mockRejectedValue(new Error('no space left on device'));

    await runScheduledBackupCheck();

    expect(backup.recordBackupScheduleRun).toHaveBeenCalledWith('failed');
  });
});

describe('Kopia runs in parallel with Duplicati (§81.5)', () => {
  const appDataRow = () =>
    audit.writeAuditLog.mock.calls.map((call) => call[0]).find((options) => options.resource === 'app-data');

  beforeEach(() => {
    vi.clearAllMocks();
    dumps.dumpAllAppDatabases.mockResolvedValue({ ok: 3, failed: 0, outcomes: [] });
    duplicati.runBackupJobNow.mockResolvedValue({ started: true, detail: 'queued Duplicati job 3' });
    kopia.snapshotAppData.mockResolvedValue({ started: true, detail: 'triggered a Kopia snapshot of /source/apps' });
  });

  it('snapshots Kopia with its own password and records the outcome on the audit row', async () => {
    appEnv.readAppEnvValue.mockImplementation((app: string) =>
      app === 'kopia' ? 'kopia-password' : 'duplicati-password'
    );

    await runAppDataBackup('manual');

    expect(kopia.snapshotAppData).toHaveBeenCalledWith('kopia-password');
    expect(appDataRow()?.metadata).toMatchObject({
      kopia: { started: true, detail: 'triggered a Kopia snapshot of /source/apps' },
    });
  });

  it('does not let a Kopia failure change the run outcome — Duplicati still gates it', async () => {
    appEnv.readAppEnvValue.mockReturnValue('a-password');
    kopia.snapshotAppData.mockResolvedValue({ started: false, detail: 'Kopia is not reachable' });

    const result = await runAppDataBackup('manual');

    expect(result).toEqual({ ok: true, detail: 'queued Duplicati job 3' });
    expect(appDataRow()?.result).toBe('success');
    expect(appDataRow()?.metadata).toMatchObject({ kopia: { started: false } });
  });

  it('skips Kopia quietly when it has no password, and still records that', async () => {
    appEnv.readAppEnvValue.mockImplementation((app: string) =>
      app === 'kopia' ? null : 'duplicati-password'
    );

    await runAppDataBackup('manual');

    expect(kopia.snapshotAppData).not.toHaveBeenCalled();
    expect(appDataRow()?.metadata).toMatchObject({
      kopia: { started: false, detail: 'Kopia has no password configured yet' },
    });
  });

  it('still snapshots Kopia when Duplicati has no password', async () => {
    appEnv.readAppEnvValue.mockImplementation((app: string) =>
      app === 'kopia' ? 'kopia-password' : null
    );

    const result = await runAppDataBackup('manual');

    expect(kopia.snapshotAppData).toHaveBeenCalledWith('kopia-password');
    // Duplicati still gates: no password there is a failed run.
    expect(result.ok).toBe(false);
    expect(appDataRow()?.metadata).toMatchObject({ kopia: { started: true } });
  });
});

describe('retrying a failed run', () => {
  const hoursAgo = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

  it('retries a failed daily run at the next hourly check, not a day later', () => {
    expect(
      shouldRunScheduledBackup(new Date(), hoursAgo(2), 'daily', { outcome: 'failed', consecutiveFailures: 1 })
    ).toBe(true);
  });

  it('does not retry a failed run before the check interval has passed', () => {
    expect(
      shouldRunScheduledBackup(new Date(), hoursAgo(0.5), 'daily', { outcome: 'failed', consecutiveFailures: 1 })
    ).toBe(false);
  });

  it('falls back to the normal cadence once the retry budget is spent', () => {
    // A misconfigured backup fails identically every hour; hourly forever is a
    // treadmill, not a retry.
    expect(
      shouldRunScheduledBackup(new Date(), hoursAgo(2), 'daily', { outcome: 'failed', consecutiveFailures: 4 })
    ).toBe(false);
  });

  it('leaves a successful run on its configured cadence', () => {
    expect(
      shouldRunScheduledBackup(new Date(), hoursAgo(2), 'daily', { outcome: 'success', consecutiveFailures: 0 })
    ).toBe(false);
  });
});
