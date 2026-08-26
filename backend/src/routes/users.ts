/**
 * User management API routes.
 * Every account is an administrator — there is no restricted role tier —
 * so any authenticated user may manage any other account.
 */

import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { hashPassword } from '../utils/password';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';

const router = Router();

interface UserRow {
  id: number;
  username: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/users — list admin accounts
// ---------------------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query<UserRow>('SELECT id, username, created_at FROM users ORDER BY id ASC');
    return res.json({ items: result.rows });
  } catch (error) {
    console.error('List users error:', (error as Error).message);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users — create a new admin account
// ---------------------------------------------------------------------------
router.post('/', validateBody(schemas.userCreate), async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    const passwordHash = await hashPassword(password);
    const result = await query<UserRow>(
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
    const err = error as { code?: string; message: string };
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', err.message);
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
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { password } = req.body;

    try {
      const passwordHash = await hashPassword(password);
      const result = await query<{ id: number; username: string }>(
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
      console.error('Update user password error:', (error as Error).message);
      return res.status(500).json({ error: 'Unable to update password.' });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/users/:id — remove an admin account
// ---------------------------------------------------------------------------
router.delete('/:id', validateParams(schemas.userIdParam), async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  if (req.user?.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in as it.' });
  }

  try {
    const countResult = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
    if (countResult.rows[0].count <= 1) {
      return res.status(400).json({ error: 'At least one admin account must remain.' });
    }

    const result = await query<{ username: string }>('DELETE FROM users WHERE id = $1 RETURNING username', [id]);
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
    console.error('Delete user error:', (error as Error).message);
    return res.status(500).json({ error: 'Unable to delete user.' });
  }
});

export default router;
