/**
 * Register the shared tree (`apps/nextcloud/data/shared/`, bind-mounted at
 * `/shared` — plan.md §202/§219/§310) as Nextcloud external storage
 * automatically, through the shared nextcloudOcc scaffold — the same class of
 * §0.2/§0.3 problem as the OnlyOffice/ClamAV wiring.
 *
 * §219's original premise (a human has to click through Admin settings ->
 * External Storage because the create API needs a fresh interactive password
 * confirmation) was wrong: that constraint is on the OCS/web API only.
 * `occ files_external:create` has none of it (plan.md §369) — nobody had
 * actually tried the CLI command before writing it off.
 *
 * Idempotent by checking `files_external:list` for an existing `/shared`
 * mount first — unlike `config:app:set`, `files_external:create` has no
 * upsert form and would otherwise duplicate the mount on every start.
 *
 * Runs after `docker compose up` on every Nextcloud start (occ needs the
 * database). No-op for every other service. Never fatal — a missing mount is
 * a missing convenience, not a broken Nextcloud.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';

/** occ lines that enable files_external and register the /shared mount once. */
export function buildSharedMountScript(): string[] {
  return [
    'if ! php occ app:getpath files_external >/dev/null 2>&1; then',
    '  if ! php occ app:install files_external; then',
    '    echo "hlm: could not install files_external (app store unreachable?); skipping"',
    '    exit 0',
    '  fi',
    'fi',
    'php occ app:enable files_external >/dev/null',
    'if php occ files_external:list | grep -q "/shared"; then',
    '  echo "hlm: /shared is already registered as external storage"',
    'else',
    '  php occ files_external:create Shared local null::null -c datadir=/shared',
    '  echo "hlm: /shared registered as external storage"',
    'fi',
  ];
}

/**
 * Reconcile the `/shared` external mount on a Nextcloud start. No-op for
 * every other service. Never throws.
 */
export async function reconcileNextcloudSharedMount(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }
  if (!resolveComposeFile(NEXTCLOUD_SERVICE)?.composeFile) {
    return;
  }

  try {
    const result = await runNextcloudOccScript(buildSharedMountScript());
    logger.info('Nextcloud /shared external storage reconciled', {
      ok: result.ok,
      output: result.output || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to register the Nextcloud /shared external storage', { error: (error as Error).message });
  }
}
