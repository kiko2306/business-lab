/**
 * Recipient list for the social-drafts email advert (plan.md §611/§612): a
 * dashboard-DB table of subscriber emails, keyed for a public subscribe form
 * and an unsubscribe link riding in every sent message's footer.
 */

import crypto from 'crypto';
import { query } from '../utils/database';

export async function ensureAdvertSubscribersTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS advert_subscribers (
        id                SERIAL PRIMARY KEY,
        email             VARCHAR(255) NOT NULL UNIQUE,
        unsubscribe_token TEXT NOT NULL UNIQUE,
        subscribed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unsubscribed_at   TIMESTAMPTZ
    )
  `);
}

/**
 * Subscribes an address, generating its unsubscribe token on first insert
 * only — a repeat subscribe of a previously-unsubscribed address just clears
 * `unsubscribed_at` and keeps its existing token instead of erroring or
 * minting a second one.
 */
export async function subscribe(email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO advert_subscribers (email, unsubscribe_token)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL`,
    [email, token]
  );
}

/**
 * Marks the address behind a token unsubscribed. Always succeeds — hitting
 * an old email's link twice, or a token that never existed, must not error.
 */
export async function unsubscribeByToken(token: string): Promise<void> {
  await query(
    `UPDATE advert_subscribers SET unsubscribed_at = NOW()
     WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL`,
    [token]
  );
}

export interface ActiveSubscriber {
  email: string;
  unsubscribeToken: string;
}

/** Active recipients for the §611 slice-1 sender. */
export async function listActiveSubscribers(): Promise<ActiveSubscriber[]> {
  const result = await query<{ email: string; unsubscribe_token: string }>(
    'SELECT email, unsubscribe_token FROM advert_subscribers WHERE unsubscribed_at IS NULL ORDER BY email'
  );
  return result.rows.map((r) => ({ email: r.email, unsubscribeToken: r.unsubscribe_token }));
}
