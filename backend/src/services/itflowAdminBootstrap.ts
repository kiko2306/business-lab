/**
 * Run ITFlow's first-run setup wizard on start, so there's no manual step and
 * no first-visitor-claims-admin race once ITFlow is exposed directly (§344).
 *
 * Same shape as docusealAdminBootstrap / immichAdminBootstrap: resolve the
 * cross-project base URL, poll for the webapp, drive the flow, best-effort
 * (never throws, never blocks the start). Runs after `docker compose up` on
 * every ITFlow start. Idempotent — once the wizard's telemetry step has run,
 * `setup/` 302s away and getSetupState reports `already-setup`.
 *
 * ITFlow can't use Authelia (OIDC-only) and can't hide its own form, and its
 * client portal must be public, so its own login is the only gate — the admin
 * account this creates (Authelia admin's email + generated
 * `ITFLOW_ADMIN_PASSWORD`) is it. Enable 2FA in ITFlow's own profile settings
 * afterwards.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAppTimezone } from '../utils/generalSettings';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { getSetupState, runSetupWizard } from './itflowClient';

export const ITFLOW_SERVICE = 'itflow';
export const ITFLOW_ADMIN_PASSWORD_KEY = 'ITFLOW_ADMIN_PASSWORD';
const FALLBACK_PORT = 10420;
const COMPANY_NAME = 'Company';

// The itfloworg image downloads ITFlow's source and runs its DB migration on
// first boot with no ready signal — give it up to ~3 min to reach the user
// step before giving up.
const MAX_ATTEMPTS = 60;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveItflowBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(ITFLOW_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileItflowFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== ITFLOW_SERVICE) {
    return;
  }
  if (!resolveComposeFile(ITFLOW_SERVICE)?.composeFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(ITFLOW_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(ITFLOW_SERVICE, ITFLOW_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`ITFlow admin bootstrap skipped: ${ITFLOW_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const admin = getAutheliaAdminUser();
  const email = admin?.email?.trim();
  if (!email) {
    logger.warn('ITFlow admin bootstrap skipped: no Authelia admin email yet');
    return;
  }
  const name = admin?.displayName?.trim() || 'Admin';
  const timezone = (await getAppTimezone().catch(() => null)) || 'UTC';

  try {
    const baseUrl = await resolveItflowBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      // 'not-ready' = reachable but still migrating; 'unreachable' = no useful
      // response yet. Both mean keep polling — never run the wizard against a
      // half-initialised ITFlow (§346).
      if (state === 'unreachable' || state === 'not-ready') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn(
            `ITFlow admin bootstrap gave up: the setup wizard never reached the user step (last state: ${state})`
          );
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-setup') {
        logger.info('ITFlow setup is already complete; nothing to bootstrap');
        return;
      }

      const result = await runSetupWizard(baseUrl, { name, email, password, companyName: COMPANY_NAME, timezone });
      if (result === 'completed') {
        logger.info(`Ran ITFlow's setup wizard and created its admin (${email})`);
      } else if (result === 'already-setup') {
        logger.info('ITFlow setup is already complete; nothing to bootstrap');
      } else {
        logger.error('ITFlow admin bootstrap: the setup wizard did not complete — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the ITFlow first admin', { error: (error as Error).message });
  }
}
