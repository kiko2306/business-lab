/**
 * The per-user SSO app-access allowlist (plan.md §151). A row in
 * `user_app_access` says "this account may reach this managed app through
 * Authelia". No rows means no SSO app access.
 *
 * The set of apps that can be granted is derived, not configured: an app
 * appears here whenever it is publicly exposed *and* Authelia-protected (see
 * isAutheliaProtectionRequired in config/services.ts). That excludes Home
 * Page and Authelia itself (deliberately public / can't gate its own login),
 * and any app flagged `skipAutheliaProtection` because it can't hide its own
 * login form — those are exposed directly with only the app's own login, so
 * there is no per-user Authelia access to grant (§342). Slices 2c/2d turn
 * these rows into Authelia group membership and access-control rules; this
 * module just reads and writes them.
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../utils/database';
import { getService, isAutheliaProtectionRequired } from '../config/services';
import { getNoSsoCredentialAppNames } from './noSsoCredentialFanout';

export interface AppAccessOption {
  serviceName: string;
  label: string;
  hostname: string | null;
  /** Named Authelia groups the app's rule needs beyond the synthetic `app-<name>` one. */
  requiredGroups: string[];
}

/**
 * Exposed services, filtered by `matches` and shaped into `AppAccessOption`s.
 * Secondary exposure rows (`<app>:api`, `<app>:relay`, `homepage:apex` —
 * anything with a colon) are exposure legs of an app, not apps you grant
 * access to, and their `<name>` breaks both the `appAccess` pattern check
 * and `app-<name>` group naming — so they're filtered out here, before
 * `matches` ever sees them.
 */
async function getExposedServiceOptions(matches: (serviceName: string) => boolean): Promise<AppAccessOption[]> {
  const result = await query<{ service_name: string; hostname: string | null }>(
    `SELECT service_name, hostname
     FROM service_exposure
     WHERE enabled = TRUE AND service_name NOT LIKE '%:%'`
  );
  return result.rows
    .filter((row) => matches(row.service_name))
    .map((row) => {
      const service = getService(row.service_name);
      return {
        serviceName: row.service_name,
        label: service?.label ?? row.service_name,
        hostname: row.hostname,
        requiredGroups: service?.autheliaGroups ?? [],
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The apps that can currently be granted Authelia SSO access — exposed,
 * excluding Home Page and Authelia (see the module doc comment). Ordered by
 * label for a stable picker. Authelia's own group/access_control/OIDC-client
 * generation (autheliaSync.ts, autheliaAccessControl.ts,
 * autheliaOidcClients.ts) calls this directly, not `getGrantableAppOptions`
 * below — a no-SSO app must never pick up an Authelia group or
 * access_control rule (§342: expose-direct or hide-the-form, never both).
 */
export async function getAppAccessOptions(): Promise<AppAccessOption[]> {
  return getExposedServiceOptions(isAutheliaProtectionRequired);
}

/** Just the Authelia-grantable service names, for the group/rule generators. */
export async function getAppAccessOptionNames(): Promise<Set<string>> {
  const options = await getAppAccessOptions();
  return new Set(options.map((option) => option.serviceName));
}

/**
 * Every app a dashboard user can be granted access to — Authelia-gated apps
 * plus the no-SSO apps that have a credential-fanout provisioner (§480,
 * §481). This is what the Users & Roles picker and grant validation use;
 * Authelia's own generators deliberately keep using `getAppAccessOptions`
 * above instead (see its doc comment).
 */
export async function getGrantableAppOptions(): Promise<AppAccessOption[]> {
  const noSsoNames = new Set(getNoSsoCredentialAppNames());
  return getExposedServiceOptions((name) => isAutheliaProtectionRequired(name) || noSsoNames.has(name));
}

/** Every grantable service name (Authelia + no-SSO), for validating a submitted access list. */
export async function getGrantableAppOptionNames(): Promise<Set<string>> {
  const options = await getGrantableAppOptions();
  return new Set(options.map((option) => option.serviceName));
}

/** One account's granted app names, ascending. */
export async function getUserAppAccess(userId: number): Promise<string[]> {
  const result = await query<{ service_name: string }>(
    'SELECT service_name FROM user_app_access WHERE user_id = $1 ORDER BY service_name ASC',
    [userId]
  );
  return result.rows.map((row) => row.service_name);
}

/** Granted app names for several users at once — `{ [userId]: string[] }`. */
export async function getAppAccessForUsers(userIds: number[]): Promise<Record<number, string[]>> {
  const out: Record<number, string[]> = {};
  for (const id of userIds) {
    out[id] = [];
  }
  if (userIds.length === 0) {
    return out;
  }
  const result = await query<{ user_id: number; service_name: string }>(
    'SELECT user_id, service_name FROM user_app_access WHERE user_id = ANY($1::int[]) ORDER BY service_name ASC',
    [userIds]
  );
  for (const row of result.rows) {
    (out[row.user_id] ??= []).push(row.service_name);
  }
  return out;
}

export interface AppAccessDiff {
  added: string[];
  removed: string[];
}

/**
 * Replace an account's app-access list, in one transaction — a real diff
 * against the current rows (not a blanket delete+reinsert), so an app that
 * stays granted keeps its row, and with it, any `pending_fanout` marker
 * (§493) untouched. `serviceNames` is trusted to be a validated,
 * deduplicated set of currently grantable app names.
 *
 * `markAddedPending`: set on a newly-granted no-SSO app's row when the
 * caller already knows this account has a dashboard password (so a fan-out
 * is owed but can't happen right now — see the schema comment in
 * database.ts). Never set on an Authelia-gated app's row; that access
 * takes effect through the group sync, not a queued fan-out.
 */
export async function setUserAppAccess(
  userId: number,
  serviceNames: string[],
  opts: { markAddedPending?: boolean } = {}
): Promise<AppAccessDiff> {
  const noSsoNames = new Set(getNoSsoCredentialAppNames());
  return withTransaction(async (client: PoolClient) => {
    const current = await client.query<{ service_name: string }>(
      'SELECT service_name FROM user_app_access WHERE user_id = $1',
      [userId]
    );
    const currentSet = new Set(current.rows.map((row) => row.service_name));
    const nextSet = new Set(serviceNames);
    const added = serviceNames.filter((name) => !currentSet.has(name));
    const removed = [...currentSet].filter((name) => !nextSet.has(name));

    for (const serviceName of removed) {
      await client.query('DELETE FROM user_app_access WHERE user_id = $1 AND service_name = $2', [userId, serviceName]);
    }
    for (const serviceName of added) {
      const pending = Boolean(opts.markAddedPending) && noSsoNames.has(serviceName);
      await client.query(
        'INSERT INTO user_app_access (user_id, service_name, pending_fanout) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [userId, serviceName, pending]
      );
    }
    return { added, removed };
  });
}

/** No-SSO apps still owed a fan-out to this user's next login (§493). */
export async function getPendingNoSsoFanoutApps(userId: number): Promise<string[]> {
  const noSsoNames = getNoSsoCredentialAppNames();
  if (noSsoNames.length === 0) {
    return [];
  }
  const result = await query<{ service_name: string }>(
    'SELECT service_name FROM user_app_access WHERE user_id = $1 AND pending_fanout = TRUE AND service_name = ANY($2::text[])',
    [userId, noSsoNames]
  );
  return result.rows.map((row) => row.service_name);
}

/** Clear the pending-fanout marker after a fan-out attempt, successful or not (§493) — never retried more than once per login. */
export async function clearPendingNoSsoFanout(userId: number, serviceNames: string[]): Promise<void> {
  if (serviceNames.length === 0) {
    return;
  }
  await query('UPDATE user_app_access SET pending_fanout = FALSE WHERE user_id = $1 AND service_name = ANY($2::text[])', [
    userId,
    serviceNames,
  ]);
}
