import { NextFunction, Request, Response } from 'express';
import { Capability, hasCapability } from '../auth/capabilities';
import { getUserCapabilities, getUserRoles } from '../services/userRoles';

/**
 * Route guard: 403 unless the signed-in user holds `capability` (plan.md §149,
 * §152). Runs after `authMiddleware`, so `req.user` is set.
 *
 * Roles **and** the per-account feature grants are read fresh from the
 * database on every call rather than trusted from the access token — a
 * demotion or a feature being switched off has to take effect immediately,
 * not after the token's hour is up. Two indexed lookups are cheap next to
 * what these routes then do (spawn `docker compose`, call Cloudflare, …).
 */
export function requireCapability(capability: Capability) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    try {
      const [roles, grants] = await Promise.all([
        getUserRoles(userId),
        getUserCapabilities(userId),
      ]);
      if (!hasCapability(roles, grants, capability)) {
        res.status(403).json({
          error: 'Your role does not allow this action.',
          capability,
        });
        return;
      }
      next();
    } catch (error) {
      console.error('Capability check failed:', (error as Error).message);
      res.status(500).json({ error: 'Unable to verify permissions.' });
    }
  };
}

/**
 * Route guard: 403 unless the signed-in user holds the `webmaster` role
 * itself — narrower than any capability, and not something a webmaster can
 * delegate to an admin via feature grants (an admin gets `apps:control` by
 * default, which is otherwise all Unpin needed). Reserved for an action
 * whose risk a capability grant doesn't capture: clearing an image pin can
 * silently trigger an unvetted `docker pull` outside the self-update batch
 * on the next restart, since the base compose tag is rarely already cached
 * locally (found live — plan.md §401). Same fresh-DB-read shape as
 * `requireCapability`, for the same reason.
 */
export function requireWebmaster() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated.' });
      return;
    }
    try {
      const roles = await getUserRoles(userId);
      if (!roles.includes('webmaster')) {
        res.status(403).json({ error: 'Only a webmaster can do this.' });
        return;
      }
      next();
    } catch (error) {
      console.error('Webmaster check failed:', (error as Error).message);
      res.status(500).json({ error: 'Unable to verify permissions.' });
    }
  };
}
