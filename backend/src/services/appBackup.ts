/**
 * Per-application backup archives — a self-contained local `.tar.gz` per app,
 * separate from the offsite Duplicati/Kopia job (plan.md §185).
 *
 * The offsite job is one archive over the whole `apps/` tree, versioned and
 * encrypted, and its restore path is the CLI (§75.3). This is the other thing:
 * a quick, local rollback point for a single app — "I'm about to reconfigure
 * this, give me something to fall back to". One archive holds that app's
 * consistent database dump(s) + SQLite snapshot(s) (written into
 * `data/_dump/` first, reusing `appDumps.dumpOneApp`) and the rest of its
 * `data/` directory, with the live database directories excluded the same way
 * the Duplicati job excludes them — a running Postgres data dir or an open
 * SQLite WAL restores torn.
 *
 * A sidecar `<base>.manifest.json` sits next to each archive: dashboard
 * bookkeeping (when, which version, which dumps) that the lister reads without
 * unpacking the archive. It is not inside the archive — busybox tar in the
 * runtime image supports neither repeated `-C` nor safe selective
 * dereferencing — and it is not needed for a manual `tar xzf` restore, which
 * works off `data/_dump/*.sql` and `data/`.
 *
 * Restore (stop → replay dumps → copy `data/` back → start) is slice 3; this
 * module is the archive writer, the lister, retention and path-safety.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { APP_VERSION } from '../version';
import { getService, resolveComposeFile } from '../config/services';
import { withMaintenanceLock } from './maintenanceLock';
import { dumpOneApp, restoreServerDatabase } from './appDumps';
import { startService, stopService } from './executor';
import { runCommand, safeBackupFileName } from './backup';
import logger from '../utils/logger';

/**
 * `backups/apps/` — one subdirectory per app, alongside the control-plane
 * archives `backup.ts` keeps in `backups/`. Resolved from `process.cwd()` at
 * module load, the same way `BACKUP_DIR` is, so the process working directory
 * is the one place the backup root is configured.
 */
export const APP_BACKUP_ROOT = path.join(process.cwd(), 'backups', 'apps');

/**
 * How many archives to keep per app. These are local rollback points, not the
 * offsite history, so a small bound keeps disk use predictable; the offsite
 * job is where "the backup from three weeks ago" lives.
 */
export const APP_BACKUP_RETENTION = 10;

/**
 * Live database directories and side-files, excluded from the archive — the
 * `_dump/*.sql` and `*.sqlite` snapshots are the consistent copy. Matches the
 * Duplicati job's filter set (duplicatiClient.ts). `*.part` is an in-progress
 * dump `commitDump` has not renamed yet.
 */
const TAR_EXCLUDES = ['data/db', 'data/pgdata', '*-wal', '*-shm', '*.part'];

/** Longer than `runCommand`'s 2-minute default — a large `data/` tree can take a while. */
const ARCHIVE_TIMEOUT_MS = 10 * 60 * 1000;

export interface AppBackupDump {
  target: string;
  kind: string;
  bytes: number | null;
  detail: string;
}

export interface AppBackupManifest {
  app: string;
  /** ISO 8601. */
  createdAt: string;
  dashboardVersion: string;
  /** `services.ts` backup.engine, or null for a SQLite-only / data-only app. */
  engine: string | null;
  archiveBytes: number;
  dumps: AppBackupDump[];
  /** Databases that could not be dumped on this run (the archive was still written). */
  dumpFailures: AppBackupDump[];
}

export interface AppBackupEntry {
  file: string;
  bytes: number;
  /** ISO 8601, from the archive's mtime. */
  createdAt: string;
  /** Parsed sidecar, or null when it is missing or unreadable. */
  manifest: AppBackupManifest | null;
}

export interface AppBackupResult {
  file: string;
  manifest: AppBackupManifest;
  /** Non-empty when some of the app's databases could not be dumped. */
  dumpFailures: AppBackupDump[];
}

/** The `apps/<name>` directory, or throw if the app is not installed. */
function requireAppDir(name: string): string {
  const resolved = resolveComposeFile(name);
  if (!getService(name) || !resolved?.composeFile) {
    const err = new Error(`Unknown or uninstalled service: ${name}`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return resolved.appDir;
}

export function appBackupDir(name: string): string {
  return path.join(APP_BACKUP_ROOT, name);
}

/**
 * Resolve a backup file name to an absolute path inside that app's backup
 * directory, rejecting anything that would escape it (traversal, absolute
 * paths, odd characters) — the same guard `backup.ts` applies to the
 * control-plane archives.
 */
export function resolveAppBackupPath(name: string, file: string): string {
  if (!safeBackupFileName(name) || !safeBackupFileName(file)) {
    throw new Error('Invalid backup name.');
  }
  const base = path.resolve(appBackupDir(name)) + path.sep;
  const resolved = path.resolve(appBackupDir(name), file);
  if (!resolved.startsWith(base)) {
    throw new Error('Invalid backup path.');
  }
  return resolved;
}

function manifestPathFor(archivePath: string): string {
  return archivePath.replace(/\.tar\.gz$/, '.manifest.json');
}

function toDump(o: { target: string; kind: string; bytes?: number; detail: string }): AppBackupDump {
  return { target: o.target, kind: o.kind, bytes: o.bytes ?? null, detail: o.detail };
}

/**
 * The docker volume backing `backups/` (mounted at `/app/backups`). Cached.
 * `null` when the backend is not a container with that volume — dev only
 * (unsupported per CLAUDE.md), where the process owns the tree and can tar it
 * directly.
 */
let backupsVolume: string | null | undefined;
async function backupsVolumeName(): Promise<string | null> {
  if (backupsVolume !== undefined) {
    return backupsVolume;
  }
  try {
    const out = await runCommand('docker', [
      'inspect',
      os.hostname(),
      '--format',
      '{{range .Mounts}}{{if eq .Destination "/app/backups"}}{{.Name}}{{end}}{{end}}',
    ]);
    backupsVolume = out.trim() || null;
  } catch {
    backupsVolume = null;
  }
  return backupsVolume;
}

/**
 * Archive `<appDir>/data` into `backups/apps/<name>/<file>`, minus the live DB
 * dirs.
 *
 * Runs `tar` as **root in a throwaway alpine container** — the backend process
 * runs as a non-root user and cannot read every app's data (files owned by
 * root or the app's own uid, mode 0600), the same reason `appDumps` snapshots
 * SQLite in a container. busybox tar honours `--exclude` and a single `-C`
 * (verified; it does *not* support repeated `-C`). The per-app directory is
 * created by the caller as the backend user, so the sidecar write and later
 * prune succeed; only the archive file lands root:root 0644, which the backend
 * can still stat, serve and unlink from a directory it owns.
 */
async function writeArchive(name: string, appDir: string, file: string): Promise<void> {
  const vol = await backupsVolumeName();
  if (vol) {
    await runCommand(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${appDir}:/src:ro`,
        '-v',
        `${vol}:/out`,
        'alpine:latest',
        'tar',
        '-czf',
        `/out/apps/${name}/${file}`,
        ...TAR_EXCLUDES.flatMap((pattern) => ['--exclude', pattern]),
        '-C',
        '/src',
        'data',
      ],
      { timeout: ARCHIVE_TIMEOUT_MS }
    );
    return;
  }
  await runCommand(
    'tar',
    [
      '-czf',
      path.join(APP_BACKUP_ROOT, name, file),
      ...TAR_EXCLUDES.flatMap((pattern) => ['--exclude', pattern]),
      '-C',
      appDir,
      'data',
    ],
    { timeout: ARCHIVE_TIMEOUT_MS }
  );
}

/**
 * Back up one app now: dump its database(s), then archive `data/` (minus the
 * live DB dirs) to `backups/apps/<name>/<name>-<timestamp>.tar.gz` with a
 * manifest sidecar, and prune to the retention count.
 *
 * Under the shared maintenance lock so it cannot race an image update or the
 * scheduled dump (§103/§176). Individual dump failures do not fail the
 * archive — a torn database is exactly what you might be trying to roll back
 * from — but they are recorded on the manifest and returned.
 */
export async function backupOneApp(name: string): Promise<AppBackupResult> {
  const appDir = requireAppDir(name);
  const dataDir = path.join(appDir, 'data');
  try {
    await fs.access(dataDir);
  } catch {
    const err = new Error(`${name} has no data directory to back up.`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  return withMaintenanceLock(`backup:app:${name}`, async () => {
    const report = await dumpOneApp(name);

    const dir = appBackupDir(name);
    await fs.mkdir(dir, { recursive: true });

    const stamp = new Date();
    const base = `${name}-${stamp.toISOString().replace(/[:.]/g, '-')}`;
    const archivePath = path.join(dir, `${base}.tar.gz`);

    await writeArchive(name, appDir, `${base}.tar.gz`);

    const archiveBytes = (await fs.stat(archivePath)).size;
    const dumps = report.outcomes.filter((o) => o.ok).map(toDump);
    const dumpFailures = report.outcomes.filter((o) => !o.ok).map(toDump);

    const manifest: AppBackupManifest = {
      app: name,
      createdAt: stamp.toISOString(),
      dashboardVersion: APP_VERSION,
      engine: getService(name)?.backup?.engine ?? null,
      archiveBytes,
      dumps,
      dumpFailures,
    };
    await fs.writeFile(manifestPathFor(archivePath), JSON.stringify(manifest, null, 2), 'utf8');

    const pruned = await pruneAppBackups(name, APP_BACKUP_RETENTION);
    logger.info('Per-app backup written', {
      app: name,
      file: `${base}.tar.gz`,
      archiveBytes,
      dumped: dumps.length,
      dumpFailed: dumpFailures.length,
      pruned: pruned.length,
    });

    return { file: `${base}.tar.gz`, manifest, dumpFailures };
  });
}

/** Every archive this app has, newest first, with its parsed manifest. */
export async function listAppBackups(name: string): Promise<AppBackupEntry[]> {
  if (!safeBackupFileName(name)) {
    throw new Error('Invalid backup name.');
  }
  const dir = appBackupDir(name);

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return []; // no directory yet == no backups
  }

  const entries = await Promise.all(
    names
      .filter((f) => f.endsWith('.tar.gz'))
      .map(async (file) => {
        const full = path.join(dir, file);
        const stat = await fs.stat(full);
        let manifest: AppBackupManifest | null = null;
        try {
          manifest = JSON.parse(await fs.readFile(manifestPathFor(full), 'utf8')) as AppBackupManifest;
        } catch {
          // Missing or corrupt sidecar — the archive is still listable and
          // restorable; the frontend shows "details unavailable".
        }
        return { file, bytes: stat.size, createdAt: stat.mtime.toISOString(), manifest };
      })
  );

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return entries;
}

/** Delete one archive and its manifest sidecar. */
export async function deleteAppBackup(name: string, file: string): Promise<void> {
  const archivePath = resolveAppBackupPath(name, file);
  await fs.rm(archivePath, { force: true });
  await fs.rm(manifestPathFor(archivePath), { force: true });
  logger.info('Per-app backup deleted', { app: name, file });
}

/**
 * Delete archives beyond `keep`, oldest first (by mtime). Returns the names
 * removed. An archive that will not delete is left in place and out of the
 * returned list — the next run tries again — rather than failing the prune.
 */
export async function pruneAppBackups(name: string, keep: number): Promise<string[]> {
  const dir = appBackupDir(name);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  const archives = await Promise.all(
    names
      .filter((f) => f.endsWith('.tar.gz'))
      .map(async (file) => ({ file, mtimeMs: (await fs.stat(path.join(dir, file))).mtimeMs }))
  );
  archives.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const deleted: string[] = [];
  for (const { file } of archives.slice(Math.max(0, keep))) {
    try {
      await fs.rm(path.join(dir, file), { force: true });
      await fs.rm(manifestPathFor(path.join(dir, file)), { force: true });
      deleted.push(file);
    } catch {
      /* leave it; next prune retries */
    }
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// Restore (plan.md §185 slice 3)
// ---------------------------------------------------------------------------

/**
 * Wipe `data/` (bar the live server DB dir) and repopulate it from the
 * archive, then copy each consistent `_dump/*.sqlite` snapshot over its live
 * file. busybox is enough — no `apk add`, so it works with no network.
 * `/data/db` is preserved because the server DB is restored by replaying its
 * SQL dump into the running container, not by swapping files.
 */
const FILE_RESTORE_SCRIPT = `
set -e
rm -rf /tmp/x && mkdir /tmp/x
tar -xzf "$ARCHIVE" -C /tmp/x
[ -d /tmp/x/data ] || { echo "archive has no data/ directory"; exit 3; }
find /data -mindepth 1 -maxdepth 1 ! -name db -exec rm -rf {} +
cp -a /tmp/x/data/. /data/
if [ -d /data/_dump ]; then
  for snap in /data/_dump/*.sqlite; do
    [ -e "$snap" ] || continue
    bn=$(basename "$snap" .sqlite)
    match=$(find /data -path /data/_dump -prune -o -type f \\( -name "$bn.sqlite" -o -name "$bn.sqlite3" -o -name "$bn.db" \\) -print | head -n1)
    if [ -n "$match" ]; then cp "$snap" "$match"; echo "sqlite:$match"; fi
  done
fi
`;

/** Poll a compose service's container until its healthcheck passes, or time out. */
async function waitForContainerHealthy(project: string, service: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const id = (
        await runCommand('docker', [
          'ps',
          '-q',
          '-f',
          `label=com.docker.compose.project=${project}`,
          '-f',
          `label=com.docker.compose.service=${service}`,
        ])
      ).trim().split('\n')[0];
      if (id) {
        const status = (
          await runCommand('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}', id])
        ).trim();
        // "healthy" for a service with a healthcheck (all the DB services
        // here have one); "true" for one without.
        if (status === 'healthy' || status === 'true') {
          return true;
        }
      }
    } catch {
      /* container not up yet — keep polling */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export interface AppRestoreResult {
  service: string;
  file: string;
  /** Human summary of the file-level restore. */
  fileRestore: string;
  /** The server-DB replay outcome, or null for a SQLite-only / data-only app. */
  databaseRestore: AppBackupDump | null;
  /** Non-fatal problems — the app was still brought back up. */
  warnings: string[];
}

/**
 * Restore one app from one of its archives: stop it, put `data/` back, replay
 * the server DB dump (if any) into a freshly-started DB container, then bring
 * the whole app back up. Destructive and outward-facing — the route is
 * confirm-gated in the UI.
 *
 * Under the maintenance lock (can't race an update or a backup). `stopService`
 * / `startService` are the same ones the dashboard buttons use, so exposure
 * re-provisioning and the Home Page tile follow automatically.
 */
export async function restoreOneApp(name: string, file: string, userId: number): Promise<AppRestoreResult> {
  const appDir = requireAppDir(name);
  const archivePath = resolveAppBackupPath(name, file);
  try {
    await fs.access(archivePath);
  } catch {
    const err = new Error('Backup file not found.') as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const resolved = resolveComposeFile(name);
  const projectName = resolved?.projectName ?? name;
  const composeArgs = (resolved?.composeArgs ?? '').split(' ').filter(Boolean);
  const backup = getService(name)?.backup ?? null;
  const warnings: string[] = [];

  return withMaintenanceLock(`restore:app:${name}`, async () => {
    logger.info('Per-app restore starting', { app: name, file });

    // 1. Stop the whole app (compose down).
    await stopService(name, userId);

    // 2. File restore, as root — the backend user cannot rewrite app data.
    //    The archive lives in the backups volume (a path that only exists
    //    inside the backend container), so mount the volume and address it by
    //    its path within — the same reason the archive write in slice 2 mounts
    //    the volume rather than a container-local path. `data/` is the bind-
    //    mounted apps tree, a real host path, so that mount is direct.
    const vol = await backupsVolumeName();
    const archiveMount = vol
      ? ['-v', `${vol}:/backups:ro`]
      : ['-v', `${archivePath}:/archive.tar.gz:ro`];
    const archiveInContainer = vol ? `/backups/apps/${name}/${file}` : '/archive.tar.gz';
    await runCommand(
      'docker',
      [
        'run',
        '--rm',
        '-e',
        `ARCHIVE=${archiveInContainer}`,
        ...archiveMount,
        '-v',
        `${path.join(appDir, 'data')}:/data`,
        'alpine:latest',
        'sh',
        '-c',
        FILE_RESTORE_SCRIPT,
      ],
      { timeout: ARCHIVE_TIMEOUT_MS }
    );

    // 3. Server DB replay: bring the DB up alone, wait for it, replay the dump.
    let databaseRestore: AppBackupDump | null = null;
    if (backup) {
      await runCommand(
        'docker',
        ['compose', '-p', projectName, ...composeArgs, 'up', '-d', backup.service],
        { timeout: 120_000 }
      );
      if (!(await waitForContainerHealthy(projectName, backup.service, 90_000))) {
        warnings.push(`${backup.service} did not become ready in time — the database was not replayed.`);
      } else {
        const outcome = await restoreServerDatabase(name);
        databaseRestore = toDump(outcome);
        if (!outcome.ok) {
          warnings.push(`Database replay failed: ${outcome.detail}`);
        }
      }
    }

    // 4. Bring the whole app back up.
    await startService(name, userId);

    logger.info('Per-app restore finished', { app: name, file, warnings });
    return {
      service: name,
      file,
      fileRestore: "data/ replaced from the archive (live 'data/db' preserved for the SQL replay)",
      databaseRestore,
      warnings,
    };
  });
}
