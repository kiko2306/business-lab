/**
 * The one way to write the `settings` key/value table.
 *
 * This upsert used to be copied out in ~20 places, three of them as a
 * `for (const [key, value] of Object.entries(values)) await query(...)` loop in
 * routes/settings.ts — and those loops are not atomic: a failure partway
 * through left the exposure, mail or backup-target config half-written while
 * the route answered 500, so the dashboard showed settings the box wasn't
 * actually running on. One multi-row statement can't land half-applied.
 */
import { query } from './database';

/**
 * Write several keys at once. `undefined` stores NULL, which is what the
 * per-key `query(..., [key, value])` calls did with a missing body field.
 */
export async function setSettings(values: Record<string, string | null | undefined>): Promise<void> {
  const keys = Object.keys(values);
  if (keys.length === 0) {
    return;
  }
  await query(
    `INSERT INTO settings (key, value, updated_at)
     SELECT k, v, NOW() FROM UNNEST($1::text[], $2::text[]) AS t(k, v)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [keys, keys.map((key) => values[key] ?? null)]
  );
}

export async function setSetting(key: string, value: string | null | undefined): Promise<void> {
  await setSettings({ [key]: value });
}
