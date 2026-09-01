import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only the schedule helpers touch Postgres; pruning is pure filesystem work.
vi.mock('../utils/database', () => ({ query: vi.fn() }));

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
