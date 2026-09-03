/**
 * The per-user SSO app-access allowlist (plan.md §151). A row in
 * `user_app_access` says "this account may reach this managed app through
 * Authelia". No rows means no SSO app access.
 *
 * The set of apps that can be granted is derived, not configured: an app
 * appears only while it is both publicly exposed and Authelia-protected
 * (its live `service_exposure` row). Authelia itself is never in the list —
 * it cannot forward-auth-gate its own login. Slices 2c/2d turn these rows
 * into Authelia group membership and access-control rules; this module just
 * reads and writes them.
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../utils/database';
import { getService } from '../config/services';

export interface AppAccessOption {
  serviceName: string;
  label: string;
  hostname: string | null;
  /** Named Authelia groups the app's rule needs beyond the synthetic `app-<name>` one. */
  requiredGroups: string[];
}

/**
 * The apps that can currently be granted — exposed and Authelia-protected,
 * Authelia excluded. Ordered by label for a stable picker.
 */
export async function getAppAccessOptions(): Promise<AppAccessOption[]> {
  const result = await query<{ service_name: string; hostname: string | null }>(
    `SELECT service_name, hostname
     FROM service_exposure
     WHERE enabled = TRUE AND authelia_protected = TRUE AND service_name <> 'authelia'`
  );
  return result.rows
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

/** Just the grantable service names, for validating a submitted access list. */
export async function getAppAccessOptionNames(): Promise<Set<string>> {
  const options = await getAppAccessOptions();
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
