import { Request } from 'express';
import { query } from './database';

export const RECOVERY_MODE_KEY = 'recovery_mode_enabled';
const CACHE_TTL_MS = 10000;
let cacheValue = false;
let cacheExpiresAt = 0;

export async function isRecoveryModeEnabled(): Promise<boolean> {
  if (Date.now() < cacheExpiresAt) {
    return cacheValue;
  }

  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [RECOVERY_MODE_KEY]);
  cacheValue = result.rows[0]?.value === 'true';
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cacheValue;
}

export async function setRecoveryMode(enabled: boolean): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [RECOVERY_MODE_KEY, enabled ? 'true' : 'false']
  );
  cacheValue = enabled;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

export function isLocalRequest(req: Request): boolean {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
