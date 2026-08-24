'use strict';

const { query } = require('./database');

const RECOVERY_MODE_KEY = 'recovery_mode_enabled';

async function isRecoveryModeEnabled() {
  const result = await query('SELECT value FROM settings WHERE key = $1', [RECOVERY_MODE_KEY]);
  return result.rows[0]?.value === 'true';
}

async function setRecoveryMode(enabled) {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [RECOVERY_MODE_KEY, enabled ? 'true' : 'false']
  );
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
