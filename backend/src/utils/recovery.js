'use strict';

const { query } = require('./database');

const RECOVERY_MODE_KEY = 'recovery_mode_enabled';
const CACHE_TTL_MS = 10000;
let cacheValue = false;
let cacheExpiresAt = 0;

async function isRecoveryModeEnabled() {
  if (Date.now() < cacheExpiresAt) {
    return cacheValue;
  }

  const result = await query('SELECT value FROM settings WHERE key = $1', [RECOVERY_MODE_KEY]);
  cacheValue = result.rows[0]?.value === 'true';
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cacheValue;
}

async function setRecoveryMode(enabled) {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [RECOVERY_MODE_KEY, enabled ? 'true' : 'false']
  );
  cacheValue = enabled;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
}

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

module.exports = {
  RECOVERY_MODE_KEY,
  isRecoveryModeEnabled,
  isLocalRequest,
  setRecoveryMode,
};
