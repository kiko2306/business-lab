'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../utils/database');
const { hashPassword } = require('../utils/password');
const { writeAuditLog } = require('../utils/audit');
const { isRecoveryModeEnabled, isLocalRequest, setRecoveryMode } = require('../utils/recovery');
const { schemas, validateBody } = require('../middleware/validation');

const router = Router();

const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many recovery requests, please try again later.' },
});

router.use(recoveryLimiter);

router.get('/status', async (_req, res) => {
  try {
    return res.json({ enabled: await isRecoveryModeEnabled() });
  } catch {
    return res.status(500).json({ error: 'Unable to read recovery status.' });
  }
});

router.post('/enable', validateBody(schemas.recoveryEnable), async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Recovery mode can only be enabled from localhost.' });
  }

  try {
    await setRecoveryMode(true);
    await writeAuditLog({ action: 'recovery_mode_enable', resource: 'recovery', result: 'success' });
    return res.json({ enabled: true, message: 'Recovery mode enabled.' });
  } catch {
    return res.status(500).json({ error: 'Unable to enable recovery mode.' });
  }
});

router.post('/reset-admin-password', validateBody(schemas.recoveryResetAdminPassword), async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Recovery actions are localhost only.' });
  }

  if (!(await isRecoveryModeEnabled())) {
    return res.status(403).json({ error: 'Recovery mode is not enabled.' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const result = await query(
      `UPDATE users
       SET password_hash = $2, role = 'admin'
       WHERE username = $1
       RETURNING id`,
      [username, passwordHash]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await writeAuditLog({
      userId: result.rows[0].id,
      action: 'recovery_password_reset',
      resource: 'users',
      result: 'success',
    });

    return res.json({ message: 'Admin password reset successfully.' });
  } catch {
    return res.status(500).json({ error: 'Unable to reset admin password.' });
  }
});

router.post('/disable', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'Recovery mode can only be disabled from localhost.' });
  }

  try {
    await setRecoveryMode(false);
    await writeAuditLog({ action: 'recovery_mode_disable', resource: 'recovery', result: 'success' });
    return res.json({ enabled: false, message: 'Recovery mode disabled.' });
  } catch {
    return res.status(500).json({ error: 'Unable to disable recovery mode.' });
  }
});

module.exports = router;
