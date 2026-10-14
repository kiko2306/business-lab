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
