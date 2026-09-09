/**
 * Run Home Assistant's onboarding on start, so exposing it directly (§344)
 * doesn't open a first-visitor-claims-owner race and there's no manual step.
 *
 * HA core can't sit behind Authelia with its form hidden (no OIDC, no
 * header-trust behind a trusted proxy — §311), so its own login is the only
 * gate; the owner this creates (Authelia admin's username + generated
 * `HOMEASSISTANT_ADMIN_PASSWORD`) is it. Its managed `configuration.yaml`
 * http: block also turns on `ip_ban_enabled` so brute-force lockout is
 * active (services/exposureConfigFiles.ts).
 *
 * Shape mirrors docusealAdminBootstrap: resolve the base URL, poll for the
 * app, drive REST, best-effort (never throws, never blocks the start).
 * Idempotent — `GET /api/onboarding` reports the `user` step done, and
 * `POST /api/onboarding/users` 403s, once claimed.
 */

import logger from '../utils/logger';
import { getService, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { createOwner, getOnboardingState } from './homeAssistantClient';

export const HA_SERVICE = 'home-assistant';
export const HA_ADMIN_PASSWORD_KEY = 'HOMEASSISTANT_ADMIN_PASSWORD';
const FALLBACK_PORT = 8123;

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveHaBaseUrl(): Promise<string> {
  // HA is host-networked (no ports mapping) — hostNetworkPort in the registry,
  // reached from the backend container over the host gateway.
  const port = getService(HA_SERVICE)?.hostNetworkPort ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileHomeAssistantFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== HA_SERVICE) {
    return;
  }
  if (!resolveComposeFile(HA_SERVICE)?.composeFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(HA_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(HA_SERVICE, HA_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Home Assistant admin bootstrap skipped: ${HA_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const admin = getAutheliaAdminUser();
  const username = admin?.username?.trim();
  if (!username) {
    logger.warn('Home Assistant admin bootstrap skipped: no Authelia admin yet');
    return;
  }
  const name = admin?.displayName?.trim() || username;
  const clientId = exposureRow.hostname ? `https://${exposureRow.hostname}/` : await resolveHaBaseUrl();

  try {
    const baseUrl = await resolveHaBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getOnboardingState(baseUrl);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Home Assistant admin bootstrap gave up: onboarding never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'done') {
        logger.info('Home Assistant onboarding is already complete; nothing to bootstrap');
        return;
      }

      const result = await createOwner(baseUrl, { name, username, password, clientId, language: 'en' });
      if (result === 'created') {
        logger.info(`Created Home Assistant's owner account (${username}) via onboarding`);
      } else if (result === 'already-done') {
        logger.info('Home Assistant onboarding is already complete; nothing to bootstrap');
      } else {
        logger.error('Home Assistant admin bootstrap: onboarding POST failed — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the Home Assistant owner', { error: (error as Error).message });
  }
}
