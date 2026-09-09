/**
 * Create Immich's first (admin) account on an exposed start, so per-app OIDC
 * has an admin to link to (§329). Immich completes the Authelia OAuth token
 * exchange fine, then refuses to *provision* the account it got — "The first
 * registered account must the administrator" — because Immich won't make the
 * very first account via OAuth. So the dashboard makes it, once, over the
 * unauthenticated `admin-sign-up` endpoint.
 *
 * Shape: guacamoleAdminRotate.ts / mealieAiSync.ts — resolve the cross-project
 * base URL, poll for the webapp, drive REST, best-effort (never throws, never
 * blocks the start). Runs after `docker compose up` on every Immich start.
 *
 * Idempotent by construction: `admin-sign-up` 400s once an admin exists, which
 * this treats as success. The email is the Authelia admin's
 * (`getAutheliaAdminUser()`), so the webmaster's own OIDC login then links to
 * this account by email rather than creating a second one. `IMMICH_ADMIN_PASSWORD`
 * is a `hiddenGeneratedSecret` (services.ts) that never leaves this process —
 * password login is dropped for Authelia anyway; it exists only to satisfy the
 * sign-up call and as a break-glass credential.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { immichAdminSignUp, immichPing } from './immichClient';

export const IMMICH_SERVICE = 'immich';
export const IMMICH_ADMIN_PASSWORD_KEY = 'IMMICH_ADMIN_PASSWORD';
// Compose always sets ${IMMICH_PORT:-10200}; this only covers a parse miss.
const FALLBACK_PORT = 10200;

// Poll for up to 60s (20 x 3s), same budget as guacamoleAdminRotate — `up`
// returns before Immich's API is serving.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveImmichBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(IMMICH_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileImmichFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== IMMICH_SERVICE) {
    return;
  }
  if (!resolveComposeFile(IMMICH_SERVICE)?.composeFile) {
    return;
  }

  // Only meaningful while exposed — that's when OIDC is wired and needs an
  // admin. A non-exposed Immich keeps its normal "create the first account in
  // the UI" onboarding.
  const exposureRow = await getServiceExposureRow(IMMICH_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(IMMICH_SERVICE, IMMICH_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Immich admin bootstrap skipped: ${IMMICH_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const email = getAutheliaAdminUser()?.email?.trim();
  if (!email) {
    logger.warn(
      'Immich admin bootstrap skipped: no Authelia admin email yet — the first OIDC login would not link. Complete /setup with an email first.'
    );
    return;
  }

  try {
    const baseUrl = await resolveImmichBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let reachable = false;
      try {
        reachable = await immichPing(baseUrl);
      } catch {
        reachable = false;
      }
      if (!reachable) {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Immich admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const result = await immichAdminSignUp(baseUrl, email, password, 'Admin');
      if (result === 'created') {
        logger.info(`Created Immich's first admin (${email}) so OIDC can link to it`);
      } else if (result === 'already-exists') {
        logger.info('Immich already has an admin account; nothing to bootstrap');
      } else {
        logger.error('Immich admin bootstrap: admin-sign-up call failed');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the Immich first admin', { error: (error as Error).message });
  }
}
