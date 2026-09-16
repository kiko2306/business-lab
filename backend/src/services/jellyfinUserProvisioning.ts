/**
 * Create/update a Jellyfin account for a dashboard user, matching their own
 * password rather than a per-app generated secret (§480 fan-out) — the
 * README's last open credential-fan-out item.
 *
 * Jellyfin logins are username-based with no separate email field
 * (jellyfinAdminBootstrap.ts's doc comment), so — same call Kimai made for
 * the same reason — the dashboard user's email is used as the Jellyfin
 * username: nothing separate to pick or collide on, and it's what lets
 * `disableJellyfinUser` find the right account from just the email the
 * shared Deprovisioner signature gives it.
 *
 * Unlike every other §480 app, Jellyfin is never exposed at all (`lanOnly`
 * — `getExposability()` always reports it non-exposable), so it never gets
 * a `service_exposure` row and could never reach the exposure-gated grant
 * picker (`getGrantableAppOptions`, userAppAccess.ts) the other apps use.
 * That picker was widened to include any no-SSO app with a provisioner
 * regardless of exposure, so Jellyfin shows up as an explicit opt-in
 * checkbox in Users & Roles like the rest — see that module's doc comment.
 *
 * Full REST API, admin-authenticated as the generated-password admin
 * account `jellyfinAdminBootstrap.ts` creates on first boot — no cold DB
 * script or scraped session needed the way Kimai/ITFlow required.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { createUser, findUserByName, setDisabled, setPassword, signIn } from './jellyfinClient';

export const JELLYFIN_SERVICE = 'jellyfin';
const JELLYFIN_ADMIN_PASSWORD_KEY = 'JELLYFIN_ADMIN_PASSWORD';
// Compose always sets ${JELLYFIN_PORT:-10210}; this only covers a parse miss.
const FALLBACK_PORT = 10210;

export interface JellyfinUserInput {
  email: string;
  password: string;
}

type JellyfinAdminSession =
  | { state: 'signed-in'; baseUrl: string; token: string }
  | { state: 'admin-not-configured' }
  | { state: 'admin-sign-in-failed' };

async function signInAsJellyfinAdmin(): Promise<JellyfinAdminSession> {
  const adminUsername = getAutheliaAdminUser()?.username?.trim();
  const adminPassword = readAppEnvValue(JELLYFIN_SERVICE, JELLYFIN_ADMIN_PASSWORD_KEY);
  if (!adminUsername || !adminPassword) {
    return { state: 'admin-not-configured' };
  }
  const port = getPublishedUpstreamPort(JELLYFIN_SERVICE) ?? FALLBACK_PORT;
  const baseUrl = `http://${await getHostGatewayIp()}:${port}`;
  const token = await signIn(baseUrl, adminUsername, adminPassword);
  if (!token) {
    return { state: 'admin-sign-in-failed' };
  }
  return { state: 'signed-in', baseUrl, token };
}

export type ProvisionJellyfinUserResult =
  | 'created'
  | 'updated'
  | 'failed'
  | 'admin-not-configured'
  | 'admin-sign-in-failed';

export async function provisionJellyfinUser(input: JellyfinUserInput): Promise<ProvisionJellyfinUserResult> {
  const session = await signInAsJellyfinAdmin();
  if (session.state === 'admin-not-configured') {
    logger.warn('Jellyfin user provisioning skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }
  if (session.state === 'admin-sign-in-failed') {
    logger.warn('Jellyfin user provisioning skipped: could not sign in as the tracked admin');
    return 'admin-sign-in-failed';
  }
  const { baseUrl, token } = session;

  const existingId = await findUserByName(baseUrl, token, input.email);
  if (existingId) {
    const passwordSet = await setPassword(baseUrl, token, existingId, input.password);
    if (!passwordSet) {
      logger.error(`Jellyfin user provisioning failed to update the password for ${input.email}`);
      return 'failed';
    }
    // A re-grant after a prior revoke should work again, not stay locked out.
    await setDisabled(baseUrl, token, existingId, false);
    logger.info(`Updated the existing Jellyfin account's password for ${input.email}`);
    return 'updated';
  }

  const createdId = await createUser(baseUrl, token, input.email, input.password);
  if (!createdId) {
    logger.error(`Jellyfin user provisioning failed for ${input.email}`);
    return 'failed';
  }
  logger.info(`Created a Jellyfin account for ${input.email}`);
  return 'created';
}

export type DisableJellyfinUserResult =
  | 'disabled'
  | 'not-found'
  | 'failed'
  | 'admin-not-configured'
  | 'admin-sign-in-failed';

export async function disableJellyfinUser(email: string): Promise<DisableJellyfinUserResult> {
  const session = await signInAsJellyfinAdmin();
  if (session.state === 'admin-not-configured') {
    logger.warn('Jellyfin user disable skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }
  if (session.state === 'admin-sign-in-failed') {
    logger.warn('Jellyfin user disable skipped: could not sign in as the tracked admin');
    return 'admin-sign-in-failed';
  }
  const { baseUrl, token } = session;

  const userId = await findUserByName(baseUrl, token, email);
  if (!userId) {
    logger.warn(`No Jellyfin account found for ${email} to disable`);
    return 'not-found';
  }
  const disabled = await setDisabled(baseUrl, token, userId, true);
  if (!disabled) {
    logger.error(`Failed to disable the Jellyfin account for ${email}`);
    return 'failed';
  }
  logger.info(`Disabled the Jellyfin account for ${email}`);
  return 'disabled';
}
