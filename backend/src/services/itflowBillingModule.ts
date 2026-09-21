/**
 * Hide (or restore) ITFlow's billing/accounting module from a config-panel
 * checkbox, since ITFlow has no environment-variable path for this either
 * (same situation as itflowMailCron.ts) — it's a single row,
 * `settings.config_module_enable_accounting` (`company_id = 1`), toggled by
 * ITFlow's own `admin/post/settings_module.php` with nothing more than a
 * plain `UPDATE`. Reconciled here via itflowDb.ts's runItflowDbScript, same
 * mechanism as the mail/cron reconciler (plan.md §560).
 *
 * This only ever *hides* the module (nav link, dashboard widget, and
 * client-portal invoice/quote views) — the code/tables/routes stay in the
 * container; there is no upstream way to remove it.
 *
 * Runs after `docker compose up` on every ITFlow start, after
 * reconcileItflowMailCron — same ordering constraint: the `settings` row
 * this writes to only exists once the setup wizard's `add_company_settings`
 * step has created it. No-op for every other service. Never fatal — a
 * failure here means billing stays visible, not a broken ITFlow.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { runItflowDbScript } from './itflowDb';

const ITFLOW_SERVICE = 'itflow';
const TOGGLE_KEY = 'ITFLOW_HIDE_BILLING';

/** Exported for the unit test. Always asserts the desired state, so toggling the checkbox back off restores the module. */
export function buildBillingModuleScript(hide: boolean): string[] {
  return [
    `$mysqli->query("UPDATE settings SET config_module_enable_accounting = ${hide ? 0 : 1} WHERE company_id = 1");`,
    `echo "hlm: billing module ${hide ? 'hidden' : 'restored'}\\n";`,
  ];
}

export async function reconcileItflowBillingModule(serviceName: string): Promise<void> {
  if (serviceName !== ITFLOW_SERVICE) {
    return;
  }
  if (!resolveComposeFile(ITFLOW_SERVICE)?.composeFile) {
    return;
  }

  try {
    const hide = (readAppEnvValue(ITFLOW_SERVICE, TOGGLE_KEY) ?? '').trim().toLowerCase() === 'true';
    const result = await runItflowDbScript(buildBillingModuleScript(hide));
    logger.info(`ITFlow billing module reconciled (${hide ? 'hidden' : 'visible'})`, {
      ok: result.ok,
      output: result.output || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to reconcile ITFlow billing module', { error: (error as Error).message });
  }
}
