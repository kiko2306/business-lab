/**
 * Keeps Authelia's file-backend user database in step with the dashboard's
 * own accounts (plan.md §151 slice 2c). The dashboard owns the file: every
 * managed account with an email becomes an Authelia user, its dashboard
 * password hash copied across verbatim (bcryptjs digests validate against
 * Authelia's file backend — see autheliaUsers.ts), and its group membership
 * derived from the SSO app-access list.
 *
 *   groups =
 *     'admins'                         if the account is a webmaster
 *     'app-<name>'                     one per granted app (every gated app
 *                                      for a webmaster)
 *     <app.autheliaGroups...>          for each granted app that declares them
 *
 * Slice 2d turns the `app-*` groups into `access_control` rules. This module
 * only writes `users_database.yml`; Authelia is configured with
 * `authentication_backend.file.watch: true`, so it reloads the file on its
 * own — no restart.
 *
 * Every write is best-effort at the call site: a failure is audited and
 * surfaced as a warning, never rolled back onto the dashboard-side change.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import logger from '../utils/logger';
import { getAppAccessOptions } from './userAppAccess';
import { getUsersDatabasePath, readUsersDatabase, RawAutheliaUser } from './autheliaUsers';

export interface AutheliaSyncResult {
  synced: boolean;
  count: number;
  reason?: 'authelia-not-installed' | 'no-eligible-users';
}

interface ManagedUserRow {
  username: string;
  email: string | null;
  password_hash: string | null;
  roles: string[] | null;
  app_access: string[] | null;
}

/** `app-<name>`, the synthetic per-app group the dashboard manages. */
export function appGroupName(serviceName: string): string {
  return `app-${serviceName}`;
}

/**
 * Rebuild `users_database.yml` from the `users` table. Returns without
 * writing when Authelia isn't installed, or when the rebuild would produce an
 * empty user list (which would lock every gated app out) — that state means
 * "no dashboard account has an email yet", not "delete everyone".
 */
export async function syncAutheliaUsers(trigger: string): Promise<AutheliaSyncResult> {
  const filePath = getUsersDatabasePath();
  if (!filePath || !fs.existsSync(filePath)) {
    return { synced: false, count: 0, reason: 'authelia-not-installed' };
  }

  const { rows } = await query<ManagedUserRow>(`
    SELECT u.username,
           u.email,
           u.password_hash,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT r.role), NULL)         AS roles,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.service_name), NULL) AS app_access
    FROM users u
    LEFT JOIN user_roles r      ON r.user_id = u.id
    LEFT JOIN user_app_access a ON a.user_id = u.id
    GROUP BY u.id, u.username, u.email, u.password_hash
  `);

  const options = await getAppAccessOptions();
  const everyAppGroup = options.map((o) => appGroupName(o.serviceName));
  const declaredGroups = new Map(options.map((o) => [o.serviceName, o.requiredGroups]));

  // Keep any display name a human already set on an existing entry.
  const existing = readUsersDatabase(filePath).data.users ?? {};

  const entries: Record<string, RawAutheliaUser> = {};
  for (const row of rows) {
    if (!row.email || !row.password_hash) {
      continue;
    }
    const roles = row.roles ?? [];
    const grantedApps = row.app_access ?? [];
    const isWebmaster = roles.includes('webmaster');

    const groups = new Set<string>();
    if (isWebmaster) {
      groups.add('admins');
      for (const group of everyAppGroup) {
        groups.add(group);
      }
    }
    for (const serviceName of grantedApps) {
      groups.add(appGroupName(serviceName));
      for (const declared of declaredGroups.get(serviceName) ?? []) {
        groups.add(declared);
      }
    }

    entries[row.username] = {
      disabled: false,
      displayname: existing[row.username]?.displayname || row.username,
      password: row.password_hash,
      email: row.email,
      groups: [...groups].sort(),
    };
  }

  if (Object.keys(entries).length === 0) {
    logger.warn(
      `Authelia sync (${trigger}): skipped — no dashboard account has an email yet, leaving users_database.yml untouched`
    );
    return { synced: false, count: 0, reason: 'no-eligible-users' };
  }

  const preamble = readUsersDatabase(filePath).preamble;
  const body = yaml.dump({ users: entries }, { lineWidth: -1 });
  fs.writeFileSync(filePath, `${preamble}${body}`, { mode: 0o640 });

  logger.info(`Authelia sync (${trigger}): wrote ${Object.keys(entries).length} user(s) to users_database.yml`);
  return { synced: true, count: Object.keys(entries).length };
}

/**
 * Fire-and-forget wrapper for the user-management routes: never throws, audits
 * a failure, and hands back a short warning string when the sync didn't land
 * so the caller can pass it through in the response.
 */
export async function syncAutheliaUsersSafe(trigger: string, userId: number | null): Promise<string | null> {
  try {
    const result = await syncAutheliaUsers(trigger);
    if (result.synced) {
      return null;
    }
    if (result.reason === 'authelia-not-installed') {
      return null; // Authelia isn't set up — nothing to keep in sync.
    }
    return 'Authelia was not updated: no dashboard account has an email address yet.';
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Authelia sync (${trigger}) failed: ${message}`);
    await writeAuditLog({
      userId,
      action: 'authelia_users_sync',
      resource: trigger,
      result: 'failure',
      metadata: { error: message },
    }).catch(() => {});
    return 'The account was saved, but updating Authelia failed — check the server logs.';
  }
}
