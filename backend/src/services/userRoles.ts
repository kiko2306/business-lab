/**
 * Read/write helpers for the `user_roles` join table (plan.md §149). Kept
 * apart from the route handlers so the auth middleware, the users API and the
 * recover-admin script all reach for the same two functions.
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../utils/database';
import { Capability, Role } from '../auth/capabilities';

/** A user's roles, ascending, e.g. `['admin', 'webmaster']`. */
export async function getUserRoles(userId: number): Promise<Role[]> {
  const result = await query<{ role: Role }>(
    'SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role ASC',
    [userId]
  );
  return result.rows.map((row) => row.role);
}

/** Roles for several users at once — `{ [userId]: Role[] }`. */
export async function getRolesForUsers(userIds: number[]): Promise<Record<number, Role[]>> {
  const out: Record<number, Role[]> = {};
  for (const id of userIds) {
    out[id] = [];
  }
  if (userIds.length === 0) {
    return out;
  }
  const result = await query<{ user_id: number; role: Role }>(
    'SELECT user_id, role FROM user_roles WHERE user_id = ANY($1::int[]) ORDER BY role ASC',
    [userIds]
  );
  for (const row of result.rows) {
    (out[row.user_id] ??= []).push(row.role);
  }
  return out;
}

/**
 * Replace a user's roles wholesale, in one transaction. `roles` is trusted to
 * be a validated, non-empty, deduplicated set of known role names.
 */
export async function setUserRoles(userId: number, roles: Role[]): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const role of roles) {
      await client.query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, role]
      );
    }
  });
}

/** How many accounts currently hold `webmaster` — used to block removing the last one. */
export async function webmasterCount(): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM user_roles WHERE role = 'webmaster'"
  );
  return result.rows[0]?.count ?? 0;
}

/**
 * A single admin account's per-feature grant rows (plan.md §152). Empty means
 * "all-on" — see `effectiveCapabilities`. Meaningless for a `webmaster` (never
 * consulted) or a `user` (no capabilities).
 */
export async function getUserCapabilities(userId: number): Promise<Capability[]> {
  const result = await query<{ capability: Capability }>(
    'SELECT capability FROM user_capabilities WHERE user_id = $1 ORDER BY capability ASC',
    [userId]
  );
  return result.rows.map((row) => row.capability);
}

/** Grant rows for several users at once — `{ [userId]: Capability[] }`. */
export async function getCapabilitiesForUsers(
  userIds: number[]
): Promise<Record<number, Capability[]>> {
  const out: Record<number, Capability[]> = {};
  for (const id of userIds) {
    out[id] = [];
  }
  if (userIds.length === 0) {
    return out;
  }
  const result = await query<{ user_id: number; capability: Capability }>(
    'SELECT user_id, capability FROM user_capabilities WHERE user_id = ANY($1::int[]) ORDER BY capability ASC',
    [userIds]
  );
  for (const row of result.rows) {
    (out[row.user_id] ??= []).push(row.capability);
  }
  return out;
}

/**
 * Replace an account's feature grants wholesale, in one transaction.
 * `capabilities` is trusted to be a validated, deduplicated set of known
 * capability names.
 */
export async function setUserCapabilities(userId: number, capabilities: Capability[]): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM user_capabilities WHERE user_id = $1', [userId]);
    for (const capability of capabilities) {
      await client.query(
        'INSERT INTO user_capabilities (user_id, capability) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, capability]
      );
    }
  });
}
