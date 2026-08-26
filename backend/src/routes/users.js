'use strict';

/**
 * User management API routes.
 * Every account is an administrator — there is no restricted role tier —
 * so any authenticated user may manage any other account.
 */

const { Router } = require('express');
const { query } = require('../utils/database');
const { hashPassword } = require('../utils/password');
const { schemas, validateBody, validateParams } = require('../middleware/validation');
const { writeAuditLog } = require('../utils/audit');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/users — list admin accounts
// ---------------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const result = await query(
      'SELECT id, username, created_at FROM users ORDER BY id ASC'
    );
    return res.json({ items: result.rows });
  } catch (error) {
    console.error('List users error:', error.message);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users — create a new admin account
// ---------------------------------------------------------------------------
router.post('/', validateBody(schemas.userCreate), async (req, res) => {
  const { username, password } = req.body;

  try {
    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (username, password_hash, is_setup_complete)
       VALUES ($1, $2, TRUE)
       RETURNING id, username, created_at`,
      [username.trim(), passwordHash]
    );
    const user = result.rows[0];

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'user_create',
      resource: user.username,
      result: 'success',
    }).catch(() => {});

    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', error.message);
    return res.status(500).json({ error: 'Unable to create user.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/users/:id/password — reset another admin's password
// ---------------------------------------------------------------------------
router.put(
  '/:id/password',
  validateParams(schemas.userIdParam),
  validateBody(schemas.userPasswordUpdate),
  async (req, res) => {
    const { id } = req.params;
    const { password } = req.body;

    try {
      const passwordHash = await hashPassword(password);
      const result = await query(
        'UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id, username',
        [id, passwordHash]
      );
      const user = result.rows[0];
      if (!user) {
        return res.status(404).json({ error: 'User not found.' });
      }

      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'user_password_reset',
        resource: user.username,
        result: 'success',
      }).catch(() => {});

      return res.json({ message: 'Password updated successfully.' });
    } catch (error) {
      console.error('Update user password error:', error.message);
      return res.status(500).json({ error: 'Unable to update password.' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/users/:id — remove an admin account
// ---------------------------------------------------------------------------
router.delete('/:id', validateParams(schemas.userIdParam), async (req, res) => {
  const { id } = req.params;

  if (req.user?.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in as it.' });
  }

  try {
    const countResult = await query('SELECT COUNT(*)::int AS count FROM users');
    if (countResult.rows[0].count <= 1) {
      return res.status(400).json({ error: 'At least one admin account must remain.' });
    }

    const result = await query('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'user_delete',
      resource: user.username,
      result: 'success',
    }).catch(() => {});

    return res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Delete user error:', error.message);
    return res.status(500).json({ error: 'Unable to delete user.' });
  }
});

module.exports = router;
