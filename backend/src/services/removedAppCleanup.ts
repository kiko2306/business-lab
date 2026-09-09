/**
 * Tear down app projects whose registry entry has been removed.
 *
 * `reconcileRemovedServices` (exposure.ts) already drops a removed app's NPM
 * proxy host and Cloudflare hostname on boot. What it leaves behind:
 *
 *  - the app's containers, still running as an unmanaged Compose project —
 *    the dashboard has no card for it, so there is no button to stop it;
 *  - `apps/<name>/`, with its gitignored `data/` and `.env` — a `git pull`
 *    that removed the tracked compose file does not touch those.
 *
 * This closes both. Boot-only, same idiom as `reconcileRemovedServices`: the
 * first moment the code knows an entry is gone.
 *
 * Discriminator: an orphan is an `apps/<name>/` directory with **no compose
 * file** and no registry entry. A dir that still has a compose file but no
 * entry is someone mid-edit (or a half-scaffolded new app) — left alone with
 * a warning, never deleted. The management stack lives at the repo root, not
 * under `apps/`, so it is structurally out of reach here.
 */

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { SERVICES, getAppsDir } from '../config/services';
import { writeAuditLog } from '../utils/audit';

const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

// Compose project names (and our app dir names) are lowercase alnum + dashes.
// Anything else under apps/ is not one of ours — don't go near it.
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]*$/;

function run(command: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

async function hasComposeFile(dir: string): Promise<boolean> {
  for (const name of COMPOSE_FILENAMES) {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      /* not this one */
    }
  }
  return false;
}

/**
 * Pure selection step, split out so it can be tested without a filesystem:
 * which `apps/` entries are orphaned app projects safe to tear down.
 */
export function selectOrphanAppDirs(
  entries: { name: string; isDirectory: boolean; hasCompose: boolean }[],
  serviceNames: Set<string>
): string[] {
  // A registry that failed to load looks like "every app was removed" — refuse
  // rather than delete the whole apps/ tree.
  if (serviceNames.size === 0) {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory && !e.hasCompose && !serviceNames.has(e.name) && PROJECT_NAME.test(e.name))
    .map((e) => e.name);
}

export async function reconcileRemovedAppProjects(): Promise<void> {
  const appsDir = getAppsDir();

  let dirents;
  try {
    dirents = await fs.readdir(appsDir, { withFileTypes: true });
  } catch (error) {
    logger.error('Could not read apps dir for removed-project cleanup', { error: (error as Error).message });
    return;
  }

  const serviceNames = new Set(Object.keys(SERVICES));
  if (serviceNames.size === 0) {
    logger.error('Skipping removed-app cleanup: the service registry is empty');
    return;
  }

  // Warn about the mid-edit case (entry gone, files still here) without acting.
  for (const d of dirents) {
    if (d.isDirectory() && !serviceNames.has(d.name) && (await hasComposeFile(path.join(appsDir, d.name)))) {
      logger.warn('apps/ dir has a compose file but no registry entry — left in place', { dir: d.name });
    }
  }

  const entries = await Promise.all(
    dirents.map(async (d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      hasCompose: d.isDirectory() ? await hasComposeFile(path.join(appsDir, d.name)) : true,
    }))
  );

  const orphans = selectOrphanAppDirs(entries, serviceNames);

  for (const name of orphans) {
    const dir = path.join(appsDir, name);
    logger.info('Tearing down an app project no longer in the registry', { project: name });

    // Fileless `down` — Compose v2 resolves the project from the running
    // containers' labels, which is all that is left once the compose file is
    // gone. `stopService` already relies on `compose down` working through the
    // socket proxy; this is the same call without `-f`.
    try {
      const out = await run(`docker compose -p ${name} down --remove-orphans`);
      logger.info('Compose down for removed project', { project: name, output: out.trim() || '(nothing running)' });
    } catch (error) {
      // Nothing running, or a Compose that won't act fileless — either way the
      // directory removal below is still worth doing.
      logger.warn('Compose down for removed project failed; removing its directory anyway', {
        project: name,
        error: (error as Error).message,
      });
    }

    try {
      await fs.rm(dir, { recursive: true, force: true });
      logger.info('Removed orphaned app directory', { dir: name });
    } catch (error) {
      logger.error('Could not remove orphaned app directory', { dir: name, error: (error as Error).message });
      continue;
    }

    await writeAuditLog({
      userId: null,
      action: 'app_project_removed',
      resource: name,
      result: 'success',
      metadata: { reason: 'app removed from the registry; project torn down and apps/ dir deleted on boot' },
    }).catch(() => {});
  }
}
