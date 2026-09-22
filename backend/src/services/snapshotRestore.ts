/**
 * Restore one app's data out of an offsite Kopia snapshot (plan.md §590–§592).
 *
 * The shape is deliberately small, because almost all of it already existed:
 *
 *  1. Kopia's HTTP restore accepts a path-suffixed object id (§591 proved it
 *     live), so an app's subtree inside the whole-`apps/` snapshot is just
 *     `<rootId>/<app>` — no directory browsing, no whole-tree staging.
 *  2. What comes back is an `apps/<name>`-shaped directory: `data/`, `.env`,
 *     the compose files. That is exactly the shape `writeArchive` already
 *     tars, so the staged tree can be fed to it verbatim as an "appDir" and
 *     the result is an ordinary per-app archive — same excludes, same layout.
 *  3. Which means the restore itself is the existing, proven `restoreOneApp`:
 *     stop, replace `data/`, replay the DB dump, start. Nothing about that
 *     path is re-implemented here.
 *
 * Only `data/` crosses over. The staged tree also holds the snapshot's `.env`
 * and compose files, and putting those back would silently undo any credential
 * the dashboard has rotated since the snapshot was taken (§591) — `writeArchive`
 * only ever archives `data`, which is what keeps that from happening.
 */

import fs from 'fs/promises';
import path from 'path';
import { APP_VERSION } from '../version';
import { getService, resolveComposeFile } from '../config/services';
import { listSnapshots, restoreSnapshot, getRestoreTaskStatus } from './kopiaClient';
import { readAppEnvValue } from './appEnv';
import { runCommand } from './backup';
import {
  AppBackupManifest,
  appBackupDir,
  backupsVolumeName,
  manifestPathFor,
  restoreOneApp,
  writeArchive,
} from './appBackup';
import logger from '../utils/logger';

/** Where the staging mount lands inside the Kopia container (its compose file). */
const STAGING_IN_KOPIA = '/restore';

/**
 * How long to wait for Kopia to write the app's tree out. Generous: this is
 * bounded by the size of one app's data and the repository's own latency (an
 * offsite S3/WebDAV destination re-downloads every content block it does not
 * have cached), not by anything local.
 */
const RESTORE_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;

/** Root-owned staging tree; the backend user cannot remove it itself. */
const RM_TIMEOUT_MS = 60 * 1000;

export interface SnapshotRestoreResult {
  app: string;
  snapshotId: string;
  /** The per-app archive the snapshot was staged into — a normal restore point afterwards. */
  file: string;
  restoredBytes: number | null;
  restoredFiles: number | null;
  warnings: string[];
}

/** The host path of Kopia's staging mount — what `docker run -v` needs. */
function stagingHostPath(app: string): string {
  const kopia = resolveComposeFile('kopia');
  if (!kopia?.appDir) {
    throw new Error('The Kopia app is not installed, so a snapshot cannot be restored.');
  }
  return path.join(kopia.appDir, 'data', 'restore', app);
}

/** Remove a root-owned path, as root. Never throws — used on the cleanup path too. */
async function removeAsRoot(hostPath: string): Promise<void> {
  try {
    await runCommand(
      'docker',
      ['run', '--rm', '-v', `${path.dirname(hostPath)}:/staging`, 'alpine:latest',
       'rm', '-rf', `/staging/${path.basename(hostPath)}`],
      { timeout: RM_TIMEOUT_MS }
    );
  } catch (error) {
    logger.warn('Could not clear the snapshot restore staging directory', {
      hostPath,
      error: (error as Error).message,
    });
  }
}

/** Poll Kopia's restore task until it stops running, or time out. */
async function awaitRestore(password: string, taskId: string) {
  const deadline = Date.now() + RESTORE_TIMEOUT_MS;
  for (;;) {
    const status = await getRestoreTaskStatus(password, taskId);
    if (!status.running) {
      if (!status.succeeded) {
        throw new Error(`Kopia's restore did not succeed (${status.status}): ${status.error ?? 'no detail given'}`);
      }
      return status;
    }
    if (Date.now() > deadline) {
      throw new Error("Kopia's restore did not finish within 30 minutes.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function restoreAppFromSnapshot(
  snapshotId: string,
  app: string,
  userId: number
): Promise<SnapshotRestoreResult> {
  if (!getService(app) || !resolveComposeFile(app)?.composeFile) {
    const err = new Error(`Unknown or uninstalled service: ${app}`) as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const password = readAppEnvValue('kopia', 'KOPIA_SERVER_PASSWORD');
  if (!password) {
    const err = new Error('Kopia has no server password configured, so its snapshots cannot be read.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 400;
    throw err;
  }

  const snapshot = (await listSnapshots(password)).find((s) => s.id === snapshotId);
  if (!snapshot) {
    const err = new Error('That snapshot no longer exists — it may have been dropped by retention.') as Error & {
      statusCode?: number;
    };
    err.statusCode = 404;
    throw err;
  }

  const hostPath = stagingHostPath(app);
  // A previous run that died mid-restore would leave a partial tree here, and
  // Kopia's restore merges into an existing directory rather than replacing
  // it — a stale file would silently ride along into the archive.
  await removeAsRoot(hostPath);

  try {
    logger.info('Snapshot restore staging', { app, snapshotId, rootId: snapshot.rootId });
    const { taskId } = await restoreSnapshot(password, {
      rootId: `${snapshot.rootId}/${app}`,
      targetPath: `${STAGING_IN_KOPIA}/${app}`,
    });
    const status = await awaitRestore(password, taskId);

    // The staged tree is `apps/<app>`-shaped, so it is an "appDir" as far as
    // the archive writer is concerned.
    const dir = appBackupDir(app);
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date();
    const file = `${app}-snapshot-${stamp.toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const vol = await backupsVolumeName();
    if (!vol) {
      throw new Error('The backups volume could not be resolved, so the snapshot could not be staged.');
    }
    await writeArchive(app, hostPath, file);

    const archivePath = path.join(dir, file);
    const manifest: AppBackupManifest = {
      app,
      createdAt: stamp.toISOString(),
      dashboardVersion: APP_VERSION,
      engine: getService(app)?.backup?.engine ?? null,
      archiveBytes: (await fs.stat(archivePath)).size,
      // The snapshot carries whatever dumps `data/_dump/` held when it was
      // taken; this path did not produce them, so it claims none.
      dumps: [],
      dumpFailures: [],
    };
    await fs.writeFile(manifestPathFor(archivePath), JSON.stringify(manifest, null, 2), 'utf8');

    // From here it is an ordinary per-app restore, lock and all.
    const restored = await restoreOneApp(app, file, userId);

    logger.info('Snapshot restore finished', { app, snapshotId, file, warnings: restored.warnings });
    return {
      app,
      snapshotId,
      file,
      restoredBytes: status.restoredBytes,
      restoredFiles: status.restoredFiles,
      warnings: restored.warnings,
    };
  } finally {
    await removeAsRoot(hostPath);
  }
}
