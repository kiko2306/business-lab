import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAgent } from '../auth';
import { inTransaction, int, text } from '../util';

/**
 * The agent's two check-out jobs (plan.md §656): compute a bill for a
 * checked-out reservation from Wintouch, and — once an admin has settled it
 * (checkout.ts) — tell Wintouch which account to bill it to. Same `/agent`
 * prefix and token auth as ingest.ts, and the same upsert-is-safe-to-repeat
 * shape (plan.md §639).
 */
export function checkoutAgentRoutes(pool: Pool): Router {
  const router = Router();
  const agent = requireAgent(pool);

  const MAX_BATCH = 1000;

  /** Checked-out reservations with no bill computed yet, on a unit that has opted in. */
  router.get('/checkout/due', agent, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.token::text AS token, u.code AS unit_code, r.number, r.line
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
        WHERE u.is_active AND u.checkout_is_active
          AND r.checkout_computed_at IS NULL
          AND r.checkout_on <= CURRENT_DATE
        ORDER BY r.checkout_on
        LIMIT $1`,
      [MAX_BATCH]
    );
    res.json(rows.map((r) => ({ token: r.token, unitCode: r.unit_code, number: r.number, line: r.line })));
  });

  /**
   * The agent pushes what it computed from Wintouch's own `NightAudit` +
   * `Contas` — a total and the line items behind it, keyed by the
   * reservation's token (from `/checkout/due` above).
   */
  router.post('/checkout/bills', agent, async (req, res) => {
    const rows = Array.isArray(req.body) ? (req.body as Record<string, unknown>[]) : null;
    if (!rows || rows.length > MAX_BATCH) {
      res.status(400).json({ error: `expected an array of at most ${MAX_BATCH} bills` });
      return;
    }

    let saved = 0;
    await inTransaction(pool, async (client) => {
      for (const bill of rows) {
        const token = text(bill.token);
        if (!token) continue;
        const total = typeof bill.total === 'number' ? bill.total : null;
        if (total === null) continue;

        const { rows: matched } = await client.query(
          `UPDATE reservations SET checkout_total = $2, checkout_computed_at = now(), updated_at = now()
             WHERE token = $1 AND checkout_computed_at IS NULL
           RETURNING id`,
          [token, total]
        );
        if (matched.length === 0) continue; // Already computed (a retried batch) or an unknown token.

        const lines = Array.isArray(bill.lines) ? (bill.lines as Record<string, unknown>[]) : [];
        for (const line of lines) {
          await client.query(
            `INSERT INTO checkout_lines (reservation_id, line, item_name, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              matched[0].id,
              int(line.line) ?? 0,
              text(line.itemName) ?? '',
              typeof line.quantity === 'number' ? line.quantity : 1,
              typeof line.unitPrice === 'number' ? line.unitPrice : 0,
            ]
          );
        }
        saved++;
      }
    });
    res.json({ saved });
  });

  /** Reservations an admin has settled (checkout.ts) but Wintouch doesn't know about yet. */
  router.get('/checkout/settled', agent, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.token::text AS token, u.code AS unit_code, r.number, r.line, r.checkout_entity_code AS entity_code
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
        WHERE r.checkout_settled_at IS NOT NULL AND r.checkout_integrated = false
        ORDER BY r.checkout_settled_at
        LIMIT $1`,
      [MAX_BATCH]
    );
    res.json(
      rows.map((r) => ({ token: r.token, unitCode: r.unit_code, number: r.number, line: r.line, entityCode: r.entity_code }))
    );
  });

  /**
   * The agent reports what happened transferring one reservation's account.
   * On failure nothing is marked, so it reappears next tick — the same
   * self-heals-on-retry shape as the check-in write-back's ack (ingest.ts).
   */
  router.post('/checkout/:token/ack', agent, async (req, res) => {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    if (req.body?.ok === false) {
      res.status(202).json({ acknowledged: false });
      return;
    }
    const { rowCount } = await pool.query(
      `UPDATE reservations SET checkout_integrated = true, checkout_integrated_at = now(), updated_at = now()
        WHERE token = $1 AND checkout_settled_at IS NOT NULL AND checkout_integrated = false`,
      [token]
    );
    res.json({ acknowledged: (rowCount ?? 0) > 0 });
  });

  return router;
}
