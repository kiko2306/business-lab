import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from '../auth';
import { text, UUID } from '../util';
import { param } from './units';

/**
 * Admin review of a computed check-out bill (plan.md §656). "Settling" one
 * here is a staff decision — cash/card/bank transfer at the desk, or
 * whatever an admin already confirmed happened — not an online charge;
 * there is no payment gateway in this build (see the migration's comment
 * for why). Once settled, the agent transfers the reservation's Wintouch
 * account to the chosen entity on its next tick (checkoutAgent.ts).
 */
export function checkoutRoutes(pool: Pool): Router {
  const router = Router();

  /** Bills computed but not yet settled — what an admin needs to act on. */
  router.get('/checkouts', requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.number, r.line, r.checkout_on, r.checkout_total,
              u.name AS unit_name,
              g.code AS guest_code, g.first_name, g.last_name
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         LEFT JOIN guests g ON g.id = r.guest_id
        WHERE r.checkout_computed_at IS NOT NULL AND r.checkout_settled_at IS NULL
        ORDER BY r.checkout_on`
    );
    const lines = await pool.query(
      `SELECT cl.reservation_id, cl.line, cl.item_name, cl.quantity, cl.unit_price
         FROM checkout_lines cl
         JOIN reservations r ON r.id = cl.reservation_id
        WHERE r.checkout_computed_at IS NOT NULL AND r.checkout_settled_at IS NULL
        ORDER BY cl.line`
    );
    res.json(rows.map((r) => toCheckout(r, lines.rows)));
  });

  /** Marks one settled — `entityCode` defaults to the reservation's own guest when omitted. */
  router.patch('/checkouts/:id', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such reservation' });
      return;
    }
    const override = text(req.body?.entityCode);

    const { rows } = await pool.query(
      `UPDATE reservations r SET
         checkout_entity_code = COALESCE($2, (SELECT g.code FROM guests g WHERE g.id = r.guest_id)),
         checkout_settled_at = now(),
         checkout_settled_by = $3,
         updated_at = now()
       WHERE r.id = $1 AND r.checkout_computed_at IS NOT NULL AND r.checkout_settled_at IS NULL
       RETURNING id, checkout_entity_code`,
      [id, override, req.identity!.user]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'no such unsettled checkout' });
      return;
    }
    res.json({ id: rows[0].id, entityCode: rows[0].checkout_entity_code });
  });

  return router;
}

function toCheckout(
  r: Record<string, unknown>,
  allLines: { reservation_id: string; line: number; item_name: string; quantity: string; unit_price: string }[]
) {
  return {
    id: r.id,
    number: r.number,
    line: r.line,
    checkoutOn: r.checkout_on,
    total: r.checkout_total,
    unit: r.unit_name,
    guest: r.guest_code
      ? { code: r.guest_code, firstName: r.first_name, lastName: r.last_name }
      : null,
    lines: allLines
      .filter((l) => l.reservation_id === r.id)
      .map((l) => ({ line: l.line, itemName: l.item_name, quantity: l.quantity, unitPrice: l.unit_price })),
  };
}
