/**
 * Keeps Guacamole's own account list in step with the dashboard's users
 * (plan.md §200 slice 3) — mirrors autheliaSync.ts's shape, over REST instead
 * of a rewritten file: every active dashboard user with `app-guacamole`
 * granted (or webmaster) gets a Guacamole account, created if missing and
 * enabled if it was disabled; every Guacamole account this sync owns but
 * that's no longer wanted gets **disabled, never deleted** — so a re-grant
 * later doesn't lose whatever connections/permissions were manually set up
 * for it in Guacamole's own UI (§200's own scope line: this client never
 * touches those).
 *
 * "Active" mirrors autheliaSync.ts's test: `email` + `password_hash` both
 * set, not a separate status column, so it can't drift from what Authelia
 * itself already considers a real account.
 *
 * `guacadmin` is never touched by this sync, in either direction — disabling
 * it would lock out the one account this REST client authenticates as.
 *
 * A newly created account's password is a throwaway random value nobody is
 * ever told: until slice 4's `guacamole-auth-header` extension is wired,
 * these accounts can't usefully log in to Guacamole directly (matching
 * plan.md §200's note that the password field becomes irrelevant once that
 * extension is active) — this slice only prepares the account for it.
 *
 * Every write is best-effort at the call site, same contract as
 * `syncAutheliaUsersSafe`: a failure is audited and surfaced as a warning,
 * never rolled back onto the dashboard-side change.
 */

import crypto from 'crypto';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import {
  guacamoleCreateUser,
  guacamoleListUsers,
  guacamoleLogin,
  guacamoleLogout,
  guacamoleSetUserDisabled,
  GuacamoleSession,
} from './guacamoleClient';
import { GUACAMOLE_SERVICE, GUACAMOLE_ADMIN_USERNAME, GUACAMOLE_ADMIN_PASSWORD_KEY, resolveGuacamoleBaseUrl } from './guacamoleAdminRotate';

export interface GuacamoleSyncResult {
  synced: boolean;
  created: number;
  enabled: number;
  disabled: number;
  reason?: 'guacamole-not-installed' | 'admin-not-rotated' | 'unreachable';
}

interface ManagedUserRow {
  username: string;
  email: string | null;
  password_hash: string | null;
  roles: string[] | null;
  has_guacamole_access: boolean;
}

async function loadWantedUsernames(): Promise<Set<string>> {
  const { rows } = await query<ManagedUserRow>(`
    SELECT u.username,
           u.email,
           u.password_hash,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.role), NULL) AS roles,
           BOOL_OR(a.service_name = '${GUACAMOLE_SERVICE}')  AS has_guacamole_access
    FROM users u
    LEFT JOIN user_roles r      ON r.user_id = u.id
    LEFT JOIN user_app_access a ON a.user_id = u.id
    GROUP BY u.id, u.username, u.email, u.password_hash
  `);

  const wanted = new Set<string>();
  for (const row of rows) {
    if (!row.email || !row.password_hash) {
      continue;
    }
    const isWebmaster = (row.roles ?? []).includes('webmaster');
    if (isWebmaster || row.has_guacamole_access) {
      wanted.add(row.username);
    }
  }
  return wanted;
}

async function reconcileUser(
  baseUrl: string,
  session: GuacamoleSession,
  username: string,
  wanted: boolean,
  existing: Record<string, { disabled: boolean }>,
  result: GuacamoleSyncResult
): Promise<void> {
  const current = existing[username];

  if (wanted) {
    if (!current) {
      await guacamoleCreateUser(baseUrl, session, username, crypto.randomBytes(32).toString('hex'));
      result.created += 1;
      return;
    }
    if (current.disabled) {
      await guacamoleSetUserDisabled(baseUrl, session, username, false);
      result.enabled += 1;
    }
    return;
  }

  if (current && !current.disabled) {
    await guacamoleSetUserDisabled(baseUrl, session, username, true);
    result.disabled += 1;
  }
}

/**
 * Rebuild Guacamole's account set from the `users` table. Returns without
 * writing anything when Guacamole isn't installed, its admin password hasn't
 * been rotated yet (§204 — meaning it has never successfully started, so
 * there's no known way to authenticate to it), or it's unreachable right
 * now. Never throws; a per-user REST failure is logged and skipped rather
 * than aborting the whole pass, so one bad account doesn't block the rest.
 */
export async function syncGuacamoleUsers(trigger: string): Promise<GuacamoleSyncResult> {
  const result: GuacamoleSyncResult = { synced: false, created: 0, enabled: 0, disabled: 0 };

  if (!resolveComposeFile(GUACAMOLE_SERVICE)?.composeFile) {
    return { ...result, reason: 'guacamole-not-installed' };
  }

  const adminPassword = readAppEnvValue(GUACAMOLE_SERVICE, GUACAMOLE_ADMIN_PASSWORD_KEY);
  if (!adminPassword) {
    return { ...result, reason: 'admin-not-rotated' };
  }

  const baseUrl = await resolveGuacamoleBaseUrl();
  let session: GuacamoleSession | null;
  try {
    session = await guacamoleLogin(baseUrl, GUACAMOLE_ADMIN_USERNAME, adminPassword);
  } catch (error) {
    logger.warn(`Guacamole sync (${trigger}): Guacamole is not reachable`, { error: (error as Error).message });
    return { ...result, reason: 'unreachable' };
  }
  if (!session) {
    // The rotated password no longer works — a human changed it by hand in
    // Guacamole's own UI since. Nothing this sync can do about that.
    logger.warn(`Guacamole sync (${trigger}): the stored admin password was rejected`);
    return { ...result, reason: 'unreachable' };
  }

  try {
    const wanted = await loadWantedUsernames();
    const existing = await guacamoleListUsers(baseUrl, session);

    const usernames = new Set([...wanted, ...Object.keys(existing)]);
    usernames.delete(GUACAMOLE_ADMIN_USERNAME);

    for (const username of usernames) {
      try {
        await reconcileUser(baseUrl, session, username, wanted.has(username), existing, result);
      } catch (error) {
        logger.error(`Guacamole sync (${trigger}): failed to reconcile ${username}`, { error: (error as Error).message });
      }
    }

    result.synced = true;
    logger.info(
      `Guacamole sync (${trigger}): ${result.created} created, ${result.enabled} enabled, ${result.disabled} disabled`
    );
    return result;
  } finally {
    await guacamoleLogout(baseUrl, session);
  }
}

/**
 * Fire-and-forget wrapper for the user-management routes: never throws,
 * audits a failure, and hands back a short warning string when the sync
 * didn't fully land so the caller can pass it through in the response. Same
 * contract as `syncAutheliaUsersSafe`.
 */
export async function syncGuacamoleUsersSafe(trigger: string, userId: number | null): Promise<string | null> {
  try {
    const result = await syncGuacamoleUsers(trigger);
    if (result.synced || result.reason === 'guacamole-not-installed' || result.reason === 'admin-not-rotated') {
      return null;
    }
    return 'The account was saved, but Guacamole could not be reached to keep its accounts in sync.';
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Guacamole sync (${trigger}) failed: ${message}`);
    await writeAuditLog({
      userId,
      action: 'guacamole_users_sync',
      resource: trigger,
      result: 'failure',
      metadata: { error: message },
    }).catch(() => {});
    return 'The account was saved, but updating Guacamole failed — check the server logs.';
  }
}
