/**
 * WebDAV's `/data` is a Docker `local`-driver volume, templated from
 * WEBDAV_MOUNT_TYPE/OPTIONS/DEVICE the same way Kopia's backup-target volume
 * already is (`apps/kopia/docker-compose.yml`, `kopiaTargetApply.ts`) — the
 * one difference is Kopia's destination is a single global setting reached
 * through a dedicated Settings page and route, while this is a per-app field
 * set (WEBDAV_NAS_SERVER/SHARE/USERNAME/PASSWORD) edited through WebDAV's own
 * ordinary config panel, so there is no separate "apply" action: this runs in
 * the same pre-start hook as `applyWebdavConfig`, on every start.
 *
 * Reuses `toMountSpec` from backupTarget.ts rather than re-deriving CIFS
 * mount options — the "disk/smb/nfs are one Docker local-driver shape" fact
 * doesn't change just because the caller isn't Kopia. Only `smb` is offered
 * here (a "network folder" on a NAS): NFS/S3/FTP destinations belong to
 * Kopia's own backup-destination concept, a different problem (backing up an
 * app's data elsewhere) from this one (an app's data living elsewhere to
 * begin with).
 *
 * Docker does not recreate a named volume whose definition changed — the
 * same trap `kopiaTargetApply.ts` documents and fixes. So this compares the
 * freshly computed mount against what's already recorded in `.env` and, only
 * on a real change, stops the container and removes the volume before the
 * caller's own `compose up` (later in the same start) recreates both fresh.
 */

import fs from 'fs';
import path from 'path';
import { BackupTarget, toMountSpec } from '../utils/backupTarget';
import { parseEnvFile, writeEnvValues } from '../utils/envFile';
import logger from '../utils/logger';
import { runArgv } from '../utils/run';

export const WEBDAV_SERVICE = 'webdav';

/** `docker compose -p webdav` + the volume named in its compose file. */
const VOLUME_NAME = 'webdav_webdav-storage';

export const WEBDAV_LOCAL_DEVICE = './data/files';

export interface WebdavNasSettings {
  server: string;
  share: string;
  username: string;
  password: string;
}

export function resolveWebdavNasSettings(env: Record<string, string>): WebdavNasSettings {
  return {
    server: (env.WEBDAV_NAS_SERVER ?? '').trim(),
    share: (env.WEBDAV_NAS_SHARE ?? '').trim(),
    username: env.WEBDAV_NAS_USERNAME ?? '',
    password: env.WEBDAV_NAS_PASSWORD ?? '',
  };
}

/**
 * The three env vars the compose file's `webdav-storage` volume reads.
 * Falls back to the local bind mount whenever no NAS server is set — the
 * default the app has always shipped with.
 */
export function buildWebdavMountEnv(nas: WebdavNasSettings): Record<string, string> {
  if (!nas.server) {
    return { WEBDAV_MOUNT_TYPE: 'none', WEBDAV_MOUNT_OPTIONS: 'bind', WEBDAV_MOUNT_DEVICE: WEBDAV_LOCAL_DEVICE };
  }

  const target: BackupTarget = {
    kind: 'smb',
    path: '',
    server: nas.server,
    share: nas.share,
    username: nas.username,
    password: nas.password,
    options: '',
  };
  const mount = toMountSpec(target);
  return { WEBDAV_MOUNT_TYPE: mount.type, WEBDAV_MOUNT_OPTIONS: mount.o, WEBDAV_MOUNT_DEVICE: mount.device };
}

function readRecordedMountEnv(env: Record<string, string>): Record<string, string> {
  return {
    WEBDAV_MOUNT_TYPE: env.WEBDAV_MOUNT_TYPE ?? '',
    WEBDAV_MOUNT_OPTIONS: env.WEBDAV_MOUNT_OPTIONS ?? '',
    WEBDAV_MOUNT_DEVICE: env.WEBDAV_MOUNT_DEVICE ?? '',
  };
}

/**
 * Recompute the mount from WEBDAV_NAS_* and, if it changed since the last
 * recorded value, swap the volume before the imminent `compose up` (called
 * from the same pre-start hook as `applyWebdavConfig`, earlier in the same
 * start) recreates it against the new location. No-op for every other
 * service, and a no-op change-wise on every ordinary start where the NAS
 * fields haven't moved.
 */
export async function applyWebdavMount(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== WEBDAV_SERVICE) {
    return;
  }

  try {
    const envPath = path.join(appDir, '.env');
    const env = fs.existsSync(envPath) ? parseEnvFile(envPath) : {};
    const desired = buildWebdavMountEnv(resolveWebdavNasSettings(env));
    const recorded = readRecordedMountEnv(env);
    const changed = Object.entries(desired).some(([key, value]) => recorded[key] !== value);

    if (changed) {
      const composeFile = path.join(appDir, 'docker-compose.yml');
      const composeArgs = ['compose', '-f', composeFile, '--env-file', envPath, '-p', WEBDAV_SERVICE];
      // Down before removing the volume: a volume in use cannot be removed,
      // and this is safe even when nothing is up yet (a fresh install has no
      // prior mount to swap, so `changed` above is only true here if
      // WEBDAV_MOUNT_* was never written before — compose creates the volume
      // fresh either way).
      await runArgv('docker', [...composeArgs, 'down'], 30_000);
      await runArgv('docker', ['volume', 'rm', '-f', VOLUME_NAME], 30_000);
      logger.info('WebDAV storage location changed — removed the old volume for a clean remount', {
        type: desired.WEBDAV_MOUNT_TYPE,
      });
    }

    if (desired.WEBDAV_MOUNT_TYPE === 'none') {
      // A local/bind volume does not create its device path — Docker fails
      // "no such file or directory" without it, same reason
      // ensureKopiaRepoDir exists for Kopia's own local fallback.
      const dir = path.isAbsolute(desired.WEBDAV_MOUNT_DEVICE)
        ? desired.WEBDAV_MOUNT_DEVICE
        : path.join(appDir, desired.WEBDAV_MOUNT_DEVICE);
      fs.mkdirSync(dir, { recursive: true });
    }

    writeEnvValues(envPath, desired);
  } catch (error) {
    logger.error('Failed to apply webdav storage mount', { error: (error as Error).message });
  }
}
