import type { Pool, PoolClient } from 'pg';

/** Shared by every route that parses agent- or guest-submitted rows. */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
export const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
/** Wintouch sends 1900-01-01 for "unknown"; storing it as a real date implies knowledge. */
export const date = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const iso = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso !== '1900-01-01' ? iso : null;
};

export async function inTransaction(
  pool: Pool,
  work: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await work(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
