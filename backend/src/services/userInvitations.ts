/**
 * Set-password invitations for dashboard-created accounts (plan.md §158).
 *
 * A new account is created with no `password_hash` (inactive). This mints a
 * single-use token, emails a link, and turns the account active when the
 * invitee sets a password. Only the SHA-256 hash of the token is stored, so a
 * database leak doesn't hand over live links; the plaintext is returned once,
 * to the caller that builds the URL.
 */

import crypto from 'crypto';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../utils/database';

/** 72 hours (plan.md §158.5). */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

export interface InvitationTarget {
  userId: number;
  username: string;
  email: string | null;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Replace any outstanding invitation for a user with a fresh one. Returns the
 * plaintext token — store nothing else, hand it straight into the link.
 */
export async function createInvitation(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await withTransaction(async (client: PoolClient) => {
    await client.query('DELETE FROM user_invitations WHERE user_id = $1 AND accepted_at IS NULL', [userId]);
    await client.query(
      'INSERT INTO user_invitations (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(token), expiresAt]
    );
  });
  return token;
}

/**
 * The account a token belongs to, if the token is unaccepted and unexpired.
 * `null` for anything else (unknown, spent, or timed out).
 */
export async function verifyInvitation(token: string): Promise<InvitationTarget | null> {
  const result = await query<{ user_id: number; username: string; email: string | null }>(
    `SELECT i.user_id, u.username, u.email
     FROM user_invitations i
     JOIN users u ON u.id = i.user_id
     WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()`,
    [hashToken(token)]
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, username: row.username, email: row.email } : null;
}

/**
 * Redeem a token: set the account's password hash, stamp the invitation
 * accepted, and drop that user's other outstanding invitations. Returns the
 * activated account, or `null` if the token was not valid at redeem time (so
 * a race can't set a password twice).
 */
export async function acceptInvitation(
  token: string,
  passwordHash: string
): Promise<{ userId: number; username: string } | null> {
  return withTransaction(async (client: PoolClient) => {
    const claim = await client.query<{ id: number; user_id: number }>(
      `UPDATE user_invitations SET accepted_at = NOW()
       WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > NOW()
       RETURNING id, user_id`,
      [hashToken(token)]
    );
    const row = claim.rows[0];
    if (!row) {
      return null;
    }
    const user = await client.query<{ username: string }>(
      'UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING username',
      [row.user_id, passwordHash]
    );
    await client.query('DELETE FROM user_invitations WHERE user_id = $1 AND id <> $2', [row.user_id, row.id]);
    return { userId: row.user_id, username: user.rows[0].username };
  });
}
