/**
 * Re-sync Kimai's admin account (email + password) after its first boot.
 *
 * Kimai's own entrypoint only ever *creates* the admin (`kimai:user:create
 * admin` from ADMINMAIL/ADMINPASS, no-ops once the row exists) — so a
 * KIMAI_ADMIN_EMAIL/KIMAI_ADMIN_PASSWORD change after that first boot never
 * reached the real account. Found live (2026-09-16):
 * tx-home-utils.com's admin row still held the Authelia admin's placeholder
 * email from Kimai's very first boot. Same drift class as DocuSeal's
 * `reconcileDocusealAdminPassword` (§495); §501 closes it the same way —
 * `kimaiDb.ts`'s `reconcileKimaiAdminIdentity` checks `password_verify()`
 * first, so a normal start where nothing changed writes nothing.
 *
 * Gated on exposure the same way DocuSeal's bootstrap is: Kimai is exposed
 * directly with only its own login (`skipAutheliaProtection`, §342), so
 * that's the only time a drifted admin identity is actually reachable by
 * anyone.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { reconcileKimaiAdminIdentity } from './kimaiDb';

export const KIMAI_SERVICE = 'kimai';
export const KIMAI_ADMIN_PASSWORD_KEY = 'KIMAI_ADMIN_PASSWORD';

export async function reconcileKimaiAdminAccount(serviceName: string): Promise<void> {
  if (serviceName !== KIMAI_SERVICE) {
    return;
  }
  if (!resolveComposeFile(KIMAI_SERVICE)?.composeFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(KIMAI_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(KIMAI_SERVICE, KIMAI_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Kimai admin sync skipped: ${KIMAI_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const email = getAutheliaAdminUser()?.email?.trim();
  if (!email) {
    logger.warn(
      'Kimai admin sync skipped: no Authelia admin email yet — complete the dashboard /setup with an email first.'
    );
    return;
  }

  const result = await reconcileKimaiAdminIdentity(email, password);
  if (result === 'synced') {
    logger.info(`Synced Kimai's admin account (${email}) to the current config-panel/Authelia values`);
  } else if (result === 'not-found') {
    logger.warn('Kimai admin sync skipped: no admin account found yet — the entrypoint creates it on first boot');
  } else if (result === 'failed') {
    logger.error('Kimai admin sync failed — will retry next start');
  }
  // 'unchanged' — the common case every start, nothing to log.
}
