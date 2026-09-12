/**
 * Claim n8n's owner account on start, so an exposed n8n lands on a login
 * page instead of a "set up owner" wizard (§419, principle 3).
 *
 * n8n community has no SSO (SAML is enterprise-only), so it sits behind
 * Authelia *and* keeps its own login. Leaving the owner unclaimed on a
 * publicly reachable instance means the first visitor to get through
 * Authelia decides who owns it — the same first-visit claim race
 * immichAdminBootstrap/docusealAdminBootstrap exist to close. The account is
 * created with the Authelia admin's email and a generated
 * `N8N_ADMIN_PASSWORD`, readable in the app's config panel.
 *
 * Idempotent by construction: `showSetupOnFirstLoad` in n8n's own
 * `/rest/settings` is n8n's answer to "does an owner exist yet", so once one
 * does this does nothing. Best-effort throughout — never throws, never
 * blocks the start. Runs after `docker compose up`.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';

export const N8N_SERVICE = 'n8n';
export const N8N_ADMIN_PASSWORD_KEY = 'N8N_ADMIN_PASSWORD';
// Compose always sets ${N_PORT:-10240}; this only covers a parse miss.
const FALLBACK_PORT = 10240;

// 60s (20 x 3s), the same budget the sibling bootstraps use — `up` returns
// well before n8n's editor backend is answering /rest.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Split an Authelia display name into first/last; fall back to Admin / User. */
export function splitName(displayName: string | undefined): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Admin', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Admin' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

type SetupState = 'unreachable' | 'needs-owner' | 'already-owned';

/**
 * n8n reports "no owner yet" as `showSetupOnFirstLoad` on its own settings
 * endpoint. Exported for the test: the shape of that reply is the one thing
 * here worth pinning, since a rename upstream would otherwise silently turn
 * this into "already owned" and skip the bootstrap forever.
 */
export function readSetupState(settingsBody: unknown): SetupState {
  const data = (settingsBody as { data?: { userManagement?: { showSetupOnFirstLoad?: boolean } } })?.data;
  return data?.userManagement?.showSetupOnFirstLoad === true ? 'needs-owner' : 'already-owned';
}

async function getSetupState(baseUrl: string): Promise<SetupState> {
  try {
    const response = await fetch(`${baseUrl}/rest/settings`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return 'unreachable';
    return readSetupState(await response.json());
  } catch {
    return 'unreachable';
  }
}

export async function reconcileN8nFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== N8N_SERVICE) return;
  if (!resolveComposeFile(N8N_SERVICE)?.composeFile) return;

  // Only meaningful while exposed: that's when an unclaimed owner is a race
  // with whoever reaches the public hostname first. A LAN-only n8n keeps its
  // own onboarding, where a human can choose their own password.
  const exposureRow = await getServiceExposureRow(N8N_SERVICE);
  if (!exposureRow?.enabled) return;

  const password = readAppEnvValue(N8N_SERVICE, N8N_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`n8n owner bootstrap skipped: ${N8N_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const adminUser = getAutheliaAdminUser();
  const email = adminUser?.email?.trim();
  if (!email) {
    logger.warn(
      'n8n owner bootstrap skipped: no Authelia admin email yet — complete the dashboard /setup with an email first.'
    );
    return;
  }
  const { firstName, lastName } = splitName(adminUser?.displayName);

  try {
    const port = getPublishedUpstreamPort(N8N_SERVICE) ?? FALLBACK_PORT;
    const baseUrl = `http://${await getHostGatewayIp()}:${port}`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('n8n owner bootstrap gave up: the app never became reachable');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-owned') {
        logger.info('n8n already has an owner account; nothing to bootstrap');
        return;
      }

      const response = await fetch(`${baseUrl}/rest/owner/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, lastName, password }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.warn('n8n owner bootstrap failed', { status: response.status, body: text.slice(0, 300) });
        return;
      }
      logger.info('n8n owner account created', { email });
      return;
    }
  } catch (error) {
    // Same reasoning as every sibling bootstrap: a failure here must never
    // block the app's start. Retried on the next one.
    logger.warn('n8n owner bootstrap failed', { error: (error as Error).message });
  }
}
