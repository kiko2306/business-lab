/**
 * Makes a saved backup destination actually take effect.
 *
 * Saving the choice is not enough, for two reasons that are easy to miss:
 *
 *   1. `apps/duplicati/docker-compose.yml` reads BACKUP_MOUNT_TYPE / OPTIONS /
 *      DEVICE from that app's `.env`. Storing the destination in the settings
 *      table alone leaves the compose file reading variables nobody sets.
 *   2. Docker does **not** recreate a named volume whose definition changed.
 *      Restarting the container reuses the old volume, so the container comes
 *      back pointing at the previous destination while the UI says otherwise —
 *      a silent, confidently wrong state. The volume has to be removed first.
 *
 * Removing the volume never touches the data behind it: for a bind, NFS or SMB
 * volume the contents live on the target, not in Docker.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { BackupTarget, isMountedKind, toMountSpec } from '../utils/backupTarget';
import { resolveComposeFile } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import logger from '../utils/logger';

/** `docker compose -p duplicati` + the volume named in its compose file. */
const VOLUME_NAME = 'duplicati_backup-target';

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

/** Write the three mount variables into Duplicati's own `.env`. */
function writeMountEnv(appDir: string, target: BackupTarget): void {
  const envPath = path.join(appDir, '.env');
  const spec = isMountedKind(target.kind)
    ? toMountSpec(target)
    // A backend destination has no mount, but the compose file still declares
    // the volume — leave it pointing at the local fallback so the definition
    // stays valid rather than half-set.
    : { type: 'none', o: 'bind', device: './data/backups' };

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

export interface ApplyResult {
  applied: boolean;
  restarted: boolean;
  detail: string;
}

/**
 * Write the mount config and, if Duplicati is running, recreate it against the
 * new destination.
 *
 * Never throws — a destination that saved but could not be applied is still
 * worth keeping, and the caller reports the difference.
 */
export async function applyBackupTarget(target: BackupTarget): Promise<ApplyResult> {
  const resolved = resolveComposeFile('duplicati');
  if (!resolved?.composeFile || !resolved.appDir) {
    return { applied: false, restarted: false, detail: 'The Duplicati app is not installed.' };
  }

  try {
    writeMountEnv(resolved.appDir, target);
  } catch (error) {
    return { applied: false, restarted: false, detail: `Could not write Duplicati's config: ${(error as Error).message}` };
  }

  const running = await run('docker', ['ps', '-q', '-f', 'name=duplicati'], 10_000);
  if (!running.output.trim()) {
    // Nothing to recreate; the new values apply the next time it starts.
    return { applied: true, restarted: false, detail: 'Saved. Start Duplicati to mount the destination.' };
  }

  const envFile = path.join(resolved.appDir, '.env');
  const composeArgs = ['compose', '-f', resolved.composeFile, '--env-file', envFile, '-p', 'duplicati'];

  // Down before removing the volume: a volume in use cannot be removed, and
  // forcing it would leave the container holding a stale mount.
  const down = await run('docker', [...composeArgs, 'down']);
  if (down.code !== 0) {
    logger.warn('Could not stop Duplicati to apply the backup destination', { output: down.output.slice(0, 200) });
  }

  // The step that actually matters — without it the recreated container
  // silently reuses the previous destination.
  await run('docker', ['volume', 'rm', '-f', VOLUME_NAME], 20_000);

  const up = await run('docker', [...composeArgs, 'up', '-d']);
  if (up.code !== 0) {
    return {
      applied: true,
      restarted: false,
      detail: `Saved, but Duplicati did not come back up: ${up.output.trim().slice(0, 300)}`,
    };
  }

  logger.info('Applied the backup destination and recreated Duplicati');
  return { applied: true, restarted: true, detail: 'Saved and Duplicati recreated against the new destination.' };
}

/** Current mount values, for reporting what Duplicati will actually use. */
export function readAppliedMount(): Record<string, string> | null {
  const resolved = resolveComposeFile('duplicati');
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
