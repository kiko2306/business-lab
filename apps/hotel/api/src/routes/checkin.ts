import { Router } from 'express';
import type { Pool } from 'pg';
import { date, inTransaction, int, text, UUID } from '../util';
import { param } from './units';

/**
 * The guest-facing half of check-in (plan.md §620, §628). Public: a guest
 * follows an emailed link with no account, so there is no `requireIdentity`
 * here — the unguessable v4 `token` *is* the authorisation. Not yet mounted
 * behind a public hostname (that is the `check-in` app, still to be built);
 * these exist so that app has something to call.
 *
 * A unit with its check-in flow switched off, or a token that matches
 * nothing, both 404 with the same body — a disabled flow must not be
 * distinguishable from a wrong link.
 */
export function checkinRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/:token', async (req, res) => {
    const token = param(req.params.token);
    if (!UUID.test(token)) {
      res.status(404).json({ error: 'no such check-in' });
      return;
    }
    const reservation = await loadReservation(pool, token);
    if (!reservation) {
      res.status(404).json({ error: 'no such check-in' });
      return;
    }
    res.json(await toCheckin(pool, reservation));
  });

  /**
   * Occupant count comes from the reservation Wintouch sent, not from the
   * guest — `extras` beyond `adults + children + babies - 1` (the primary
   * guest fills one adult slot) are dropped rather than stored.
   */
  router.post('/:token', async (req, res) => {
    const token = param(req.params.token);
    if (!UUID.test(token)) {
      res.status(404).json({ error: 'no such check-in' });
      return;
    }
    const reservation = await loadReservation(pool, token);
    if (!reservation) {
      res.status(404).json({ error: 'no such check-in' });
      return;
    }
    if (!reservation.guest_id) {
      res.status(409).json({ error: 'this reservation has no guest on file yet' });
      return;
    }

    const g = (req.body?.guest ?? {}) as Record<string, unknown>;
    const extras = Array.isArray(req.body?.extras) ? (req.body.extras as Record<string, unknown>[]) : [];
    const maxExtras = Math.max(0, reservation.adults + reservation.children + reservation.babies - 1);

    await inTransaction(pool, async (client) => {
      // Every field here is one the agent's write-back actually reads back
      // (ingest.ts's toPendingCheckin) — collecting more would sit unread.
      await client.query(
        `UPDATE guests SET
           first_name = $2, last_name = $3, email = $4,
           document_type = $5, document_number = $6, document_country = $7,
           nationality = $8, birth_date = $9,
           address_line1 = $10, postal_code = $11, city = $12, country = $13,
           has_changes = true, updated_at = now()
         WHERE id = $1`,
        [
          reservation.guest_id,
          text(g.firstName), text(g.lastName), text(g.email),
          int(g.documentType), text(g.documentNumber), text(g.documentCountry),
          text(g.nationality), date(g.birthDate),
          text(g.addressLine1), text(g.postalCode), text(g.city), text(g.country),
        ]
      );

      await client.query(`DELETE FROM guest_extras WHERE reservation_id = $1`, [reservation.id]);
      for (const e of extras.slice(0, maxExtras)) {
        await client.query(
          `INSERT INTO guest_extras (reservation_id, first_name, last_name, document_number, age_group)
           VALUES ($1, $2, $3, $4, $5)`,
          [reservation.id, text(e.firstName), text(e.lastName), text(e.documentNumber), int(e.ageGroup) ?? 0]
        );
      }

      // Reopens the write-back regardless of prior state: a correction after
      // the agent already wrote the first submission to Wintouch must go back
      // out again, the same as an edited guest reopens to syncing.
      await client.query(
        `UPDATE reservations SET checkin_success = true, checkin_notified = false, updated_at = now()
          WHERE id = $1`,
        [reservation.id]
      );
    });

    res.json(await toCheckin(pool, reservation));
  });

  return router;
}

interface Reservation {
  id: string;
  guest_id: string | null;
  adults: number;
  children: number;
  babies: number;
}

async function loadReservation(pool: Pool, token: string): Promise<Reservation | null> {
  const { rows } = await pool.query(
    `SELECT r.id, r.guest_id, r.adults, r.children, r.babies
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
      WHERE r.token = $1 AND u.checkin_is_active`,
    [token]
  );
  return rows[0] ?? null;
}

async function toCheckin(pool: Pool, reservation: Reservation) {
  const { rows } = await pool.query(
    `SELECT r.checkin_on, r.checkout_on, r.room_name, r.adults, r.children, r.babies,
            r.checkin_success, u.name AS unit_name,
            g.first_name, g.last_name, g.email, g.document_type, g.document_number,
            g.document_country, g.nationality, g.birth_date,
            g.address_line1, g.postal_code, g.city, g.country
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN guests g ON g.id = r.guest_id
      WHERE r.id = $1`,
    [reservation.id]
  );
  const r = rows[0];
  const { rows: extras } = await pool.query(
    `SELECT first_name, last_name, document_number, age_group
       FROM guest_extras WHERE reservation_id = $1 ORDER BY created_at`,
    [reservation.id]
  );
  return {
    unit: r.unit_name,
    checkinOn: r.checkin_on,
    checkoutOn: r.checkout_on,
    roomName: r.room_name,
    occupants: { adults: r.adults, children: r.children, babies: r.babies },
    submitted: r.checkin_success,
    guest: r.first_name || r.last_name || r.email
      ? {
          firstName: r.first_name,
          lastName: r.last_name,
          email: r.email,
          documentType: r.document_type,
          documentNumber: r.document_number,
          documentCountry: r.document_country,
          nationality: r.nationality,
          birthDate: r.birth_date,
          addressLine1: r.address_line1,
          postalCode: r.postal_code,
          city: r.city,
          country: r.country,
        }
      : null,
    extras: extras.map((e) => ({
      firstName: e.first_name,
      lastName: e.last_name,
      documentNumber: e.document_number,
      ageGroup: e.age_group,
    })),
  };
}
