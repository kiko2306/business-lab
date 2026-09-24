import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAgent } from '../auth';
import { generateAgentToken, hash, normaliseCode } from '../tokens';

/**
 * The shop agent's own endpoints (plan.md §627).
 *
 * Mounted under `/agent`, which is the prefix Authelia is told to bypass
 * (§628) — an agent carries a token and cannot follow a redirect to a login
 * form. Everything here therefore authenticates itself: `/agent/enrol` with a
 * single-use code, the rest with the token that enrolment returns.
 */
export function agentRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * Exchange a single-use enrolment code for a long-lived agent token.
   *
   * The token is returned **once, here** — only its hash is stored. An agent
   * that loses it needs a fresh code, which is the same position an attacker
   * with a copy of the database is in.
   *
   * Every failure returns the same message. Distinguishing "no such code" from
   * "expired" from "already used" would let someone probing codes learn which
   * guesses were real.
   */
  router.post('/enrol', async (req, res) => {
    const raw = typeof req.body?.code === 'string' ? req.body.code : '';
    const code = normaliseCode(raw);
    if (!code) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Claim the code and check its validity in one statement: two agents
      // starting with the same code cannot both pass, because the second
      // UPDATE matches no row once the first has set used_at.
      const { rows: claimed } = await client.query(
        `UPDATE enrolment_codes SET used_at = now()
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING store_id`,
        [hash(code)]
      );
      if (claimed.length === 0) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'invalid or expired enrolment code' });
        return;
      }
      const storeId = claimed[0].store_id;

      // Re-enrolling a store replaces its agent: the machine has been rebuilt
      // or swapped, and the old token should stop working at that moment.
      await client.query(
        `UPDATE agents SET revoked_at = now() WHERE store_id = $1 AND revoked_at IS NULL`,
        [storeId]
      );

      const token = generateAgentToken();
      const { rows: agent } = await client.query(
        `INSERT INTO agents (store_id, token_hash) VALUES ($1, $2) RETURNING id`,
        [storeId, hash(token)]
      );
      const { rows: store } = await client.query(`SELECT name FROM stores WHERE id = $1`, [storeId]);
      await client.query('COMMIT');

      res.status(201).json({
        agentId: agent[0].id,
        token,
        store: { id: storeId, name: store[0].name },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * What this token is. The agent calls it on start to confirm it is still
   * enrolled and to learn which store it serves — the store name and id are
   * derived from the token, never configured (§627 removed `<store name>` and
   * `<domain>` from the agent's config file).
   *
   * Calling it also refreshes `last_seen_at`, via requireAgent.
   */
  router.get('/me', requireAgent(pool), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.is_active FROM stores s WHERE s.id = $1`,
      [req.agent!.storeId]
    );
    res.json({
      agentId: req.agent!.id,
      store: { id: rows[0].id, name: rows[0].name, isActive: rows[0].is_active },
    });
  });

  return router;
}
