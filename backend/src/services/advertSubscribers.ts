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

export interface SubscriberRow {
  id: number;
  email: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

/** Everyone on the list for the dashboard (plan.md §847) — never the unsubscribe token, which is the person's own key. */
export async function listAllSubscribers(): Promise<SubscriberRow[]> {
  const result = await query<{ id: number; email: string; subscribed_at: Date; unsubscribed_at: Date | null }>(
    'SELECT id, email, subscribed_at, unsubscribed_at FROM advert_subscribers ORDER BY email'
  );
  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    subscribedAt: new Date(r.subscribed_at).toISOString(),
    unsubscribedAt: r.unsubscribed_at ? new Date(r.unsubscribed_at).toISOString() : null,
  }));
}

/**
 * Adds an address by hand. Unlike the public form's `subscribe()`, it never
 * clears an opt-out: someone who unsubscribed said no, and only they can say
 * yes again (through the public form).
 */
export async function addSubscriber(email: string): Promise<'added' | 'exists' | 'unsubscribed'> {
  const token = crypto.randomBytes(32).toString('base64url');
  const inserted = await query<{ id: number }>(
    `INSERT INTO advert_subscribers (email, unsubscribe_token)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [email, token]
  );
  if (inserted.rows.length) {
    return 'added';
  }
  const existing = await query<{ unsubscribed_at: Date | null }>(
    'SELECT unsubscribed_at FROM advert_subscribers WHERE email = $1',
    [email]
  );
  return existing.rows[0]?.unsubscribed_at ? 'unsubscribed' : 'exists';
}

/** Deletes the row outright — the address is gone, not just opted out. False when it was already gone. */
export async function removeSubscriber(id: number): Promise<boolean> {
  const result = await query<{ id: number }>('DELETE FROM advert_subscribers WHERE id = $1 RETURNING id', [id]);
  return result.rows.length > 0;
}
