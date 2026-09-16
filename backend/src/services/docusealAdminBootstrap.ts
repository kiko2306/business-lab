/**
 * Create DocuSeal's first (admin) account on start, so there is no manual
 * "run the /setup wizard" step (§341, principle 3).
 *
 * DocuSeal's community edition has no OIDC/SAML (SSO is Pro-only) and no way
 * to hide its own login form, so — rather than stack Authelia in front for a
 * second login (§342) — DocuSeal is exposed directly and its own login is the
 * only gate. This bootstrap makes that gate usable with no manual step: the
 * account is created with the Authelia admin's email (a familiar identity)
 * and a generated `DOCUSEAL_ADMIN_PASSWORD`, so exposing DocuSeal lands the
 * webmaster straight on a login page instead of a setup wizard.
 *
 * Shape mirrors immichAdminBootstrap.ts: resolve the cross-project base URL,
 * poll for the webapp, drive the flow, best-effort (never throws, never
 * blocks the start). Runs after `docker compose up` on every DocuSeal start.
 *
 * Idempotent by construction for *creation*: once any user exists, DocuSeal's
 * `ensure_first_user_not_created!` redirects /setup away, which
 * `getSetupState` reports as `already-setup`. That account's login email can
 * still drift from Authelia's, though — the Authelia admin's own email is
 * editable after the fact, and the account created here is never touched
 * again by construction. §475: the very first DocuSeal admin (2026-09-09) was
 * created while the Authelia admin's email was still a placeholder
 * (`admin@example.com`), which was later changed — DocuSeal's login silently
 * kept the placeholder forever, since nothing ever re-checked it. `syncAdminEmail`
 * below re-checks on every start and logs into the account to fix it when it
 * has, using `DOCUSEAL_ADMIN_EMAIL_KEY` to remember what email the account is
 * currently believed to hold (same carrier-env trick as the password).
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue, saveServiceEnv } from './appEnv';
import { createFirstAdmin, getSetupState, signIn, updateProfileEmail } from './docusealClient';

export const DOCUSEAL_SERVICE = 'docuseal';
export const DOCUSEAL_ADMIN_PASSWORD_KEY = 'DOCUSEAL_ADMIN_PASSWORD';
export const DOCUSEAL_ADMIN_EMAIL_KEY = 'DOCUSEAL_ADMIN_EMAIL';
// The one pre-existing install (§341) has no DOCUSEAL_ADMIN_EMAIL recorded —
// this feature didn't exist yet when its account was created — so the first
// drift check on that install has nothing to sign in as except the literal
// email §475 found still sitting in its `users` table. Any install created
// after this shipped records its own email at creation and never needs this.
const LEGACY_UNTRACKED_EMAIL = 'admin@example.com';
// Compose always sets ${DOCUSEAL_PORT:-10150}; this only covers a parse miss.
const FALLBACK_PORT = 10150;
const ACCOUNT_NAME = 'DocuSeal';

// Poll for up to 60s (20 x 3s), same budget as immichAdminBootstrap — `up`
// returns well before DocuSeal's Puma is serving.
const MAX_ATTEMPTS = 20;
const RETRY_DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Exported for docusealTeamProvisioning.ts — same cross-project base URL a
// per-user account create needs to sign in as the admin against, and the
// same name-splitting rule for whatever display name the grantee has.
export async function resolveDocusealBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(DOCUSEAL_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

/** Split a display name into first/last; fall back to Admin / User. */
export function splitName(displayName: string | undefined): { firstName: string; lastName: string } {
  const parts = (displayName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Admin', lastName: 'User' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Admin' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Re-sync the existing admin's login email to Authelia's current one when
 * they've drifted apart. No-op if `DOCUSEAL_ADMIN_EMAIL_KEY` already matches
 * (the common case, checked every start but costing no request). A failed
 * sign-in or update just logs and retries next start — same "never blocks"
 * shape as the rest of this file.
 */
async function syncAdminEmail(
  baseUrl: string,
  currentEmail: string,
  password: string,
  firstName: string,
  lastName: string
): Promise<void> {
  const trackedEmail = readAppEnvValue(DOCUSEAL_SERVICE, DOCUSEAL_ADMIN_EMAIL_KEY) ?? LEGACY_UNTRACKED_EMAIL;
  if (trackedEmail === currentEmail) {
    return;
  }

  const signInResult = await signIn(baseUrl, trackedEmail, password);
  if (signInResult.state !== 'signed-in') {
    logger.warn(
      `DocuSeal admin email sync skipped: could not sign in as ${trackedEmail} to change it to ${currentEmail} — log in and update it by hand from DocuSeal's own Profile settings if this persists`
    );
    return;
  }

  const updateResult = await updateProfileEmail(baseUrl, {
    cookie: signInResult.cookie,
    email: currentEmail,
    firstName,
    lastName,
  });
  if (updateResult === 'updated') {
    await saveServiceEnv(DOCUSEAL_SERVICE, { [DOCUSEAL_ADMIN_EMAIL_KEY]: currentEmail });
    logger.info(`Synced DocuSeal's admin login email from ${trackedEmail} to ${currentEmail}`);
  } else {
    logger.error('DocuSeal admin email sync: the profile update was rejected — will retry next start');
  }
}

export async function reconcileDocusealFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== DOCUSEAL_SERVICE) {
    return;
  }
  if (!resolveComposeFile(DOCUSEAL_SERVICE)?.composeFile) {
    return;
  }

  // Only meaningful while exposed — that's when the webmaster reaches DocuSeal
  // over the public hostname. A non-exposed DocuSeal keeps its UI onboarding.
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
        await syncAdminEmail(baseUrl, email, password, firstName, lastName);
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
        await saveServiceEnv(DOCUSEAL_SERVICE, { [DOCUSEAL_ADMIN_EMAIL_KEY]: email });
      } else if (result === 'already-setup') {
        await syncAdminEmail(baseUrl, email, password, firstName, lastName);
      } else {
        logger.error('DocuSeal admin bootstrap: the /setup POST failed (validation or CSRF) — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the DocuSeal first admin', { error: (error as Error).message });
  }
}
