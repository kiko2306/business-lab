/**
 * Run Jellyfin's first-run startup wizard on start, so reaching it on the LAN
 * lands on a login page instead of a setup wizard (§420, principle 3).
 *
 * Jellyfin is `lanOnly` — never on the tunnel or the overlay — and has no
 * OIDC, so its own login is the only gate and this bootstrap is what makes
 * that gate exist. The account is the Authelia admin's **username** (Jellyfin
 * logins are username-based, there is no email field) with a generated
 * `JELLYFIN_ADMIN_PASSWORD`, readable in the app's config panel.
 *
 * No exposure gate, deliberately: `lanOnly` means the `service_exposure` row
 * is always `enabled: false`, so gating on it would make this a permanent
 * no-op — the trap §419 fell into with n8n.
 *
 * `StartupWizardCompleted` on `/System/Info/Public` is the only trustworthy
 * "is it set up" signal. `GET /Startup/User` is **not**: it answers
 * `{"Name":"root"}` on a completely fresh install, because that is the name
 * Jellyfin *proposes* for the first user, not one that exists.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { readAppEnvValue } from './appEnv';

export const JELLYFIN_SERVICE = 'jellyfin';
export const JELLYFIN_ADMIN_PASSWORD_KEY = 'JELLYFIN_ADMIN_PASSWORD';
// Compose always sets ${JELLYFIN_PORT:-10210}; this only covers a parse miss.
const FALLBACK_PORT = 10210;

// 60s (20 x 3s), the same budget the sibling bootstraps use.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SetupState = 'unreachable' | 'needs-wizard' | 'already-setup';

/**
 * Exported for the test. Fails **closed**: anything that is not an explicit
 * `StartupWizardCompleted: false` reads as already set up, so an upstream
 * rename makes this skip rather than re-run the wizard against a live server.
 */
export function readSetupState(publicInfo: unknown): SetupState {
  const completed = (publicInfo as { StartupWizardCompleted?: boolean })?.StartupWizardCompleted;
  return completed === false ? 'needs-wizard' : 'already-setup';
}

async function getSetupState(baseUrl: string): Promise<SetupState> {
  try {
    const response = await fetch(`${baseUrl}/System/Info/Public`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return 'unreachable';
    return readSetupState(await response.json());
  } catch {
    return 'unreachable';
  }
}

async function post(baseUrl: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function reconcileJellyfinFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== JELLYFIN_SERVICE) return;
  if (!resolveComposeFile(JELLYFIN_SERVICE)?.composeFile) return;

  const password = readAppEnvValue(JELLYFIN_SERVICE, JELLYFIN_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Jellyfin wizard bootstrap skipped: ${JELLYFIN_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const username = getAutheliaAdminUser()?.username?.trim();
  if (!username) {
    logger.warn(
      'Jellyfin wizard bootstrap skipped: no Authelia admin yet — complete the dashboard /setup first.'
    );
    return;
  }

  try {
    const port = getPublishedUpstreamPort(JELLYFIN_SERVICE) ?? FALLBACK_PORT;
    const baseUrl = `http://${await getHostGatewayIp()}:${port}`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Jellyfin wizard bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-setup') {
        logger.info('Jellyfin has already completed its startup wizard; nothing to bootstrap');
        return;
      }

      // Two calls, in this order. /Startup/Complete is what flips
      // StartupWizardCompleted, and Jellyfin accepts it whether or not a user
      // was created — so completing before creating the user would lock in a
      // server with no account and no way back through the wizard. That is
      // exactly what a stray probe of it did while this was being written.
      const userResponse = await post(baseUrl, '/Startup/User', { Name: username, Password: password });
      if (!userResponse.ok) {
        const text = await userResponse.text().catch(() => '');
        logger.warn('Jellyfin wizard bootstrap failed creating the admin user', {
          status: userResponse.status,
          body: text.slice(0, 300),
        });
        return;
      }

      const completeResponse = await post(baseUrl, '/Startup/Complete');
      if (!completeResponse.ok) {
        logger.warn('Jellyfin admin user created but the wizard would not complete', {
          status: completeResponse.status,
        });
        return;
      }

      logger.info('Jellyfin startup wizard completed', { username });
      return;
    }
  } catch (error) {
    logger.warn('Jellyfin wizard bootstrap failed', { error: (error as Error).message });
  }
}
