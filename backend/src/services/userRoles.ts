/**
 * Read/write helpers for the `user_roles` join table (plan.md §149). Kept
 * apart from the route handlers so the auth middleware, the users API and the
 * recover-admin script all reach for the same two functions.
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../utils/database';
import { Role } from '../auth/capabilities';

/** A user's roles, ascending, e.g. `['it_admin', 'webmaster']`. */
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

/** How many accounts currently hold `owner` — used to block removing the last one. */
export async function ownerCount(): Promise<number> {
  const result = await query<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM user_roles WHERE role = 'owner'"
  );
  return result.rows[0]?.count ?? 0;
}
