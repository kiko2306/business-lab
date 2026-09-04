import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dumpOneApp = vi.fn();
const runCommand = vi.fn();
const getService = vi.fn();
const resolveComposeFile = vi.fn();

vi.mock('./appDumps', () => ({ dumpOneApp }));
vi.mock('./maintenanceLock', () => ({
  withMaintenanceLock: (_label: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('../config/services', () => ({ getService, resolveComposeFile }));
vi.mock('./backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backup')>()),
  runCommand,
}));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../version', () => ({ APP_VERSION: '9.9.9' }));

type Mod = typeof import('./appBackup');
let mod: Mod;
let root: string;

/** A real on-disk app source dir the mock `resolveComposeFile` points at. */
const srcAppDir = (name: string) => path.join(root, 'src-apps', name);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-backup-'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.resetModules();

  for (const fn of [dumpOneApp, runCommand, getService, resolveComposeFile]) fn.mockReset();

  // Real source dirs so backupOneApp's `data/` existence check passes.
  for (const name of ['nocodb', 'vaultwarden']) {
    fs.mkdirSync(path.join(srcAppDir(name), 'data'), { recursive: true });
  }
  getService.mockImplementation((name: string) =>
    name === 'nocodb'
      ? { backup: { engine: 'postgres', service: 'nocodb-db' } }
      : name === 'vaultwarden'
        ? {}
        : undefined
  );
  resolveComposeFile.mockImplementation((name: string) =>
    name === 'nocodb' || name === 'vaultwarden'
      ? { appDir: srcAppDir(name), composeFile: `${srcAppDir(name)}/docker-compose.yml` }
      : { appDir: srcAppDir(name), composeFile: null }
  );

  // The real archive step is a `tar` child process; stand in for it by
  // touching the file tar would have produced (its path is args[1]).
  runCommand.mockImplementation(async (_cmd: string, args: string[]) => {
    fs.writeFileSync(args[1], 'PK\x03\x04 fake archive');
    return '';
  });
  dumpOneApp.mockResolvedValue({ outcomes: [], ok: 0, failed: 0 });

  mod = await import('./appBackup');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const appDir = (name: string) => path.join(root, 'backups', 'apps', name);
const writeArchive = (name: string, file: string, minutesOld: number, manifest?: unknown) => {
  fs.mkdirSync(appDir(name), { recursive: true });
  const full = path.join(appDir(name), file);
  fs.writeFileSync(full, 'archive');
  if (manifest !== undefined) {
    fs.writeFileSync(full.replace(/\.tar\.gz$/, '.manifest.json'), JSON.stringify(manifest));
  }
  const when = new Date(Date.now() - minutesOld * 60_000);
  fs.utimesSync(full, when, when);
};

describe('resolveAppBackupPath', () => {
  it('accepts a plain file name inside the app directory', () => {
    const p = mod.resolveAppBackupPath('nocodb', 'nocodb-2026-01-01.tar.gz');
    expect(p).toBe(path.join(appDir('nocodb'), 'nocodb-2026-01-01.tar.gz'));
  });

  it.each(['../secrets.tar.gz', '..', 'a/b.tar.gz', '/etc/passwd', 'name with space'])(
    'rejects %j',
    (bad) => {
      expect(() => mod.resolveAppBackupPath('nocodb', bad)).toThrow(/Invalid backup/);
    }
  );

  it('rejects an unsafe app name', () => {
    expect(() => mod.resolveAppBackupPath('../../x', 'ok.tar.gz')).toThrow(/Invalid backup/);
  });
});

describe('backupOneApp', () => {
  it('dumps, archives data minus the live DB dirs, and writes a manifest sidecar', async () => {
    fs.mkdirSync(path.join(root, '..'), { recursive: true }); // no-op; keep tmp stable
    dumpOneApp.mockResolvedValue({
      outcomes: [
        { app: 'nocodb', kind: 'postgres', target: '/apps/nocodb/data/_dump/nocodb.sql', ok: true, bytes: 2048, detail: 'dumped 2 KB' },
      ],
      ok: 1,
      failed: 0,
    });

    const res = await mod.backupOneApp('nocodb');

    expect(dumpOneApp).toHaveBeenCalledWith('nocodb');
    const [cmd, args] = runCommand.mock.calls[0];
    expect(cmd).toBe('tar');
    expect(args).toContain('-czf');
    expect(args.slice(-3)).toEqual(['-C', srcAppDir('nocodb'), 'data']);
    for (const pattern of ['data/db', 'data/pgdata', '*-wal', '*-shm', '*.part']) {
      const i = args.indexOf(pattern);
      expect(args[i - 1]).toBe('--exclude');
    }

    expect(res.file).toMatch(/^nocodb-.*\.tar\.gz$/);
    expect(res.dumpFailures).toEqual([]);

    const manifestRaw = fs.readFileSync(
      path.join(appDir('nocodb'), res.file.replace(/\.tar\.gz$/, '.manifest.json')),
      'utf8'
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest).toMatchObject({
      app: 'nocodb',
      dashboardVersion: '9.9.9',
      engine: 'postgres',
      dumps: [{ kind: 'postgres', bytes: 2048 }],
      dumpFailures: [],
    });
    expect(manifest.archiveBytes).toBeGreaterThan(0);
  });

  it('still archives when a database dump fails, and surfaces the failure', async () => {
    dumpOneApp.mockResolvedValue({
      outcomes: [{ app: 'nocodb', kind: 'postgres', target: '', ok: false, detail: 'connection refused' }],
      ok: 0,
      failed: 1,
    });

    const res = await mod.backupOneApp('nocodb');

    expect(runCommand).toHaveBeenCalledOnce();
    expect(res.dumpFailures).toEqual([{ target: '', kind: 'postgres', bytes: null, detail: 'connection refused' }]);
  });

  it('works for a data-only app with no server database (engine null)', async () => {
    const res = await mod.backupOneApp('vaultwarden');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(appDir('vaultwarden'), res.file.replace(/\.tar\.gz$/, '.manifest.json')), 'utf8')
    );
    expect(manifest.engine).toBeNull();
  });

  it('rejects an unknown / uninstalled service', async () => {
    await expect(mod.backupOneApp('does-not-exist')).rejects.toMatchObject({ statusCode: 404 });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('prunes to the retention count, oldest first', async () => {
    for (let i = 0; i < mod.APP_BACKUP_RETENTION + 3; i++) {
      writeArchive('nocodb', `nocodb-old-${String(i).padStart(2, '0')}.tar.gz`, 1000 - i, { app: 'nocodb' });
    }
    await mod.backupOneApp('nocodb');

    const left = fs.readdirSync(appDir('nocodb')).filter((f) => f.endsWith('.tar.gz'));
    expect(left).toHaveLength(mod.APP_BACKUP_RETENTION);
    // the 3 oldest (highest minutesOld) are gone
    expect(left).not.toContain('nocodb-old-00.tar.gz');
    expect(left).not.toContain('nocodb-old-02.tar.gz');
  });
});

describe('listAppBackups', () => {
  it('returns nothing when the app has never been backed up', async () => {
    expect(await mod.listAppBackups('nocodb')).toEqual([]);
  });

  it('lists archives newest first with the parsed manifest', async () => {
    writeArchive('nocodb', 'nocodb-old.tar.gz', 120, { app: 'nocodb', createdAt: 'old' });
    writeArchive('nocodb', 'nocodb-new.tar.gz', 5, { app: 'nocodb', createdAt: 'new' });

    const list = await mod.listAppBackups('nocodb');

    expect(list.map((e) => e.file)).toEqual(['nocodb-new.tar.gz', 'nocodb-old.tar.gz']);
    expect(list[0].manifest).toMatchObject({ createdAt: 'new' });
    expect(list[0].bytes).toBeGreaterThan(0);
  });

  it('tolerates a missing or corrupt sidecar', async () => {
    writeArchive('nocodb', 'nocodb-nomanifest.tar.gz', 10); // no sidecar written
    fs.writeFileSync(path.join(appDir('nocodb'), 'nocodb-bad.tar.gz'), 'x');
    fs.writeFileSync(path.join(appDir('nocodb'), 'nocodb-bad.manifest.json'), '{not json');

    const list = await mod.listAppBackups('nocodb');
    expect(list.every((e) => e.manifest === null)).toBe(true);
  });
});

describe('deleteAppBackup', () => {
  it('removes the archive and its sidecar', async () => {
    writeArchive('nocodb', 'nocodb-x.tar.gz', 1, { app: 'nocodb' });
    await mod.deleteAppBackup('nocodb', 'nocodb-x.tar.gz');
    expect(fs.existsSync(path.join(appDir('nocodb'), 'nocodb-x.tar.gz'))).toBe(false);
    expect(fs.existsSync(path.join(appDir('nocodb'), 'nocodb-x.manifest.json'))).toBe(false);
  });

  it('rejects a traversal file name', async () => {
    await expect(mod.deleteAppBackup('nocodb', '../evil')).rejects.toThrow(/Invalid backup/);
  });
});

describe('pruneAppBackups', () => {
  it('keeps the newest N and deletes the rest with their sidecars', async () => {
    writeArchive('nocodb', 'a.tar.gz', 10, { n: 'a' });
    writeArchive('nocodb', 'b.tar.gz', 20, { n: 'b' });
    writeArchive('nocodb', 'c.tar.gz', 30, { n: 'c' });

    const deleted = await mod.pruneAppBackups('nocodb', 1);

    expect(deleted.sort()).toEqual(['b.tar.gz', 'c.tar.gz']);
    expect(fs.readdirSync(appDir('nocodb')).sort()).toEqual(['a.manifest.json', 'a.tar.gz']);
  });

  it('does nothing when under the limit', async () => {
    writeArchive('nocodb', 'a.tar.gz', 10);
    expect(await mod.pruneAppBackups('nocodb', 5)).toEqual([]);
  });
});
