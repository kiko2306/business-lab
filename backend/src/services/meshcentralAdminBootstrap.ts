/**
 * Create MeshCentral's first (site-admin) account on start, so reaching it
 * lands on a login page instead of an open "create account" form.
 *
 * MeshCentral is exposed directly, without Authelia (see services.ts), and
 * hands **full site admin** to whoever creates the first account.
 * `ALLOW_NEW_ACCOUNTS=false` does not stop that: webserver.js always admits
 * the first account. Found live on 2026-09-18, with the public login page
 * serving `newAccount="true"` to anyone.
 *
 * The account is the Authelia admin's username + email with a generated
 * `MESHCENTRAL_ADMIN_PASSWORD`, readable in the config panel. No exposure gate,
 * for the same reason as navidromeAdminBootstrap: the open form is a problem
 * on the LAN too.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { requestJson } from '../utils/httpJson';
import { getAutheliaAdminUser } from './autheliaUsers';
import { readAppEnvValue } from './appEnv';

export const MESHCENTRAL_SERVICE = 'meshcentral';
export const MESHCENTRAL_ADMIN_PASSWORD_KEY = 'MESHCENTRAL_ADMIN_PASSWORD';
// Compose always sets ${MESHCENTRAL_PORT:-10510}; this only covers a parse miss.
const FALLBACK_PORT = 10510;

// MeshCentral signs its agent binaries on first boot ("Code signed
// MeshService.exe" …), so it answers noticeably later than most apps.
const MAX_ATTEMPTS = 40;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SetupState = 'unreachable' | 'needs-admin' | 'already-setup';

/**
 * The login page embeds `newAccount="true"` while new accounts are allowed.
 * With ALLOW_NEW_ACCOUNTS off, that is exactly "this domain has no users yet"
 * (webserver.js: `newAccountsAllowed`).
 *
 * Fails **closed**: only the exact `newAccount="true"` counts. If MeshCentral
 * renames or re-quotes it, this reads as already set up and skips, rather
 * than POSTing an account at a server that has users.
 */
export function readSetupState(loginPageHtml: string): SetupState {
  return /\bnewAccount="true"/.test(loginPageHtml) ? 'needs-admin' : 'already-setup';
}

async function getSetupState(url: string): Promise<SetupState> {
  try {
    const response = await requestJson(`${url}/`, { timeout: REQUEST_TIMEOUT_MS, insecureTls: true });
    if (response.statusCode !== 200) return 'unreachable';
    return readSetupState(response.raw);
  } catch {
    return 'unreachable';
  }
}

export async function reconcileMeshcentralFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== MESHCENTRAL_SERVICE) return;
  if (!resolveComposeFile(MESHCENTRAL_SERVICE)?.composeFile) return;

  const password = readAppEnvValue(MESHCENTRAL_SERVICE, MESHCENTRAL_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`MeshCentral admin bootstrap skipped: ${MESHCENTRAL_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const admin = getAutheliaAdminUser();
  const username = admin?.username?.trim();
  const email = admin?.email?.trim();
  if (!username || !email) {
    logger.warn('MeshCentral admin bootstrap skipped: no Authelia admin yet — complete the dashboard /setup first.');
    return;
  }

  try {
    const port = getPublishedUpstreamPort(MESHCENTRAL_SERVICE) ?? FALLBACK_PORT;
    const host = await getHostGatewayIp();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Standalone it serves its own self-signed HTTPS; exposed, TLS is
      // offloaded to NPM and it serves plain HTTP on the same port. Try both,
      // like the compose healthcheck. MESHCENTRAL_TLS_OFFLOAD can't decide it:
      // exposure injects it at start and never writes it to .env.
      let url = `http://${host}:${port}`;
      let state = await getSetupState(url);
      if (state === 'unreachable') {
        url = `https://${host}:${port}`;
        state = await getSetupState(url);
      }

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('MeshCentral admin bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-setup') {
        logger.info('MeshCentral already has an account; nothing to bootstrap');
        return;
      }

      // The login page's own form. It answers with a redirect whether it
      // succeeded or not (the reason goes into the session), so the page is
      // re-read to see whether the claim actually took.
      const form = new URLSearchParams({ username, email, password1: password, password2: password });
      await requestJson(`${url}/createaccount`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        rawBody: Buffer.from(form.toString()),
        timeout: REQUEST_TIMEOUT_MS,
        insecureTls: true,
      });

      if ((await getSetupState(url)) === 'already-setup') {
        logger.info('MeshCentral admin account created', { username });
      } else {
        logger.warn('MeshCentral admin bootstrap failed: the create-account form is still open after submitting it');
      }
      return;
    }
  } catch (error) {
    logger.warn('MeshCentral admin bootstrap failed', { error: (error as Error).message });
  }
}
