/**
 * Create/update a Home Assistant account for a dashboard user, matching
 * their own email/password rather than a per-app generated secret (§480
 * fan-out).
 *
 * HA's multi-user model is real (a `User` plus a `homeassistant`-provider
 * `Credentials` row linking a username/password to it — separate concepts,
 * separate WebSocket commands to create), but nothing about it is a REST
 * endpoint: it's the owner-only `config/auth/*` / `config/auth_provider/
 * homeassistant/*` WebSocket commands `homeAssistantClient.ts` now speaks,
 * authenticated the same way HA's own mobile app logs a user in with a
 * plain password (`getAdminAccessToken`, no stored token — see that file's
 * doc comment).
 *
 * `config/auth/list` already returns each user's linked `homeassistant`
 * username (`_user_info()` in HA's own `config/auth.py`), so looking up an
 * existing fanned-out account by email needs no separate index — the
 * email doubles as the HA username, same choice as Kimai's (§497): HA has
 * no separate "log in with email" fallback the way Kimai does, so the
 * username IS the identifier used to find/create/update.
 *
 * Every fanned-out user gets HA's built-in `system-users` group
 * (`GROUP_ID_USER`, `homeassistant/auth/const.py`) — not `system-admin` —
 * same "a working login, not a bigger grant" reasoning as ITFlow's
 * Technician role and Kimai's `ROLE_USER`.
 *
 * `disableHomeAssistantUser` (§493's disable-not-delete shape) flips
 * `is_active: false` via `config/auth/update` — HA's own login rejects an
 * inactive user, and re-granting flips it back (plus refreshes the
 * password) via the same `provisionHomeAssistantUser` call.
 */

import logger from '../utils/logger';
import { HA_ADMIN_PASSWORD_KEY, HA_SERVICE, resolveHaBaseUrl } from './homeAssistantAdminBootstrap';
import { getAdminAccessToken, runHaWsCommand } from './homeAssistantClient';
import type { HaUserInfo } from './homeAssistantClient';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';

const HA_GROUP_USER = 'system-users';

export interface HaUserInput {
  email: string;
  password: string;
  displayName?: string;
}

type HaAdminSession = { state: 'signed-in'; baseUrl: string; accessToken: string } | { state: 'admin-not-configured' } | { state: 'admin-sign-in-failed' };

async function signInAsHaAdmin(): Promise<HaAdminSession> {
  const username = getAutheliaAdminUser()?.username?.trim();
  const password = readAppEnvValue(HA_SERVICE, HA_ADMIN_PASSWORD_KEY);
  if (!username || !password) {
    return { state: 'admin-not-configured' };
  }
  const baseUrl = await resolveHaBaseUrl();
  const token = await getAdminAccessToken(baseUrl, username, password);
  if (token.state !== 'ok') {
    return { state: 'admin-sign-in-failed' };
  }
  return { state: 'signed-in', baseUrl, accessToken: token.accessToken };
}

async function findHaUser(baseUrl: string, accessToken: string, email: string): Promise<HaUserInfo[] | null> {
  const list = await runHaWsCommand(baseUrl, accessToken, { type: 'config/auth/list' });
  return list.success ? (list.result as HaUserInfo[]) : null;
}

export type ProvisionHaUserResult = 'created' | 'updated' | 'failed' | 'admin-not-configured' | 'admin-sign-in-failed';

export async function provisionHomeAssistantUser(input: HaUserInput): Promise<ProvisionHaUserResult> {
  const session = await signInAsHaAdmin();
  if (session.state === 'admin-not-configured') {
    logger.warn('Home Assistant user provisioning skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }
  if (session.state === 'admin-sign-in-failed') {
    logger.warn('Home Assistant user provisioning skipped: could not sign in as the tracked owner');
    return 'admin-sign-in-failed';
  }
  const { baseUrl, accessToken } = session;

  const users = await findHaUser(baseUrl, accessToken, input.email);
  if (users === null) {
    logger.error(`Home Assistant user provisioning failed for ${input.email}: could not list users`);
    return 'failed';
  }
  const existing = users.find((u) => u.username === input.email);

  if (existing) {
    const changed = await runHaWsCommand(baseUrl, accessToken, {
      type: 'config/auth_provider/homeassistant/admin_change_password',
      user_id: existing.id,
      password: input.password,
    });
    if (!changed.success) {
      logger.error(`Home Assistant user provisioning failed for ${input.email}: password update rejected`);
      return 'failed';
    }
    if (!existing.is_active) {
      await runHaWsCommand(baseUrl, accessToken, { type: 'config/auth/update', user_id: existing.id, is_active: true });
    }
    logger.info(`Updated the existing Home Assistant account's password for ${input.email}`);
    return 'updated';
  }

  const created = await runHaWsCommand(baseUrl, accessToken, {
    type: 'config/auth/create',
    name: input.displayName?.trim() || input.email,
    group_ids: [HA_GROUP_USER],
  });
  if (!created.success) {
    logger.error(`Home Assistant user provisioning failed for ${input.email}: could not create the user`);
    return 'failed';
  }
  const userId = (created.result as { user: HaUserInfo }).user.id;

  const attached = await runHaWsCommand(baseUrl, accessToken, {
    type: 'config/auth_provider/homeassistant/create',
    user_id: userId,
    username: input.email,
    password: input.password,
  });
  if (!attached.success) {
    logger.error(`Home Assistant user provisioning failed for ${input.email}: could not attach credentials`);
    return 'failed';
  }
  logger.info(`Created a Home Assistant account for ${input.email}`);
  return 'created';
}

export type DisableHaUserResult = 'disabled' | 'not-found' | 'failed' | 'admin-not-configured' | 'admin-sign-in-failed';

export async function disableHomeAssistantUser(email: string): Promise<DisableHaUserResult> {
  const session = await signInAsHaAdmin();
  if (session.state === 'admin-not-configured') {
    logger.warn('Home Assistant user disable skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }
  if (session.state === 'admin-sign-in-failed') {
    logger.warn('Home Assistant user disable skipped: could not sign in as the tracked owner');
    return 'admin-sign-in-failed';
  }
  const { baseUrl, accessToken } = session;

  const users = await findHaUser(baseUrl, accessToken, email);
  if (users === null) {
    logger.error(`Home Assistant user disable failed for ${email}: could not list users`);
    return 'failed';
  }
  const existing = users.find((u) => u.username === email);
  if (!existing) {
    logger.warn(`No Home Assistant account found for ${email} to disable`);
    return 'not-found';
  }

  const updated = await runHaWsCommand(baseUrl, accessToken, { type: 'config/auth/update', user_id: existing.id, is_active: false });
  if (!updated.success) {
    logger.error(`Home Assistant user disable failed for ${email}`);
    return 'failed';
  }
  logger.info(`Disabled the Home Assistant account for ${email}`);
  return 'disabled';
}
