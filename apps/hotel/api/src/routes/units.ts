import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAdmin, requireIdentity } from '../auth';
import { CODE_TTL_MINUTES, generateEnrolmentCode, hash } from '../tokens';
import { int, UUID } from '../util';

const UNIQUE_VIOLATION = '23505';

/** Express 5 types every param as `string | string[]`; none of these repeat. */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/** The four guest flows, each switchable per unit (plan.md §629). */
const FLOWS = ['checkin', 'quiz', 'birthday', 'promo'] as const;
type Flow = (typeof FLOWS)[number];

export function unitRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/me', requireIdentity, (req, res) => {
    res.json({ user: req.identity!.user, isAdmin: req.identity!.isAdmin });
  });

  /**
   * The units the caller may see. An admin sees every one; anyone else sees
   * only what `unit_access` grants — the mapping that replaced the legacy
   * `users` + `unit_user` tables (§629).
   *
   * Inactive units stay visible to an admin, who would otherwise have no way
   * to reactivate one.
   */
  router.get('/units', requireIdentity, async (req, res) => {
    const identity = req.identity!;
    const { rows } = identity.isAdmin
      ? await pool.query(`SELECT * FROM units ORDER BY name`)
      : await pool.query(
          `SELECT u.* FROM units u
             JOIN unit_access a ON a.unit_id = u.id AND a.identity = $1
            WHERE u.is_active ORDER BY u.name`,
          [identity.user]
        );
    res.json(rows.map(toUnit));
  });

  /**
   * Units are created by the agent's sync, not by hand — they exist in
   * Wintouch first (§620). What an admin changes here is which flows are on.
   */
  router.patch('/units/:id', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such unit' });
      return;
    }

    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const flow of FLOWS) {
      const key = `${flow}Active`;
      const value = (req.body ?? {})[key];
      if (typeof value === 'boolean') {
        values.push(value);
        sets.push(`${flow}_is_active = $${values.length}`);
      }
    }
    if (typeof req.body?.isActive === 'boolean') {
      values.push(req.body.isActive);
      sets.push(`is_active = $${values.length}`);
    }
    // Check-out billing-account assignment (§656) — an admin/back-office
    // automation, not a guest-text-driven flow, so it isn't in FLOWS above.
    if (typeof req.body?.checkoutActive === 'boolean') {
      values.push(req.body.checkoutActive);
      sets.push(`checkout_is_active = $${values.length}`);
    }
    // Days before check-in / after check-out the guest email goes out
    // (plan.md §651). 0-60 covers every plausible stay; anything outside
    // that is almost certainly a typo, so it's dropped rather than stored.
    for (const [key, column] of [
      ['checkinOffsetDays', 'checkin_offset_days'],
      ['quizOffsetDays', 'quiz_offset_days'],
    ] as const) {
      const value = int(req.body?.[key]);
      if (value !== null && value >= 0 && value <= 60) {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length === 0) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE units SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      values
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'no such unit' });
      return;
    }
    res.json(toUnit(rows[0]));
  });

  router.get('/units/:id/access', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such unit' });
      return;
    }
    const { rows } = await pool.query(
      `SELECT identity FROM unit_access WHERE unit_id = $1 ORDER BY identity`,
      [id]
    );
    res.json(rows.map((r) => r.identity));
  });

  /** Idempotent: granting twice is the same end state, not an error. */
  router.put('/units/:id/access/:identity', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    const identity = param(req.params.identity).trim();
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such unit' });
      return;
    }
    if (!identity) {
      res.status(400).json({ error: 'identity is required' });
      return;
    }
    try {
      await pool.query(
        `INSERT INTO unit_access (identity, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [identity, id]
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        res.status(404).json({ error: 'no such unit' });
        return;
      }
      throw err;
    }
    res.status(204).end();
  });

  router.delete('/units/:id/access/:identity', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such unit' });
      return;
    }
    await pool.query(`DELETE FROM unit_access WHERE unit_id = $1 AND identity = $2`, [
      id,
      param(req.params.identity),
    ]);
    res.status(204).end();
  });

  /** The enrolled agent, for the admin UI. Never anything about its token. */
  router.get('/agent', requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT id, label, enrolled_at, last_seen_at FROM agents
        WHERE revoked_at IS NULL LIMIT 1`
    );
    res.json(rows.length ? { enrolled: true, ...rows[0] } : { enrolled: false });
  });

  /**
   * Issue a single-use enrolment code (§627). The plaintext is returned once,
   * here — only its hash is stored, so it cannot be read back.
   *
   * Issuing supersedes any outstanding unused code, or an admin re-issuing
   * after a mistype leaves a second live code nobody is tracking.
   */
  router.post('/agent/enrolment-code', requireAdmin, async (_req, res) => {
    const code = generateEnrolmentCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM enrolment_codes WHERE used_at IS NULL`);
      await client.query(
        `INSERT INTO enrolment_codes (code_hash, expires_at) VALUES ($1, $2)`,
        [hash(code), expiresAt]
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

  /** Revoke keeps the row so what was enrolled stays visible (§631). */
  router.delete('/agent', requireAdmin, async (_req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE agents SET revoked_at = now() WHERE revoked_at IS NULL`
    );
    res.status(rowCount === 0 ? 404 : 204).end();
  });

  return router;
}

function toUnit(r: Record<string, unknown>) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    isActive: r.is_active,
    checkinActive: r.checkin_is_active,
    quizActive: r.quiz_is_active,
    birthdayActive: r.birthday_is_active,
    promoActive: r.promo_is_active,
    checkoutActive: r.checkout_is_active,
    checkinOffsetDays: r.checkin_offset_days,
    quizOffsetDays: r.quiz_offset_days,
  };
}
