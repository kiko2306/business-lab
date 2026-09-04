/**
 * Makes a saved backup destination take effect for Kopia, alongside
 * `backupTargetApply.ts` which does the same for Duplicati (plan.md §81.5).
 *
 * The mechanics are identical to Duplicati's, and for the same two reasons:
 *
 *   1. `apps/kopia/docker-compose.yml` reads BACKUP_MOUNT_TYPE / OPTIONS /
 *      DEVICE from that app's `.env` to template its `backup-target` volume.
 *      Storing the destination only in the settings table leaves the compose
 *      file reading variables nobody sets.
 *   2. Docker does not recreate a named volume whose definition changed, so
 *      the container comes back mounted at the previous location while the UI
 *      says otherwise. The volume has to be removed first.
 *
 * Two things are Kopia-specific:
 *
 *   - A local (`type=none`) repository directory must exist before `compose
 *     up`, or the local-driver bind fails to mount. `ensureKopiaRepoDir`
 *     creates it; it is also called from the executor's pre-start path.
 *   - After the volume is swapped, Kopia's entrypoint reconnects to (or, on a
 *     fresh location, recreates) the repository — the repository password
 *     comes from KOPIA_PASSWORD in the environment, so a new location gets a
 *     brand-new repository, not a broken one.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BackupTarget, KOPIA_LOCAL_REPOSITORY_DEVICE, toKopiaRepositoryMount } from '../utils/backupTarget';
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

/** Write the three mount variables into Kopia's own `.env`. */
function writeMountEnv(appDir: string, spec: { type: string; o: string; device: string }): void {
  const envPath = path.join(appDir, '.env');
  const values: Record<string, string> = {
    BACKUP_MOUNT_TYPE: spec.type,
    BACKUP_MOUNT_OPTIONS: spec.o,
    BACKUP_MOUNT_DEVICE: spec.device,
  };

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
 * Write Kopia's mount config and, if Kopia is running, recreate it against the
 * new repository location. Never throws — a destination that saved but could
 * not be applied is still worth keeping, and the caller reports the difference.
 */
export async function applyKopiaTarget(target: BackupTarget): Promise<ApplyResult> {
  const resolved = resolveComposeFile(KOPIA_SERVICE);
  if (!resolved?.composeFile || !resolved.appDir) {
    return { applied: false, restarted: false, detail: 'The Kopia app is not installed.' };
  }

  const mount = toKopiaRepositoryMount(target);

  try {
    writeMountEnv(resolved.appDir, mount.spec);
    ensureKopiaRepoDir(resolved.appDir);
  } catch (error) {
    return { applied: false, restarted: false, detail: `Could not write Kopia's config: ${(error as Error).message}` };
  }

  const savedNote = mount.supported ? 'Saved.' : `Saved. ${mount.reason}`;

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

  logger.info('Applied the backup destination and recreated Kopia', { supported: mount.supported });
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
