import { Router } from 'express';
import type { Pool } from 'pg';
import type { AgentHub } from '../agentHub';
import { requireAdmin, requireIdentity } from '../auth';
import { CODE_TTL_MINUTES, generateEnrolmentCode, hash } from '../tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres unique-violation. Turning it into a 409 beats a pre-check SELECT,
 *  which races two concurrent creates anyway. */
const UNIQUE_VIOLATION = '23505';

/**
 * Express 5 types every route param as `string | string[]`, because a wildcard
 * or repeated segment can match more than once. None of the routes here use
 * one, so the array case is unreachable — this narrows it without scattering
 * casts through the handlers.
 */
function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function storeRoutes(pool: Pool, hub: AgentHub): Router {
  const router = Router();

  /**
   * Who the caller is, as Authelia reported them (plan.md §629).
   *
   * The UI needs it to decide whether to render the administration controls at
   * all: without it a viewer sees buttons that only fail with a 403 when
   * pressed. The server still enforces every one of them — this is what to
   * *show*, never what to *allow*.
   */
  router.get('/me', requireIdentity, (req, res) => {
    res.json({ user: req.identity!.user, isAdmin: req.identity!.isAdmin });
  });

  /**
   * The stores the caller may see. An admin sees every store; anyone else sees
   * only what `store_access` grants them — the mapping that replaced the legacy
   * `users.access[]` array (plan.md §629).
   *
   * `is_active` is honoured for viewers but not for admins, who need to see a
   * deactivated store in order to reactivate it.
   */
  router.get('/stores', requireIdentity, async (req, res) => {
    const identity = req.identity!;
    const { rows } = identity.isAdmin
      ? await pool.query(
          `SELECT s.id, s.name, s.is_active, a.id AS agent_id, a.last_seen_at
             FROM stores s LEFT JOIN agents a ON a.store_id = s.id AND a.revoked_at IS NULL
            ORDER BY s.name`
        )
      : await pool.query(
          `SELECT s.id, s.name, s.is_active, a.id AS agent_id, a.last_seen_at
             FROM stores s
             JOIN store_access sa ON sa.store_id = s.id AND sa.identity = $1
             LEFT JOIN agents a ON a.store_id = s.id AND a.revoked_at IS NULL
            WHERE s.is_active
            ORDER BY s.name`,
          [identity.user]
        );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        isActive: r.is_active,
        // Whether an agent is enrolled, never anything about its token.
        agentEnrolled: r.agent_id !== null,
        // Enrolled says an agent exists; connected says it is on the socket
        // right now. A shop can be enrolled and offline, which is exactly what
        // an operator needs to see (plan.md §634).
        connected: hub.isConnected(r.id),
        lastSeenAt: r.last_seen_at,
      }))
    );
  });

  router.post('/stores', requireAdmin, async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO stores (name) VALUES ($1) RETURNING id, name, is_active`,
        [name]
      );
      res.status(201).json({ id: rows[0].id, name: rows[0].name, isActive: rows[0].is_active });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        res.status(409).json({ error: 'a store with that name already exists' });
        return;
      }
      throw err;
    }
  });

  router.patch('/stores/:id', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
    const isActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined;
    if (name === undefined && isActive === undefined) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }
    if (name !== undefined && name === '') {
      res.status(400).json({ error: 'name cannot be empty' });
      return;
    }
    try {
      // COALESCE so an absent field is left alone rather than nulled.
      const { rows } = await pool.query(
        `UPDATE stores
            SET name = COALESCE($2, name),
                is_active = COALESCE($3, is_active),
                updated_at = now()
          WHERE id = $1
        RETURNING id, name, is_active`,
        [param(req.params.id), name ?? null, isActive ?? null]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'no such store' });
        return;
      }
      res.json({ id: rows[0].id, name: rows[0].name, isActive: rows[0].is_active });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        res.status(409).json({ error: 'a store with that name already exists' });
        return;
      }
      throw err;
    }
  });

  /** Cascades to the store's access grants, agent and unused codes (001_init.sql). */
  router.delete('/stores/:id', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const { rowCount } = await pool.query(`DELETE FROM stores WHERE id = $1`, [param(req.params.id)]);
    res.status(rowCount === 0 ? 404 : 204).end();
  });

  router.get('/stores/:id/access', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const { rows } = await pool.query(
      `SELECT identity FROM store_access WHERE store_id = $1 ORDER BY identity`,
      [param(req.params.id)]
    );
    res.json(rows.map((r) => r.identity));
  });

  /** Idempotent: granting twice is not an error, it is the same end state. */
  router.put('/stores/:id/access/:identity', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const identity = param(req.params.identity).trim();
    if (!identity) {
      res.status(400).json({ error: 'identity is required' });
      return;
    }
    try {
      await pool.query(
        `INSERT INTO store_access (identity, store_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [identity, param(req.params.id)]
      );
    } catch (err) {
      // Foreign-key violation: the store id is well-formed but does not exist.
      if ((err as { code?: string }).code === '23503') {
        res.status(404).json({ error: 'no such store' });
        return;
      }
      throw err;
    }
    res.status(204).end();
  });

  router.delete('/stores/:id/access/:identity', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    await pool.query(`DELETE FROM store_access WHERE store_id = $1 AND identity = $2`, [
      param(req.params.id),
      param(req.params.identity),
    ]);
    res.status(204).end();
  });

  /**
   * Issue a single-use enrolment code for this store (plan.md §627).
   *
   * The plaintext code is returned **once, here** — only its hash is stored, so
   * it cannot be read back afterwards. Losing it means issuing another.
   *
   * Issuing supersedes any outstanding unused code for the store: otherwise an
   * admin who re-issues because the first was mistyped leaves a second live
   * code nobody is tracking.
   */
  router.post('/stores/:id/enrolment-code', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const { rows: store } = await pool.query(`SELECT id FROM stores WHERE id = $1`, [param(req.params.id)]);
    if (store.length === 0) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const code = generateEnrolmentCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM enrolment_codes WHERE store_id = $1 AND used_at IS NULL`,
        [param(req.params.id)]
      );
      await client.query(
        `INSERT INTO enrolment_codes (code_hash, store_id, expires_at) VALUES ($1, $2, $3)`,
        [hash(code), param(req.params.id), expiresAt]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  });

  /**
   * Revoke the store's enrolled agent. The row is kept with `revoked_at` set
   * rather than deleted, so the history of what was enrolled survives; the
   * agent's next call 401s immediately (see `requireAgent`).
   */
  router.delete('/stores/:id/agent', requireAdmin, async (req, res) => {
    if (!UUID.test(param(req.params.id))) {
      res.status(404).json({ error: 'no such store' });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE agents SET revoked_at = now() WHERE store_id = $1 AND revoked_at IS NULL`,
      [param(req.params.id)]
    );
    res.status(rowCount === 0 ? 404 : 204).end();
  });

  return router;
}
