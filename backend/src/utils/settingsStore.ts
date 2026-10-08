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
import { openSecret, sealSecret } from './totpSecret';

// Third-party credentials: a database dump must not hand these over (plan.md
// §893). Same AES-GCM seal as TOTP secrets, so nothing new to generate or enter.
const SECRET_SETTING_KEYS = new Set([
  'cloudflare_tunnel_token',
  'exposure_npm_password',
  'mail_smtp_password',
  'mail_imap_password',
  'backup_target_password',
  'claude_api_key', // pre-registry Anthropic key; re-wrapped here, read once by ensureAiApiKeyMigration
]);

export function isSecretSettingKey(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key) || key.startsWith('ai_api_key_');
}

// sealSecret's output shape. A plaintext token will not match, which is what
// lets rows written before sealing keep working until sealStoredSecrets runs.
const SEALED_SHAPE = /^v1:[\w-]+:[\w-]+:[\w-]+$/;

/**
 * The plaintext of a stored value. Legacy plaintext rows pass through; a sealed
 * value that will not open (JWT_SECRET rotated) reads as empty, i.e. "not
 * configured", so the operator re-enters it instead of every read throwing.
 */
export function openSettingValue(key: string, value: string): string {
  if (!isSecretSettingKey(key) || !SEALED_SHAPE.test(value)) {
    return value;
  }
  try {
    return openSecret(value);
  } catch {
    return '';
  }
}

/** Re-wrap secrets stored before sealing existed. Idempotent; runs at every boot. */
export async function sealStoredSecrets(): Promise<void> {
  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE value IS NOT NULL AND value <> \'\'');
  for (const { key, value } of rows.rows) {
    if (value && isSecretSettingKey(key) && !SEALED_SHAPE.test(value)) {
      // Guarded on the old value so a concurrent save is never overwritten.
      await query('UPDATE settings SET value = $2 WHERE key = $1 AND value = $3', [key, sealSecret(value), value]);
    }
  }
}

function sealForStorage(key: string, value: string | null): string | null {
  return value && isSecretSettingKey(key) ? sealSecret(value) : value;
}

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
    [keys, keys.map((key) => sealForStorage(key, values[key] ?? null))]
  );
}

export async function setSetting(key: string, value: string | null | undefined): Promise<void> {
  await setSettings({ [key]: value });
}
