import fs from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listSnapshots = vi.fn();
const restoreSnapshot = vi.fn();
const getRestoreTaskStatus = vi.fn();
const readAppEnvValue = vi.fn();
const runCommand = vi.fn();
const writeArchive = vi.fn();
const restoreOneApp = vi.fn();
const backupsVolumeName = vi.fn();
const getService = vi.fn();
const resolveComposeFile = vi.fn();

vi.mock('./kopiaClient', () => ({ listSnapshots, restoreSnapshot, getRestoreTaskStatus }));
vi.mock('./appEnv', () => ({ readAppEnvValue }));
vi.mock('./backup', () => ({ runCommand }));
vi.mock('../config/services', () => ({ getService, resolveComposeFile }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../version', () => ({ APP_VERSION: '9.9.9' }));
vi.mock('./appBackup', () => ({
  writeArchive,
  restoreOneApp,
  backupsVolumeName,
  appBackupDir: (name: string) => path.join(root, 'backups', 'apps', name),
  manifestPathFor: (archive: string) => archive.replace(/\.tar\.gz$/, '.manifest.json'),
}));

type Mod = typeof import('./snapshotRestore');
let mod: Mod;
let root: string;
let kopiaDir: string;

const SNAPSHOT = { id: 'abc123def456', rootId: 'kdeadbeef', retentionReasons: [] };

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-restore-'));
  kopiaDir = path.join(root, 'apps', 'kopia');
  vi.resetModules();

  for (const fn of [listSnapshots, restoreSnapshot, getRestoreTaskStatus, readAppEnvValue,
                    runCommand, writeArchive, restoreOneApp, backupsVolumeName,
                    getService, resolveComposeFile]) fn.mockReset();

  readAppEnvValue.mockReturnValue('kopia-pw');
  listSnapshots.mockResolvedValue([SNAPSHOT]);
  restoreSnapshot.mockResolvedValue({ taskId: '7' });
  getRestoreTaskStatus.mockResolvedValue({
    status: 'SUCCESS', running: false, succeeded: true, restoredBytes: 382837, restoredFiles: 8, error: null,
  });
  runCommand.mockResolvedValue('');
  backupsVolumeName.mockResolvedValue('business-lab_backups-data');
  restoreOneApp.mockResolvedValue({ service: 'ntfy', file: 'x', fileRestore: '', databaseRestore: null, warnings: [] });
  getService.mockImplementation((n: string) => (n === 'nope' ? null : { backup: null }));
  resolveComposeFile.mockImplementation((n: string) =>
    n === 'nope' ? null : { composeFile: 'docker-compose.yml', appDir: n === 'kopia' ? kopiaDir : path.join(root, 'apps', n) });

  // writeArchive is mocked, so create the archive it would have written.
  writeArchive.mockImplementation(async (name: string, _dir: string, file: string) => {
    const out = path.join(root, 'backups', 'apps', name);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, file), 'tar');
  });

  mod = await import('./snapshotRestore');
});

describe('restoreAppFromSnapshot', () => {
  it('addresses the app subtree as <rootId>/<app> and stages it under Kopia', async () => {
    await mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1);

    expect(restoreSnapshot).toHaveBeenCalledWith('kopia-pw', {
      rootId: 'kdeadbeef/ntfy',
      targetPath: '/restore/ntfy',
    });
  });

  it('archives the staged tree, then hands off to the ordinary per-app restore', async () => {
    const res = await mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1);

    // The staged tree is passed as the "appDir" — writeArchive only ever
    // takes `data` out of it, which is what keeps the snapshot's secrets file
    // from overwriting a rotated one.
    const [name, appDir, file] = writeArchive.mock.calls[0];
    expect(name).toBe('ntfy');
    expect(appDir).toBe(path.join(kopiaDir, 'data', 'restore', 'ntfy'));
    expect(restoreOneApp).toHaveBeenCalledWith('ntfy', file, 1);
    expect(res.restoredFiles).toBe(8);

    // A manifest lands beside the archive so the app's backup list can read it.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'backups', 'apps', 'ntfy', file.replace(/\.tar\.gz$/, '.manifest.json')), 'utf8')
    );
    expect(manifest).toMatchObject({ app: 'ntfy', dashboardVersion: '9.9.9', dumps: [] });
  });

  it('clears the staging directory before and after, as root', async () => {
    await mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1);

    const rms = runCommand.mock.calls.filter(([cmd, args]) => cmd === 'docker' && args.includes('rm'));
    expect(rms).toHaveLength(2); // stale tree before, cleanup after
    expect(rms[0][1]).toEqual(expect.arrayContaining([
      '-v', `${path.join(kopiaDir, 'data', 'restore')}:/staging`, '/staging/ntfy',
    ]));
  });

  it('still clears staging when the restore fails', async () => {
    restoreOneApp.mockRejectedValue(new Error('stop failed'));

    await expect(mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1)).rejects.toThrow('stop failed');
    expect(runCommand.mock.calls.filter(([, args]) => args.includes('rm'))).toHaveLength(2);
  });

  it('refuses a snapshot retention has dropped, before touching the app', async () => {
    listSnapshots.mockResolvedValue([]);

    await expect(mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1)).rejects.toMatchObject({ statusCode: 404 });
    expect(restoreSnapshot).not.toHaveBeenCalled();
    expect(restoreOneApp).not.toHaveBeenCalled();
  });

  it('refuses an unknown app', async () => {
    await expect(mod.restoreAppFromSnapshot(SNAPSHOT.id, 'nope', 1)).rejects.toMatchObject({ statusCode: 404 });
    expect(restoreSnapshot).not.toHaveBeenCalled();
  });

  it('does not hand off to the per-app restore when Kopia reports failure', async () => {
    getRestoreTaskStatus.mockResolvedValue({
      status: 'FAILED', running: false, succeeded: false, restoredBytes: null, restoredFiles: null,
      error: 'block not found',
    });

    await expect(mod.restoreAppFromSnapshot(SNAPSHOT.id, 'ntfy', 1)).rejects.toThrow(/block not found/);
    expect(writeArchive).not.toHaveBeenCalled();
    expect(restoreOneApp).not.toHaveBeenCalled();
  });
});
