/**
 * Create Navidrome's first (admin) account on start, so reaching it lands on
 * a login page instead of a "create your admin user" form (§420, principle 3).
 *
 * Navidrome has no OIDC, so its own login is the only gate. The account is
 * the Authelia admin's **username** (Navidrome logins are username-based)
 * with a generated `NAVIDROME_ADMIN_PASSWORD`, readable in the config panel.
 *
 * No exposure gate — see jellyfinAdminBootstrap/§419: the unclaimed-admin
 * form is a step for the admin whether or not the app is on the tunnel, and
 * gating on `service_exposure.enabled` silently disables the whole bootstrap
 * for any app whose `getExposability()` refuses.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { readAppEnvValue } from './appEnv';

export const NAVIDROME_SERVICE = 'navidrome';
export const NAVIDROME_ADMIN_PASSWORD_KEY = 'NAVIDROME_ADMIN_PASSWORD';
// Compose always sets ${NAVIDROME_PORT:-10570}; this only covers a parse miss.
const FALLBACK_PORT = 10570;

const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SetupState = 'unreachable' | 'needs-admin' | 'already-setup';

/**
 * Navidrome has no JSON endpoint for "has an admin been created", so this
 * reads the flag it embeds in its own app shell. That config arrives as a
 * JSON *string* inside a JS assignment (`window.__APP_CONFIG__ = "{...}"`),
 * so the quotes are backslash-escaped — hence the optional escapes.
 *
 * Fails **closed**: only an explicit `firstTime: true` counts. If Navidrome
 * renames the flag or stops embedding it, this reads as already set up and
 * skips, rather than POSTing createAdmin at a server that has users.
 */
export function readSetupState(appShellHtml: string): SetupState {
  return /\\?"firstTime\\?":\s*true/.test(appShellHtml) ? 'needs-admin' : 'already-setup';
}

async function getSetupState(baseUrl: string): Promise<SetupState> {
  try {
    const response = await fetch(`${baseUrl}/app/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return 'unreachable';
    return readSetupState(await response.text());
  } catch {
    return 'unreachable';
  }
}

export async function reconcileNavidromeFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== NAVIDROME_SERVICE) return;
  if (!resolveComposeFile(NAVIDROME_SERVICE)?.composeFile) return;

  const password = readAppEnvValue(NAVIDROME_SERVICE, NAVIDROME_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`Navidrome admin bootstrap skipped: ${NAVIDROME_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const username = getAutheliaAdminUser()?.username?.trim();
  if (!username) {
    logger.warn('Navidrome admin bootstrap skipped: no Authelia admin yet — complete the dashboard /setup first.');
    return;
  }

  try {
    const port = getPublishedUpstreamPort(NAVIDROME_SERVICE) ?? FALLBACK_PORT;
    const baseUrl = `http://${await getHostGatewayIp()}:${port}`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Navidrome admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-setup') {
        logger.info('Navidrome already has an admin account; nothing to bootstrap');
        return;
      }

      const response = await fetch(`${baseUrl}/auth/createAdmin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.warn('Navidrome admin bootstrap failed', { status: response.status, body: text.slice(0, 300) });
        return;
      }
      logger.info('Navidrome admin account created', { username });
      return;
    }
  } catch (error) {
    logger.warn('Navidrome admin bootstrap failed', { error: (error as Error).message });
  }
}
