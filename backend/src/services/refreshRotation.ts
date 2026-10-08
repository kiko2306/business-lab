import { query } from '../utils/database';

/**
 * A just-spent refresh token replayed inside this window is two tabs (or a
 * retried request) racing one token, not theft: refuse it, keep the session.
 * The frontend already serialises refreshes within one tab, so only a second
 * tab or a dropped response can land here.
 */
export const REUSE_GRACE_MS = 30_000;

export type ClaimResult =
  | { ok: true; userId: number; username: string }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'reuse-grace' | 'reuse-compromise'; userId: number };

/**
 * Spend a refresh token. One UPDATE both checks it is live and marks it
 * spent, so two concurrent refreshes cannot both win. A token that was
 * spent earlier and comes back after the grace window is treated as stolen
 * (the thief or the owner holds a stale copy): every session of that user is
 * revoked, which is the whole point of rotating — a copied token stops being
 * a 7-day session the first time either party refreshes.
 */
export async function claimRefreshToken(token: string): Promise<ClaimResult> {
  const claimed = await query<{ user_id: number; username: string }>(
    `UPDATE refresh_tokens rt SET rotated_at = NOW()
       FROM users u
      WHERE rt.token = $1 AND u.id = rt.user_id
        AND NOT rt.revoked AND rt.rotated_at IS NULL AND rt.expires_at > NOW()
      RETURNING rt.user_id, u.username`,
    [token]
  );
  if (claimed.rows[0]) return { ok: true, userId: claimed.rows[0].user_id, username: claimed.rows[0].username };

  const found = await query<{
    user_id: number;
    revoked: boolean;
    rotated_at: Date | null;
    expired: boolean;
    age_ms: number | null;
  }>(
    `SELECT user_id, revoked, rotated_at, expires_at < NOW() AS expired,
            EXTRACT(EPOCH FROM (NOW() - rotated_at)) * 1000 AS age_ms
       FROM refresh_tokens WHERE token = $1`,
    [token]
  );
  const row = found.rows[0];
  if (!row || row.revoked || row.expired || !row.rotated_at) return { ok: false, reason: 'invalid' };

  if (Number(row.age_ms) <= REUSE_GRACE_MS) return { ok: false, reason: 'reuse-grace', userId: row.user_id };

  await query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [row.user_id]);
  return { ok: false, reason: 'reuse-compromise', userId: row.user_id };
}
