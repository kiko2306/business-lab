/**
 * User management API (`owner` capability `users:manage` — gated at the mount
 * in index.ts). Create, reset password, delete, and assign named roles
 * (plan.md §149).
 */

import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { hashPassword } from '../utils/password';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';
import { Role } from '../auth/capabilities';
import { getRolesForUsers, ownerCount, setUserRoles } from '../services/userRoles';

const router = Router();

interface UserRow {
  id: number;
  username: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /api/users — list accounts with their roles
// ---------------------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query<UserRow>('SELECT id, username, created_at FROM users ORDER BY id ASC');
    const roles = await getRolesForUsers(result.rows.map((row) => row.id));
    const items = result.rows.map((row) => ({ ...row, roles: roles[row.id] ?? [] }));
    return res.json({ items });
  } catch (error) {
    console.error('List users error:', (error as Error).message);
    return res.status(500).json({ error: 'Unable to load users.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/users — create an account with an explicit, non-empty role set
// ---------------------------------------------------------------------------
router.post('/', validateBody(schemas.userCreate), async (req: Request, res: Response) => {
  const { username, password } = req.body;
  const roles = req.body.roles as Role[];

  try {
    const passwordHash = await hashPassword(password);
    const result = await query<UserRow>(
      `INSERT INTO users (username, password_hash, is_setup_complete)
       VALUES ($1, $2, TRUE)
       RETURNING id, username, created_at`,
      [username.trim(), passwordHash]
    );
    const user = result.rows[0];
    await setUserRoles(user.id, roles);

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'user_create',
      resource: `${user.username} [${roles.join(', ')}]`,
      result: 'success',
    }).catch(() => {});

    return res.status(201).json({ user: { ...user, roles } });
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
// PUT /api/users/:id/roles — replace an account's roles
// ---------------------------------------------------------------------------
router.put(
  '/:id/roles',
  validateParams(schemas.userIdParam),
  validateBody(schemas.userRolesUpdate),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const roles = req.body.roles as Role[];

    if (req.user?.id === id) {
      return res.status(400).json({ error: 'You cannot change your own roles.' });
    }

    try {
      const target = await query<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]);
      if (!target.rows[0]) {
        return res.status(404).json({ error: 'User not found.' });
      }

      // Don't let the last `owner` be demoted — that would leave nobody able
      // to manage users (recoverable only via `./start.sh recover`).
      if (!roles.includes('owner')) {
        const currentlyOwner = await query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role = 'owner'",
          [id]
        );
        if (currentlyOwner.rows[0].n > 0 && (await ownerCount()) <= 1) {
          return res.status(400).json({ error: 'At least one account must keep the owner role.' });
        }
      }

      await setUserRoles(id, roles);

      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'user_roles_update',
        resource: `${target.rows[0].username} → [${roles.join(', ')}]`,
        result: 'success',
      }).catch(() => {});

      return res.json({ message: 'Roles updated.', roles });
    } catch (error) {
      console.error('Update user roles error:', (error as Error).message);
      return res.status(500).json({ error: 'Unable to update roles.' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/users/:id/password — reset another account's password
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
// DELETE /api/users/:id — remove an account
// ---------------------------------------------------------------------------
router.delete('/:id', validateParams(schemas.userIdParam), async (req: Request, res: Response) => {
  const id = Number(req.params.id);

  if (req.user?.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account while signed in as it.' });
  }

  try {
    const countResult = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
    if (countResult.rows[0].count <= 1) {
      return res.status(400).json({ error: 'At least one account must remain.' });
    }

    // Removing the last owner would lock user management out entirely.
    const targetIsOwner = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role = 'owner'",
      [id]
    );
    if (targetIsOwner.rows[0].n > 0 && (await ownerCount()) <= 1) {
      return res.status(400).json({ error: 'At least one account must keep the owner role.' });
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
