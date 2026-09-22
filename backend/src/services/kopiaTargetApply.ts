/**
 * Makes a saved backup destination take effect for Kopia (plan.md §81.5,
 * §196 — the only engine now that Duplicati is gone; §221 added the `s3`
 * kind, a Kopia-native remote rather than a Docker mount).
 *
 * Saving the choice is not enough, for two reasons that are easy to miss:
 *
 *   1. `apps/kopia/docker-compose.yml` reads BACKUP_MOUNT_TYPE/OPTIONS/DEVICE
 *      (for disk/smb/nfs) and BACKUP_REPO_KIND/BACKUP_S3_* (for s3) from that
 *      app's `.env`. Storing the destination only in the settings table
 *      leaves the compose file reading variables nobody sets.
 *   2. Docker does not recreate a named volume whose definition changed, so
 *      the container comes back mounted at the previous location while the UI
 *      says otherwise. The volume has to be removed first.
 *
 * Two things are Kopia-specific:
 *
 *   - A local (`type=none`) repository directory must exist before `compose
 *     up`, or the local-driver bind fails to mount. `ensureKopiaRepoDir`
 *     creates it (unconditionally — even an `s3` target still declares the
 *     fallback local volume, see `buildEnvValues`); it is also called from
 *     the executor's pre-start path.
 *   - After the volume is swapped (or the s3 env vars change), Kopia's
 *     entrypoint reconnects to (or, on a fresh location, recreates) the
 *     repository — the repository password comes from KOPIA_PASSWORD in the
 *     environment, so a new location gets a brand-new repository, not a
 *     broken one.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  BackupTarget,
  isRcloneKind,
  KOPIA_LOCAL_REPOSITORY_DEVICE,
  toKopiaRepositoryMount,
  toRcloneRemoteConfig,
  toS3ConnectArgs,
  toWebdavConnectArgs,
  WebdavConnectArgs,
} from '../utils/backupTarget';
import { resolveComposeFile } from '../config/services';
import { parseEnvFile, writeEnvValues } from '../utils/envFile';
import logger from '../utils/logger';

const KOPIA_SERVICE = 'kopia';

/** `docker compose -p kopia` + the volume named in its compose file. */
const VOLUME_NAME = 'kopia_backup-target';

function run(command: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, output: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, output });
    });
  });
}

/**
 * WebDAV has real directories, unlike S3's flat key namespace — `kopia
 * repository create webdav` PROPFINDs the target path to check it, but never
 * MKCOLs a missing one; it just gives up ("PROPFIND /: 404"). A destination
 * pointed at a fresh subpath (the recommended way to keep a repository out of
 * a general-purpose WebDAV share, rather than dumping blobs in its root) was
 * silently broken until that subpath happened to already exist. MKCOL each
 * path segment from the root down — a nested path needs every parent
 * collection to exist first, and 405 (already a collection) is success, not
 * an error. Best-effort and never throws: this only smooths the common case,
 * Kopia's own connect attempt still reports a real problem clearly.
 */
export async function ensureWebdavDirectory(target: WebdavConnectArgs): Promise<void> {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    return;
  }
  const auth = 'Basic ' + Buffer.from(`${target.username}:${target.password}`).toString('base64');
  const segments = url.pathname.split('/').filter(Boolean);
  let builtPath = '';
  for (const segment of segments) {
    builtPath += `/${segment}`;
    try {
      const res = await fetch(`${url.origin}${builtPath}`, {
        method: 'MKCOL',
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok && res.status !== 405) {
        logger.warn('Could not create the WebDAV directory for the Kopia backup destination', {
          path: builtPath,
          status: res.status,
        });
        return;
      }
    } catch (error) {
      logger.warn('Could not reach the WebDAV server to create the Kopia backup directory', {
        path: builtPath,
        error: (error as Error).message,
      });
      return;
    }
  }
}

/**
 * Create the local repository directory when the mount is a plain bind
 * (`type=none`). A Docker `local`/`o=bind` volume does NOT create its device
 * path — it fails "no such file or directory" — and every app's gitignored
 * data directory is absent on a fresh clone, so this reaches here with nothing
 * on disk. No-op for nfs/cifs: the export/share is expected to already exist on the server.
 *
 * Exported so the executor's pre-start path can call it too, for the case
 * where Kopia is started from the dashboard before any destination is chosen.
 */
export function ensureKopiaRepoDir(appDir: string): void {
  const envPath = path.join(appDir, '.env');
  const env = fs.existsSync(envPath) ? parseEnvFile(envPath) : {};
  const type = (env.BACKUP_MOUNT_TYPE ?? 'none').trim();
  if (type !== 'none') {
    return;
  }
  const device = (env.BACKUP_MOUNT_DEVICE || KOPIA_LOCAL_REPOSITORY_DEVICE).trim();
  const dir = path.isAbsolute(device) ? device : path.join(appDir, device);
  fs.mkdirSync(dir, { recursive: true });
}

export interface ApplyResult {
  applied: boolean;
  restarted: boolean;
  detail: string;
}

/**
 * Every env var `applyKopiaTarget` owns in Kopia's `.env`, computed fresh
 * from the target every time. Starts from a baseline where every var is
 * empty and the mount falls back to the harmless local default the app ships
 * with (the compose file always declares the `backup-target` volume, even
 * when `BACKUP_REPO_KIND` is `s3` or `rclone` and `/repository` goes
 * unused), then the active kind overrides only its own vars — so nothing is
 * ever left stale from a previous kind.
 */
export function buildEnvValues(target: BackupTarget): Record<string, string> {
  const values: Record<string, string> = {
    BACKUP_MOUNT_TYPE: 'none',
    BACKUP_MOUNT_OPTIONS: 'bind',
    BACKUP_MOUNT_DEVICE: KOPIA_LOCAL_REPOSITORY_DEVICE,
    BACKUP_REPO_KIND: 'filesystem',
    BACKUP_S3_BUCKET: '',
    BACKUP_S3_ENDPOINT: '',
    BACKUP_S3_ACCESS_KEY_ID: '',
    BACKUP_S3_SECRET_ACCESS_KEY: '',
    BACKUP_S3_EXTRA_ARGS: '',
    BACKUP_RCLONE_TYPE: '',
    BACKUP_RCLONE_HOST: '',
    BACKUP_RCLONE_PORT: '',
    BACKUP_RCLONE_USER: '',
    BACKUP_RCLONE_PASS: '',
    BACKUP_RCLONE_REMOTE_PATH: '',
    BACKUP_RCLONE_TLS: '',
    BACKUP_RCLONE_EXTRA_ARGS: '',
    BACKUP_WEBDAV_URL: '',
    BACKUP_WEBDAV_USERNAME: '',
    BACKUP_WEBDAV_PASSWORD: '',
    BACKUP_WEBDAV_EXTRA_ARGS: '',
  };

  if (target.kind === 'webdav') {
    const w = toWebdavConnectArgs(target);
    return {
      ...values,
      BACKUP_REPO_KIND: 'webdav',
      BACKUP_WEBDAV_URL: w.url,
      BACKUP_WEBDAV_USERNAME: w.username,
      BACKUP_WEBDAV_PASSWORD: w.password,
      BACKUP_WEBDAV_EXTRA_ARGS: w.extraArgs,
    };
  }

  if (target.kind === 's3') {
    const s3 = toS3ConnectArgs(target);
    return {
      ...values,
      BACKUP_REPO_KIND: 's3',
      BACKUP_S3_BUCKET: s3.bucket,
      BACKUP_S3_ENDPOINT: s3.endpoint,
      BACKUP_S3_ACCESS_KEY_ID: s3.accessKeyId,
      BACKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      BACKUP_S3_EXTRA_ARGS: s3.extraArgs,
    };
  }

  if (isRcloneKind(target.kind)) {
    const r = toRcloneRemoteConfig(target);
    return {
      ...values,
      BACKUP_REPO_KIND: 'rclone',
      BACKUP_RCLONE_TYPE: r.type,
      BACKUP_RCLONE_HOST: r.host,
      BACKUP_RCLONE_PORT: r.port,
      BACKUP_RCLONE_USER: r.user,
      BACKUP_RCLONE_PASS: r.pass,
      BACKUP_RCLONE_REMOTE_PATH: r.remotePath,
      BACKUP_RCLONE_TLS: r.explicitTls ? 'true' : 'false',
      BACKUP_RCLONE_EXTRA_ARGS: r.extraArgs,
    };
  }

  const mount = toKopiaRepositoryMount(target);
  return { ...values, BACKUP_MOUNT_TYPE: mount.type, BACKUP_MOUNT_OPTIONS: mount.o, BACKUP_MOUNT_DEVICE: mount.device };
}

/**
 * Write Kopia's repository config and, if Kopia is running, recreate it
 * against the new destination. Never throws — a destination that saved but
 * could not be applied is still worth keeping, and the caller reports the
 * difference.
 */
export async function applyKopiaTarget(target: BackupTarget): Promise<ApplyResult> {
  const resolved = resolveComposeFile(KOPIA_SERVICE);
  if (!resolved?.composeFile || !resolved.appDir) {
    return { applied: false, restarted: false, detail: 'The Kopia app is not installed.' };
  }

  try {
    writeEnvValues(path.join(resolved.appDir, '.env'), buildEnvValues(target));
    // Still needed even for an s3 target: the compose file's backup-target
    // volume always declares a type=none/bind fallback (see buildEnvValues),
    // and Docker does not create a bind mount's device path on its own.
    ensureKopiaRepoDir(resolved.appDir);
  } catch (error) {
    return { applied: false, restarted: false, detail: `Could not write Kopia's config: ${(error as Error).message}` };
  }

  if (target.kind === 'webdav') {
    await ensureWebdavDirectory(toWebdavConnectArgs(target));
  }

  const savedNote = 'Saved.';

  const envFile = path.join(resolved.appDir, '.env');
  const composeArgs = ['compose', '-f', resolved.composeFile, '--env-file', envFile, '-p', KOPIA_SERVICE];

  // Down before removing the volume: a volume in use cannot be removed, and
  // forcing it would leave the container holding a stale mount. Safe to run
  // even when nothing is up — a no-op, or cleanup of a `Created`-but-never-
  // started container left over from an earlier failed start.
  const down = await run('docker', [...composeArgs, 'down']);
  if (down.code !== 0) {
    logger.warn('Could not stop Kopia to apply the backup destination', { output: down.output.slice(0, 200) });
  }

  // The step that actually matters — without it the next start (whether
  // right now or a later manual one) silently reuses the previous
  // repository location's stale, immutable mount options.
  await run('docker', ['volume', 'rm', '-f', VOLUME_NAME], 20_000);

  // Always bring it back up, regardless of whether it was running before —
  // a saved destination the user has to remember to separately go Start is
  // exactly the "no user step" principle 3 rules out (plan.md §581). Found
  // live: a save while Kopia happened to be stopped mid-diagnosis left the
  // new destination configured but inert until someone noticed and hit
  // Start by hand.
  const up = await run('docker', [...composeArgs, 'up', '-d']);
  if (up.code !== 0) {
    return {
      applied: true,
      restarted: false,
      detail: `${savedNote} But Kopia did not come back up: ${up.output.trim().slice(0, 300)}`,
    };
  }

  logger.info('Applied the backup destination and recreated Kopia');
  return {
    applied: true,
    restarted: true,
    // The entrypoint reconnects or recreates the repository on the new mount.
    detail: `${savedNote} Kopia recreated; its repository now lives on the new location.`,
  };
}

/** Current mount values, for reporting what Kopia will actually use. */
export function readAppliedKopiaMount(): Record<string, string> | null {
  const resolved = resolveComposeFile(KOPIA_SERVICE);
  if (!resolved?.appDir) return null;
  const envPath = path.join(resolved.appDir, '.env');
  if (!fs.existsSync(envPath)) return null;
  const values = parseEnvFile(envPath);
  return {
    type: values.BACKUP_MOUNT_TYPE ?? '',
    options: values.BACKUP_MOUNT_OPTIONS ?? '',
    device: values.BACKUP_MOUNT_DEVICE ?? '',
  };
}

/**
 * The real repository encryption password Kopia's entrypoint will actually
 * use — stable across destination changes (it's an `autoGeneratedSecret` on
 * the `kopia` app itself, not part of the destination). `backupTargetTest.ts`
 * needs this: an s3 bucket that already holds a repository (re-testing an
 * already-applied destination, or one shared with a previous install) can
 * only be read with this exact password — a throwaway one would always
 * report a real, working destination as broken.
 */
export function readKopiaRepositoryPassword(): string | null {
  const resolved = resolveComposeFile(KOPIA_SERVICE);
  if (!resolved?.appDir) return null;
  const envPath = path.join(resolved.appDir, '.env');
  if (!fs.existsSync(envPath)) return null;
  return parseEnvFile(envPath).KOPIA_PASSWORD || null;
}
