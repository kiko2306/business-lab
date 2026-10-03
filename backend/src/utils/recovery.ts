import { Request } from 'express';
import { query } from './database';
import { setSetting } from './settingsStore';

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
  await setSetting(RECOVERY_MODE_KEY, enabled ? 'true' : 'false');
  cacheValue = enabled;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

/**
 * What GET /recovery/status tells the page. `available` is whether this caller
 * can use the HTTP endpoints at all: they gate on a loopback address, which with
 * the backend in a container only a request from inside it has, so the page can
 * say so instead of answering 403 to a locked-out person (plan.md §829).
 */
export function recoveryStatusBody(enabled: boolean, req: Request): { enabled: boolean; available: boolean } {
  return { enabled, available: isLocalRequest(req) };
}

export function isLocalRequest(req: Request): boolean {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
