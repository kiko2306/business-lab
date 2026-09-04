/**
 * Auto-rotate Guacamole's shipped `guacadmin`/`guacadmin` default admin
 * password on first successful login, so it never sits reachable at a real
 * hostname behind only whatever Authelia session an attacker has (§199,
 * §200 slice 1). Backend-generated `GUACAMOLE_ADMIN_PASSWORD`
 * (`hiddenGeneratedSecrets`, services.ts) never leaves this process.
 *
 * Idempotent by construction, not by tracking state: a default-credential
 * login attempt either succeeds (rotate it) or fails (someone/something —
 * this same reconciler, on an earlier start — already changed it), so
 * nothing needs to be recorded to avoid re-rotating.
 *
 * Runs after `docker compose up` on every Guacamole start (executor.ts),
 * same placement as the Nextcloud roster reconcilers. Unlike those, this one
 * talks REST, not `docker compose run occ`, so it has to poll for
 * reachability itself: `up` returns long before the webapp has finished
 * booting (its own healthcheck start_period is 60s) and a webapp/extension
 * version mismatch, not a boot delay, would otherwise look identical from
 * out here. No-op for every other service. Never throws.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { readAppEnvValue } from './appEnv';
import { guacamoleLogin, guacamoleLogout, guacamoleSetPassword } from './guacamoleClient';

const GUACAMOLE_SERVICE = 'guacamole';
const DEFAULT_USERNAME = 'guacadmin';
const DEFAULT_PASSWORD = 'guacadmin';
const GENERATED_PASSWORD_KEY = 'GUACAMOLE_ADMIN_PASSWORD';
// Guacamole has no published port env var fallback needed here — the compose
// file always sets one (${GUACAMOLE_PORT:-10430}); this default only covers
// a getPublishedUpstreamPort() parse miss.
const FALLBACK_PORT = 10430;

// Poll for up to 60s (20 x 3s) before giving up — a start that isn't ready
// yet just retries on the next one, same budget as nextcloudOcc's WAIT_FOR_OCC.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(GUACAMOLE_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileGuacamoleAdminPassword(serviceName: string): Promise<void> {
  if (serviceName !== GUACAMOLE_SERVICE) {
    return;
  }
  if (!resolveComposeFile(GUACAMOLE_SERVICE)?.composeFile) {
    return;
  }

  const newPassword = readAppEnvValue(GUACAMOLE_SERVICE, GENERATED_PASSWORD_KEY);
  if (!newPassword) {
    logger.error(`Guacamole admin password rotation skipped: ${GENERATED_PASSWORD_KEY} is not set`);
    return;
  }

  try {
    const baseUrl = await resolveBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let session;
      try {
        session = await guacamoleLogin(baseUrl, DEFAULT_USERNAME, DEFAULT_PASSWORD);
      } catch (error) {
        // Not reachable yet. Last attempt logs and gives up; the rest just retry.
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('Guacamole admin password rotation gave up: the app never became reachable', {
            error: (error as Error).message,
          });
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (!session) {
        // Reachable, but the default credentials were rejected — already
        // rotated (by this reconciler on an earlier start, or by hand).
        // Nothing to do.
        logger.info("Guacamole's default admin credentials are no longer active; nothing to rotate");
        return;
      }

      const ok = await guacamoleSetPassword(baseUrl, session, DEFAULT_USERNAME, DEFAULT_PASSWORD, newPassword);
      await guacamoleLogout(baseUrl, session);

      if (ok) {
        logger.info("Rotated Guacamole's default admin password");
      } else {
        logger.error('Guacamole default admin login succeeded but the password update call failed');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to rotate the Guacamole default admin password', { error: (error as Error).message });
  }
}
