/**
 * Two more of Nextcloud's own admin-panel warnings (§402), both plain `occ`
 * one-liners with no dashboard config to gather:
 *
 *  - "Início da janela de manutenção" — no `maintenance_window_start` set, so
 *    background jobs run at any hour including peak use. Any hour is fine;
 *    the warning is "none configured", not "wrong hour" — 2am is just a
 *    reasonable default for a single-timezone home stack.
 *  - "Migrações de mimetype disponíveis" — `occ maintenance:repair
 *    --include-expensive` needs a manual run (Nextcloud won't do it on an
 *    update: "leva muito tempo em instâncias maiores"). It's a no-op once
 *    done, but re-running it on every start would still mean a full repair
 *    pass on every Nextcloud restart — so this sets its own sentinel
 *    (`core hlm_mimetype_migrated`) the first time it succeeds and skips the
 *    repair after that.
 *
 * Runs after `docker compose up` on every Nextcloud start. No-op for every
 * other service. Never throws.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';
const MAINTENANCE_WINDOW_START_HOUR = 2;
const MIMETYPE_MIGRATED_FLAG = 'hlm_mimetype_migrated';

/** Exported for the unit test. */
export function buildMaintenanceScript(): string[] {
  return [
    `php occ config:system:set maintenance_window_start --type integer --value "${MAINTENANCE_WINDOW_START_HOUR}"`,
    `if [ "$(php occ config:app:get core ${MIMETYPE_MIGRATED_FLAG} 2>/dev/null)" != "1" ]; then`,
    '  php occ maintenance:repair --include-expensive',
    `  php occ config:app:set core ${MIMETYPE_MIGRATED_FLAG} --value "1"`,
    '  echo "hlm: mimetype migrations run"',
    'else',
    '  echo "hlm: mimetype migrations already applied"',
    'fi',
    'echo "hlm: maintenance window configured"',
  ];
}

export async function reconcileNextcloudMaintenance(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }
  if (!resolveComposeFile(NEXTCLOUD_SERVICE)?.composeFile) {
    return;
  }

  try {
    // The mimetype repair pass can genuinely take a while on a large
    // instance (the warning's own reason it isn't run automatically) — give
    // it more room than the scaffold's 180s default.
    const result = await runNextcloudOccScript(buildMaintenanceScript(), { timeoutMs: 600_000 });
    logger.info('Nextcloud maintenance window + mimetype migrations reconciled', {
      ok: result.ok,
      output: result.output || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to reconcile Nextcloud maintenance settings', { error: (error as Error).message });
  }
}
