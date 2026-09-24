import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAgent } from '../auth';
import { checkoutAgentRoutes } from './checkoutAgent';
import { ingestRoutes } from './ingest';
import { generateAgentToken, hash, normaliseCode } from '../tokens';

/**
 * The property agent's own endpoints (plan.md §627).
 *
 * Mounted under `/agent`, the prefix Authelia is told to bypass — an agent
 * carries a token and cannot follow a redirect to a login form. Everything
 * here authenticates itself.
 */
export function agentRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * Exchange a single-use enrolment code for a long-lived token.
   *
   * Every failure returns the same message: distinguishing "no such code" from
   * "expired" from "already used" would tell someone probing codes which
   * guesses were real.
   */
  router.post('/enrol', async (req, res) => {
    const code = normaliseCode(typeof req.body?.code === 'string' ? req.body.code : '');
    if (!code) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Claim and validate in one statement, so two agents racing the same
      // code cannot both pass.
      const { rows: claimed } = await client.query(
        `UPDATE enrolment_codes SET used_at = now()
          WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING code_hash`,
        [hash(code)]
      );
      if (claimed.length === 0) {
        await client.query('ROLLBACK');
        res.status(401).json({ error: 'invalid or expired enrolment code' });
        return;
      }

      // Enrolling replaces whatever was reporting: the rebuilt-machine case,
      // where an admin issues a fresh code without thinking to revoke first.
      await client.query(`UPDATE agents SET revoked_at = now() WHERE revoked_at IS NULL`);

      const token = generateAgentToken();
      const { rows: agent } = await client.query(
        `INSERT INTO agents (token_hash) VALUES ($1) RETURNING id`,
        [hash(token)]
      );
      await client.query('COMMIT');

      res.status(201).json({ agentId: agent[0].id, token });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /**
   * Confirms the token is still good and returns the units to sync.
   *
   * The agent is told which properties exist rather than configured with them,
   * the same way tally's agent learns its shop from its token (§627) — so the
   * installer still only ever needs a URL and a code.
   */
  router.get('/units', requireAgent(pool), async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT code, name, checkin_is_active, quiz_is_active,
              birthday_is_active, promo_is_active
         FROM units WHERE is_active ORDER BY code`
    );
    res.json(
      rows.map((r) => ({
        code: r.code,
        name: r.name,
        checkinActive: r.checkin_is_active,
        quizActive: r.quiz_is_active,
        birthdayActive: r.birthday_is_active,
        promoActive: r.promo_is_active,
      }))
    );
  });

  // The sync itself — units, guests and reservations in; completed check-ins
  // back out. Same /agent prefix, same token auth.
  router.use(ingestRoutes(pool));
  // Check-out billing-account assignment (§656): a computed bill out, a
  // settled reservation's billing entity back in.
  router.use(checkoutAgentRoutes(pool));

  return router;
}
