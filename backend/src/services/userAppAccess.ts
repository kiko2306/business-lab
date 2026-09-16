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

/**
 * Replace an account's app-access list wholesale, in one transaction.
 * `serviceNames` is trusted to be a validated, deduplicated set of currently
 * grantable app names.
 */
export async function setUserAppAccess(userId: number, serviceNames: string[]): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM user_app_access WHERE user_id = $1', [userId]);
    for (const serviceName of serviceNames) {
      await client.query(
        'INSERT INTO user_app_access (user_id, service_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, serviceName]
      );
    }
  });
}
