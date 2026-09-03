/**
 * User management API (`users:manage` — gated at the mount in index.ts).
 * Create, reset password, delete, assign named roles, set an admin's
 * per-feature grants, and set an account's email + SSO app-access list
 * (plan.md §149, §151, §152).
 */

import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { hashPassword } from '../utils/password';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { writeAuditLog } from '../utils/audit';
import { Capability, effectiveCapabilities, Role } from '../auth/capabilities';
import {
  getCapabilitiesForUsers,
  getRolesForUsers,
  getUserRoles,
  setUserCapabilities,
  setUserRoles,
  webmasterCount,
} from '../services/userRoles';
import {
  getAppAccessForUsers,
  getAppAccessOptionNames,
  getAppAccessOptions,
  setUserAppAccess,
} from '../services/userAppAccess';
import { syncAutheliaUsersSafe } from '../services/autheliaSync';

const router = Router();

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  created_at: string;
}

/** Reject any submitted app name that isn't currently grantable. */
async function rejectUnknownAppAccess(appAccess: string[]): Promise<string | null> {
  if (appAccess.length === 0) {
    return null;
  }
  const allowed = await getAppAccessOptionNames();
  const unknown = appAccess.filter((name) => !allowed.has(name));
  return unknown.length ? `Not an SSO-reachable app: ${unknown.join(', ')}.` : null;
}

// ---------------------------------------------------------------------------
// GET /api/users/app-access-options — the apps an account can be granted SSO
// access to: those currently exposed and Authelia-protected (plan.md §151).
// ---------------------------------------------------------------------------
router.get('/app-access-options', async (_req: Request, res: Response) => {
  try {
    return res.json({ items: await getAppAccessOptions() });
  } catch (error) {
    console.error('App access options error:', (error as Error).message);
    return res.status(500).json({ error: 'Unable to load the app list.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/users — list accounts with their roles
// ---------------------------------------------------------------------------
router.get('/', async (_req: Request, res: Response) => {
  try {
    const result = await query<UserRow>(
      'SELECT id, username, email, created_at FROM users ORDER BY id ASC'
    );
    const ids = result.rows.map((row) => row.id);
    const [roles, grants, appAccess] = await Promise.all([
      getRolesForUsers(ids),
      getCapabilitiesForUsers(ids),
      getAppAccessForUsers(ids),
    ]);
    const items = result.rows.map((row) => ({
      ...row,
      roles: roles[row.id] ?? [],
      // The effective set the account actually holds — an admin's grants (or
      // all-on when it has none), everything for a webmaster, nothing for a
      // user. The Roles/Features editor pre-ticks from this.
      capabilities: effectiveCapabilities(roles[row.id] ?? [], grants[row.id] ?? []),
      appAccess: appAccess[row.id] ?? [],
    }));
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
  const email = (req.body.email as string | undefined)?.trim() || null;
  const roles = req.body.roles as Role[];
  const capabilities = (req.body.capabilities ?? []) as Capability[];
  const appAccess = (req.body.appAccess ?? []) as string[];

  try {
    const badApp = await rejectUnknownAppAccess(appAccess);
    if (badApp) {
      return res.status(400).json({ error: badApp });
    }

    const passwordHash = await hashPassword(password);
    const result = await query<UserRow>(
      `INSERT INTO users (username, password_hash, email, is_setup_complete)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, username, email, created_at`,
      [username.trim(), passwordHash, email]
    );
    const user = result.rows[0];
    await setUserRoles(user.id, roles);
    // Seed feature grants only for an admin that asked for a specific set;
    // an admin with no rows is all-on (§152), and grants are meaningless for
    // a webmaster or a user.
    if (roles.includes('admin') && capabilities.length) {
      await setUserCapabilities(user.id, capabilities);
    }
    if (appAccess.length) {
      await setUserAppAccess(user.id, appAccess);
    }
    const effective = effectiveCapabilities(roles, roles.includes('admin') ? capabilities : []);

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'user_create',
      resource: `${user.username} [${roles.join(', ')}]`,
      result: 'success',
    }).catch(() => {});

    const warning = await syncAutheliaUsersSafe('user_create', req.user?.id ?? null);

    return res
      .status(201)
      .json({ user: { ...user, roles, capabilities: effective, appAccess }, ...(warning ? { warning } : {}) });
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

      // Don't let the last `webmaster` be demoted — that would leave nobody
      // with unrestricted access (recoverable only via `./start.sh recover`).
      if (!roles.includes('webmaster')) {
        const currentlyWebmaster = await query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role = 'webmaster'",
          [id]
        );
        if (currentlyWebmaster.rows[0].n > 0 && (await webmasterCount()) <= 1) {
          return res.status(400).json({ error: 'At least one account must keep the webmaster role.' });
        }
      }

      await setUserRoles(id, roles);
      // Feature grants only mean anything for an admin; drop them when the
      // account is no longer one, so they don't silently resurface later.
      if (!roles.includes('admin')) {
        await setUserCapabilities(id, []);
      }

      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'user_roles_update',
        resource: `${target.rows[0].username} → [${roles.join(', ')}]`,
        result: 'success',
      }).catch(() => {});

      // webmaster ↔ not changes Authelia group membership (the `admins` group
      // and every `app-*`).
      const warning = await syncAutheliaUsersSafe('user_roles_update', req.user?.id ?? null);

      return res.json({ message: 'Roles updated.', roles, ...(warning ? { warning } : {}) });
    } catch (error) {
      console.error('Update user roles error:', (error as Error).message);
      return res.status(500).json({ error: 'Unable to update roles.' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/users/:id/capabilities — replace an admin account's feature grants
// ---------------------------------------------------------------------------
router.put(
  '/:id/capabilities',
  validateParams(schemas.userIdParam),
  validateBody(schemas.userCapabilitiesUpdate),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const capabilities = req.body.capabilities as Capability[];

    try {
      const target = await query<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]);
      if (!target.rows[0]) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const roles = await getUserRoles(id);
      if (roles.includes('webmaster')) {
        return res.status(400).json({ error: 'A webmaster always has every feature; nothing to restrict.' });
      }
      if (!roles.includes('admin')) {
        return res.status(400).json({ error: 'Only an admin account has per-feature grants.' });
      }

      await setUserCapabilities(id, capabilities);
      const effective = effectiveCapabilities(roles, capabilities);

      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'user_capabilities_update',
        resource: `${target.rows[0].username} → [${effective.join(', ')}]`,
        result: 'success',
      }).catch(() => {});

      return res.json({ message: 'Features updated.', capabilities: effective });
    } catch (error) {
      console.error('Update user capabilities error:', (error as Error).message);
      return res.status(500).json({ error: 'Unable to update features.' });
    }
  }
);

// ---------------------------------------------------------------------------
// PUT /api/users/:id/access — replace an account's email and SSO app-access
// list (plan.md §151). Applies to any account; Authelia sync is slice 2c.
// ---------------------------------------------------------------------------
router.put(
  '/:id/access',
  validateParams(schemas.userIdParam),
  validateBody(schemas.userAccessUpdate),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const { email } = req.body;
    const appAccess = req.body.appAccess as string[];

    try {
      const badApp = await rejectUnknownAppAccess(appAccess);
      if (badApp) {
        return res.status(400).json({ error: badApp });
      }

      const target = await query<{ username: string }>(
        'UPDATE users SET email = $2 WHERE id = $1 RETURNING username',
        [id, email.trim()]
      );
      if (!target.rows[0]) {
        return res.status(404).json({ error: 'User not found.' });
      }

      await setUserAppAccess(id, appAccess);

      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'user_access_update',
        resource: `${target.rows[0].username} → [${appAccess.join(', ') || 'no apps'}]`,
        result: 'success',
      }).catch(() => {});

      const warning = await syncAutheliaUsersSafe('user_access_update', req.user?.id ?? null);

      return res.json({
        message: 'Access updated.',
        email: email.trim(),
        appAccess,
        ...(warning ? { warning } : {}),
      });
    } catch (error) {
      console.error('Update user access error:', (error as Error).message);
      return res.status(500).json({ error: 'Unable to update access.' });
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

      // The hash Authelia holds for this account has to follow the reset.
      const warning = await syncAutheliaUsersSafe('user_password_reset', req.user?.id ?? null);

      return res.json({ message: 'Password updated successfully.', ...(warning ? { warning } : {}) });
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

    // Removing the last webmaster would leave nobody with unrestricted access.
    const targetIsWebmaster = await query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM user_roles WHERE user_id = $1 AND role = 'webmaster'",
      [id]
    );
    if (targetIsWebmaster.rows[0].n > 0 && (await webmasterCount()) <= 1) {
      return res.status(400).json({ error: 'At least one account must keep the webmaster role.' });
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

    const warning = await syncAutheliaUsersSafe('user_delete', req.user?.id ?? null);

    return res.json({ message: 'User deleted successfully.', ...(warning ? { warning } : {}) });
  } catch (error) {
    console.error('Delete user error:', (error as Error).message);
    return res.status(500).json({ error: 'Unable to delete user.' });
  }
});

export default router;
