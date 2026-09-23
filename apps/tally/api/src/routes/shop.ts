import { Router } from 'express';
import type { Pool } from 'pg';
import { requireIdentity } from '../auth';
import { AgentError, AgentHub, AgentOfflineError, AgentTimeoutError } from '../agentHub';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * The live shop-floor reads (plan.md §622's overview / sold_items / tables).
 *
 * tally stores none of this. Each request is relayed to the shop's own agent
 * over its outbound socket and answered from the POS database as it stands —
 * which is why the schema has no tables for any of it (§630).
 */
export function shopRoutes(pool: Pool, hub: AgentHub): Router {
  const router = Router();

  /** Admins see every shop; everyone else only what `store_access` grants. */
  async function maySee(identityUser: string, isAdmin: boolean, storeId: string): Promise<boolean> {
    if (isAdmin) {
      const { rows } = await pool.query(`SELECT 1 FROM stores WHERE id = $1`, [storeId]);
      return rows.length > 0;
    }
    const { rows } = await pool.query(
      `SELECT 1 FROM store_access sa JOIN stores s ON s.id = sa.store_id
        WHERE sa.store_id = $1 AND sa.identity = $2 AND s.is_active`,
      [storeId, identityUser]
    );
    return rows.length > 0;
  }

  function relay(method: string) {
    return async (req: Parameters<typeof requireIdentity>[0], res: Parameters<typeof requireIdentity>[1]) => {
      const storeId = param(req.params['id']);
      if (!UUID.test(storeId)) {
        res.status(404).json({ error: 'no such shop' });
        return;
      }
      const identity = req.identity!;
      // Deliberately the same 404 whether the shop does not exist or is simply
      // not granted: otherwise the response enumerates shops for a viewer.
      if (!(await maySee(identity.user, identity.isAdmin, storeId))) {
        res.status(404).json({ error: 'no such shop' });
        return;
      }
      try {
        res.json(await hub.ask(storeId, method));
      } catch (err) {
        if (err instanceof AgentOfflineError) {
          // 503 with a reason, not an empty 200: a floor dashboard showing
          // zeroes that look like real figures is worse than one saying the
          // shop is offline.
          res.status(503).json({ error: 'the shop agent is not connected', offline: true });
          return;
        }
        if (err instanceof AgentTimeoutError) {
          res.status(504).json({ error: err.message });
          return;
        }
        if (err instanceof AgentError) {
          res.status(502).json({ error: err.message });
          return;
        }
        throw err;
      }
    };
  }

  router.get('/stores/:id/overview', requireIdentity, relay('overview'));
  router.get('/stores/:id/sold-items', requireIdentity, relay('sold_items'));
  router.get('/stores/:id/tables', requireIdentity, relay('tables'));

  return router;
}
