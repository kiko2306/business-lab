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
import { BackupTarget, KOPIA_LOCAL_REPOSITORY_DEVICE, toKopiaRepositoryMount, toS3ConnectArgs } from '../utils/backupTarget';
import { resolveComposeFile } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
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
 * Write env vars into Kopia's own `.env`, replacing every key given —
 * including clearing s3 credentials back to empty when switching to a
 * mount-based kind, so a stale secret access key never lingers in a
 * plaintext `.env` after the destination moves on from it.
 */
function writeKopiaEnv(appDir: string, values: Record<string, string>): void {
  const envPath = path.join(appDir, '.env');

  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  let updated = existing;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    updated = new RegExp(`^${key}=.*$`, 'm').test(updated)
      ? updated.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${updated.endsWith('\n') || updated === '' ? updated : updated + '\n'}${line}\n`;
  }
  if (updated !== existing) {
    fs.writeFileSync(envPath, updated);
  }
}

/**
 * Create the local repository directory when the mount is a plain bind
 * (`type=none`). A Docker `local`/`o=bind` volume does NOT create its device
 * path — it fails "no such file or directory" — and every app's gitignored
 * data directory is absent on a fresh clone, so this reaches here with nothing
 * on disk. No-op for
 * nfs/cifs: the export/share is expected to already exist on the server.
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
 * from the target every time — an `s3` target's mount vars fall back to the
 * same harmless local default the app ships with (the compose file always
 * declares the `backup-target` volume, even though Kopia won't use
 * `/repository` when `BACKUP_REPO_KIND=s3`), and a mount-based target's s3
 * vars are blanked out. Nothing is ever left stale from a previous kind.
 */
export function buildEnvValues(target: BackupTarget): Record<string, string> {
  if (target.kind === 's3') {
    const s3 = toS3ConnectArgs(target);
    return {
      BACKUP_MOUNT_TYPE: 'none',
      BACKUP_MOUNT_OPTIONS: 'bind',
      BACKUP_MOUNT_DEVICE: KOPIA_LOCAL_REPOSITORY_DEVICE,
      BACKUP_REPO_KIND: 's3',
      BACKUP_S3_BUCKET: s3.bucket,
      BACKUP_S3_ENDPOINT: s3.endpoint,
      BACKUP_S3_ACCESS_KEY_ID: s3.accessKeyId,
      BACKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey,
      BACKUP_S3_EXTRA_ARGS: s3.extraArgs,
    };
  }

  const mount = toKopiaRepositoryMount(target);
  return {
    BACKUP_MOUNT_TYPE: mount.type,
    BACKUP_MOUNT_OPTIONS: mount.o,
    BACKUP_MOUNT_DEVICE: mount.device,
    BACKUP_REPO_KIND: 'filesystem',
    BACKUP_S3_BUCKET: '',
    BACKUP_S3_ENDPOINT: '',
    BACKUP_S3_ACCESS_KEY_ID: '',
    BACKUP_S3_SECRET_ACCESS_KEY: '',
    BACKUP_S3_EXTRA_ARGS: '',
  };
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
    writeKopiaEnv(resolved.appDir, buildEnvValues(target));
    // Still needed even for an s3 target: the compose file's backup-target
    // volume always declares a type=none/bind fallback (see buildEnvValues),
    // and Docker does not create a bind mount's device path on its own.
    ensureKopiaRepoDir(resolved.appDir);
  } catch (error) {
    return { applied: false, restarted: false, detail: `Could not write Kopia's config: ${(error as Error).message}` };
  }

  const savedNote = 'Saved.';

  const running = await run('docker', ['ps', '-q', '-f', 'name=kopia'], 10_000);
  if (!running.output.trim()) {
    return { applied: true, restarted: false, detail: `${savedNote} Start Kopia to use it.` };
  }

  const envFile = path.join(resolved.appDir, '.env');
  const composeArgs = ['compose', '-f', resolved.composeFile, '--env-file', envFile, '-p', KOPIA_SERVICE];

  // Down before removing the volume: a volume in use cannot be removed, and
  // forcing it would leave the container holding a stale mount.
  const down = await run('docker', [...composeArgs, 'down']);
  if (down.code !== 0) {
    logger.warn('Could not stop Kopia to apply the backup destination', { output: down.output.slice(0, 200) });
  }

  // The step that actually matters — without it the recreated container
  // silently reuses the previous repository location.
  await run('docker', ['volume', 'rm', '-f', VOLUME_NAME], 20_000);

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
