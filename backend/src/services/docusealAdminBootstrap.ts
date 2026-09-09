/**
 * Create DocuSeal's first (admin) account on start, so there is no manual
 * "run the /setup wizard" step (§341, principle 3).
 *
 * DocuSeal's community edition has no OIDC/SAML (SSO is Pro-only), so unlike
 * Immich/Vikunja/Mealie there is no OIDC client to wire and no way to hide
 * DocuSeal's own login form — Authelia is the outer forward-auth gate and the
 * user still signs in to DocuSeal with a password. What this removes is the
 * onboarding form: the account is created with the Authelia admin's email and
 * a generated `DOCUSEAL_ADMIN_PASSWORD`, so exposing DocuSeal lands the
 * webmaster straight on a login page instead of a setup wizard.
 *
 * Shape mirrors immichAdminBootstrap.ts: resolve the cross-project base URL,
 * poll for the webapp, drive the flow, best-effort (never throws, never
 * blocks the start). Runs after `docker compose up` on every DocuSeal start.
 *
 * Idempotent by construction: once any user exists, DocuSeal's
 * `ensure_first_user_not_created!` redirects /setup away, which
 * `getSetupState` reports as `already-setup`.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { createFirstAdmin, getSetupState } from './docusealClient';

export const DOCUSEAL_SERVICE = 'docuseal';
export const DOCUSEAL_ADMIN_PASSWORD_KEY = 'DOCUSEAL_ADMIN_PASSWORD';
// Compose always sets ${DOCUSEAL_PORT:-10150}; this only covers a parse miss.
const FALLBACK_PORT = 10150;
const ACCOUNT_NAME = 'DocuSeal';

// Poll for up to 60s (20 x 3s), same budget as immichAdminBootstrap — `up`
// returns well before DocuSeal's Puma is serving.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveDocusealBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(DOCUSEAL_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

/** Split an Authelia display name into first/last; fall back to Admin / User. */
function splitName(displayName: string | undefined): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Admin', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Admin' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export async function reconcileDocusealFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== DOCUSEAL_SERVICE) {
    return;
  }
  if (!resolveComposeFile(DOCUSEAL_SERVICE)?.composeFile) {
    return;
  }

  // Only meaningful while exposed — that's when the webmaster reaches DocuSeal
  // through Authelia. A non-exposed DocuSeal keeps its normal UI onboarding.
  const exposureRow = await getServiceExposureRow(DOCUSEAL_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(DOCUSEAL_SERVICE, DOCUSEAL_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`DocuSeal admin bootstrap skipped: ${DOCUSEAL_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const adminUser = getAutheliaAdminUser();
  const email = adminUser?.email?.trim();
  if (!email) {
    logger.warn(
      'DocuSeal admin bootstrap skipped: no Authelia admin email yet — complete the dashboard /setup with an email first.'
    );
    return;
  }
  const { firstName, lastName } = splitName(adminUser?.displayName);
  const appUrl = exposureRow.hostname ? `https://${exposureRow.hostname}` : await resolveDocusealBaseUrl();

  try {
    const baseUrl = await resolveDocusealBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      if (state.state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('DocuSeal admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state.state === 'already-setup') {
        logger.info('DocuSeal already has an admin account; nothing to bootstrap');
        return;
      }

      const result = await createFirstAdmin(baseUrl, {
        token: state.token,
        cookie: state.cookie,
        email,
        password,
        firstName,
        lastName,
        accountName: ACCOUNT_NAME,
        appUrl,
      });
      if (result === 'created') {
        logger.info(`Created DocuSeal's first admin (${email}) via the /setup wizard`);
      } else if (result === 'already-setup') {
        logger.info('DocuSeal already has an admin account; nothing to bootstrap');
      } else {
        logger.error('DocuSeal admin bootstrap: the /setup POST failed (validation or CSRF) — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the DocuSeal first admin', { error: (error as Error).message });
  }
}
