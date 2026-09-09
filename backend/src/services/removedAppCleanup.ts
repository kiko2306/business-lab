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
 * file** whose name is not a known app project directory. A dir that still has
 * a compose file but no entry is someone mid-edit (or a half-scaffolded new
 * app) — left alone with a warning, never deleted. The management stack lives
 * at the repo root, not under `apps/`, so it is structurally out of reach.
 *
 * "Known project directory", not "registry key": a few services live in a dir
 * whose name differs from their key (`homepage` → `apps/home-page/`), so the
 * safe set is built from each service's `composePath`, via `getProjectName`.
 */

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { SERVICES, getAppsDir, getProjectName } from '../config/services';
import { writeAuditLog } from '../utils/audit';

const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

// Compose project names (and our app dir names) are lowercase alnum + dashes.
// Anything else under apps/ is not one of ours — don't go near it.
const PROJECT_NAME = /^[a-z0-9][a-z0-9-]*$/;

// Minimal image for the root `rm` fallback below. Already on the host as an
// init-container base; auto-pulled if not.
const RM_HELPER_IMAGE = 'busybox:latest';

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

/** Single-quote a shell argument. Our inputs are path/regex-safe already; this
 * is belt-and-braces for the app dir, which comes from an env var. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
 * Delete `dir`. The backend runs non-root, but a removed app's `data/` is
 * written by its (root) container — so `fs.rm` hits EACCES on real leftovers.
 * Fall back to a throwaway root container (same pattern as
 * exposureConfigFiles.ts) that can unlink root-owned files.
 */
async function removeAppDir(appsDir: string, name: string): Promise<void> {
  const dir = path.join(appsDir, name);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return;
  } catch (error) {
    logger.warn('Direct removal of orphaned app dir failed (likely root-owned data); retrying as root', {
      dir: name,
      error: (error as Error).message,
    });
  }
  // `rm -rf` the dir from inside a root container. The apps dir is bind-mounted
  // at the same absolute path, so `path.join` gives the in-container path too.
  await run(
    `docker run --rm --network none -v ${shq(appsDir)}:${shq(appsDir)} ${RM_HELPER_IMAGE} ` +
      `rm -rf ${shq(dir)}`
  );
  // Confirm it actually went.
  try {
    await fs.access(dir);
    throw new Error('directory still present after root rm');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Pure selection step, split out so it can be tested without a filesystem:
 * which `apps/` entries are orphaned app projects safe to tear down.
 *
 * `knownProjectDirs` is the set of directory names every registered service
 * lives in — not the registry keys (see the file header).
 */
export function selectOrphanAppDirs(
  entries: { name: string; isDirectory: boolean; hasCompose: boolean }[],
  knownProjectDirs: Set<string>
): string[] {
  // A registry that failed to load looks like "every app was removed" — refuse
  // rather than delete the whole apps/ tree.
  if (knownProjectDirs.size === 0) {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory && !e.hasCompose && !knownProjectDirs.has(e.name) && PROJECT_NAME.test(e.name))
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

  if (Object.keys(SERVICES).length === 0) {
    logger.error('Skipping removed-app cleanup: the service registry is empty');
    return;
  }
  const knownProjectDirs = new Set(
    Object.keys(SERVICES)
      .map((name) => getProjectName(name))
      .filter((dir): dir is string => Boolean(dir))
  );

  // Warn about the mid-edit case (dir not a known project, but still has a
  // compose file) without acting.
  for (const d of dirents) {
    if (d.isDirectory() && !knownProjectDirs.has(d.name) && (await hasComposeFile(path.join(appsDir, d.name)))) {
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

  const orphans = selectOrphanAppDirs(entries, knownProjectDirs);

  for (const name of orphans) {
    logger.info('Tearing down an app project no longer in the registry', { project: name });

    // Fileless `down` — Compose v2 resolves the project from the running
    // containers' labels, which is all that is left once the compose file is
    // gone. `stopService` already relies on `compose down` working through the
    // socket proxy; this is the same call without `-f`. Progress goes to
    // stderr, so an empty stdout here is normal even when it removed things.
    try {
      const out = await run(`docker compose -p ${name} down --remove-orphans`);
      logger.info('Compose down for removed project', { project: name, output: out.trim() || '(no stdout)' });
    } catch (error) {
      logger.warn('Compose down for removed project failed; still removing its directory', {
        project: name,
        error: (error as Error).message,
      });
    }

    try {
      await removeAppDir(appsDir, name);
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
