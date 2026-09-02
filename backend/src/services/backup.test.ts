import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the schedule helpers touch Postgres; pruning is pure filesystem work.
vi.mock('../utils/database', () => ({ query: vi.fn() }));

import { toLastAppDataDump } from './backup';

describe('pruneOldBackups', () => {
  let root: string;
  let pruneOldBackups: typeof import('./backup').pruneOldBackups;

  const writeBackup = (name: string, minutesOld: number) => {
    const full = path.join(root, 'backups', name);
    fs.writeFileSync(full, 'archive');
    const when = new Date(Date.now() - minutesOld * 60_000);
    fs.utimesSync(full, when, when);
  };

  const remaining = () => fs.readdirSync(path.join(root, 'backups')).sort();

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-prune-'));
    fs.mkdirSync(path.join(root, 'backups'));
    // BACKUP_DIR is resolved from cwd when the module loads, so the stub has to
    // be in place before the import.
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.resetModules();
    ({ pruneOldBackups } = await import('./backup'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps the newest archives and deletes the rest, oldest first', async () => {
    writeBackup('backup-newest.tar.gz', 1);
    writeBackup('backup-middle.tar.gz', 60);
    writeBackup('backup-older.tar.gz', 120);
    writeBackup('backup-oldest.tar.gz', 180);

    const deleted = await pruneOldBackups(2);

    expect(deleted).toEqual(['backup-older.tar.gz', 'backup-oldest.tar.gz']);
    expect(remaining()).toEqual(['backup-middle.tar.gz', 'backup-newest.tar.gz']);
  });

  it('deletes nothing when there are fewer archives than the retention count', async () => {
    writeBackup('backup-a.tar.gz', 1);
    writeBackup('backup-b.tar.gz', 60);

    expect(await pruneOldBackups(3)).toEqual([]);
    expect(remaining()).toEqual(['backup-a.tar.gz', 'backup-b.tar.gz']);
  });

  it('ignores files that are not archives, so they never count towards retention', async () => {
    writeBackup('notes.txt', 1);
    writeBackup('backup-a.tar.gz', 60);
    writeBackup('backup-b.tar.gz', 120);

    expect(await pruneOldBackups(1)).toEqual(['backup-b.tar.gz']);
    expect(remaining()).toEqual(['backup-a.tar.gz', 'notes.txt']);
  });

  it('creates the backup directory rather than failing when it is missing', async () => {
    fs.rmSync(path.join(root, 'backups'), { recursive: true });

    expect(await pruneOldBackups(3)).toEqual([]);
    expect(fs.existsSync(path.join(root, 'backups'))).toBe(true);
  });
});

describe('toLastAppDataDump', () => {
  it('returns null when there is no audit row', () => {
    expect(toLastAppDataDump(undefined)).toBeNull();
  });

  it('maps a §88.5 row with per-app failure reasons', () => {
    const row = {
      result: 'failure',
      created_at: '2026-09-01T19:40:39.822Z',
      metadata: {
        trigger: 'scheduled',
        dumped: 18,
        failed: 2,
        failures: [
          { app: 'nextcloud', kind: 'postgres', detail: 'connection refused' },
          { app: 'immich', kind: 'postgres', detail: 'network not found' },
        ],
      },
    };
    expect(toLastAppDataDump(row)).toEqual({
      at: '2026-09-01T19:40:39.822Z',
      result: 'failure',
      dumped: 18,
      failed: 2,
      trigger: 'scheduled',
      failures: [
        { app: 'nextcloud', kind: 'postgres', detail: 'connection refused' },
        { app: 'immich', kind: 'postgres', detail: 'network not found' },
      ],
    });
  });

  it('reports an empty failure list for an older row that only kept a count', () => {
    const row = {
      result: 'failure',
      created_at: new Date('2026-09-01T19:40:39Z'),
      metadata: { detail: 'Duplicati rejected the password.', dumped: 18, failed: 8, trigger: 'scheduled' },
    };
    const mapped = toLastAppDataDump(row);
    expect(mapped?.failed).toBe(8);
    expect(mapped?.failures).toEqual([]);
  });

  it('coerces a garbled metadata blob rather than throwing', () => {
    const row = { result: 'success', created_at: '2026-09-02T00:00:00.000Z', metadata: null };
    expect(toLastAppDataDump(row)).toEqual({
      at: '2026-09-02T00:00:00.000Z',
      result: 'success',
      dumped: null,
      failed: null,
      trigger: null,
      failures: [],
    });
  });
});
