import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { requireAgent } from '../auth';

/**
 * What the property agent pushes in, and pulls back out (plan.md §620, §627).
 *
 * Direction matters: units, guests and reservations flow **out of** Wintouch
 * and are mirrored here; completed check-ins are the only thing that flows
 * back. Everything is under `/agent`, which Authelia bypasses because the
 * agent authenticates itself with its enrolment token (§628, §637).
 *
 * Every endpoint is an upsert and safe to repeat: the agent re-sends the same
 * window on every tick, and a retried batch after a dropped connection must
 * not double anything.
 */
export function ingestRoutes(pool: Pool): Router {
  const router = Router();
  const agent = requireAgent(pool);

  /** Batches arrive in hundreds; a cap stops one bad request exhausting memory. */
  const MAX_BATCH = 1000;

  function batch<T>(body: unknown): T[] | null {
    if (!Array.isArray(body) || body.length > MAX_BATCH) return null;
    return body as T[];
  }

  router.post('/units', agent, async (req, res) => {
    const rows = batch<{ code?: string; name?: string }>(req.body);
    if (!rows) {
      res.status(400).json({ error: `expected an array of at most ${MAX_BATCH} units` });
      return;
    }
    let saved = 0;
    await inTransaction(pool, async (client) => {
      for (const unit of rows) {
        if (!unit.code) continue;
        // Only the name is refreshed. The per-flow switches are set by an
        // admin here, not in Wintouch, so a sync must never reset them.
        await client.query(
          `INSERT INTO units (code, name) VALUES ($1, $2)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
          [unit.code, unit.name ?? unit.code]
        );
        saved++;
      }
    });
    res.json({ saved });
  });

  /**
   * Guests, mirrored from Wintouch.
   *
   * **A guest with `has_changes` pending is skipped**, not overwritten. The
   * legacy did a blind upsert here (`Guest::updateOrCreate`) while the agent's
   * tick runs the guest sync *before* the check-in write-back — so a guest who
   * corrected their passport number online had it replaced with the stale
   * Wintouch value on the next tick, and that stale value was then written
   * back. Their correction was lost silently, which is the worst way to lose
   * it. The row reopens to syncing once the agent acknowledges the write-back.
   */
  router.post('/guests', agent, async (req, res) => {
    const rows = batch<Record<string, unknown>>(req.body);
    if (!rows) {
      res.status(400).json({ error: `expected an array of at most ${MAX_BATCH} guests` });
      return;
    }

    let saved = 0;
    let skipped = 0;
    await inTransaction(pool, async (client) => {
      for (const g of rows) {
        const code = typeof g.code === 'string' ? g.code : null;
        if (!code) continue;
        const result = await client.query(
          `INSERT INTO guests (
             code, first_name, last_name, email, phone,
             address_line1, address_line2, address_line3, postal_code, city,
             country, nationality, tax_number, birth_date
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (code) DO UPDATE SET
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             address_line1 = EXCLUDED.address_line1,
             address_line2 = EXCLUDED.address_line2,
             address_line3 = EXCLUDED.address_line3,
             postal_code = EXCLUDED.postal_code,
             city = EXCLUDED.city,
             country = EXCLUDED.country,
             nationality = EXCLUDED.nationality,
             tax_number = EXCLUDED.tax_number,
             birth_date = EXCLUDED.birth_date,
             updated_at = now()
           WHERE guests.has_changes = false
           RETURNING id`,
          [
            code, text(g.firstName), text(g.lastName), text(g.email), text(g.phone),
            text(g.addressLine1), text(g.addressLine2), text(g.addressLine3),
            text(g.postalCode), text(g.city), text(g.country), text(g.nationality),
            text(g.taxNumber), date(g.birthDate),
          ]
        );
        // No row back means the conflict target matched and the WHERE refused
        // the update — a guest with edits still waiting to go to Wintouch.
        if (result.rowCount === 0) skipped++;
        else saved++;
      }
    });
    res.json({ saved, skipped });
  });

  /**
   * Reservations for the sync window, with their extra occupants.
   *
   * The upsert touches only sync-owned columns. `checkin_sent`,
   * `checkin_success`, `quiz_sent` and `quiz_answered` belong to this side and
   * would be reset on every tick if they were listed — which would re-send
   * every check-in email, every five minutes, for ever.
   */
  router.post('/reservations', agent, async (req, res) => {
    const rows = batch<Record<string, unknown>>(req.body);
    if (!rows) {
      res.status(400).json({ error: `expected an array of at most ${MAX_BATCH} reservations` });
      return;
    }

    let saved = 0;
    const unknownUnits = new Set<string>();
    await inTransaction(pool, async (client) => {
      for (const r of rows) {
        const unitCode = text(r.unitCode);
        const number = text(r.number);
        const line = int(r.line);
        if (!unitCode || !number || line === null) continue;

        const unit = await client.query(`SELECT id FROM units WHERE code = $1`, [unitCode]);
        if (unit.rowCount === 0) {
          // A reservation for a unit we have never seen: recorded and skipped
          // rather than failing the batch, since the units sync runs first and
          // a new property simply arrives on the next tick.
          unknownUnits.add(unitCode);
          continue;
        }

        const guest = text(r.guestCode)
          ? await client.query(`SELECT id FROM guests WHERE code = $1`, [text(r.guestCode)])
          : null;

        const saved_ = await client.query(
          `INSERT INTO reservations (
             unit_id, number, line, guest_id, room_code, room_name,
             adults, children, babies, checkin_on, checkout_on, status, channel
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (unit_id, number, line) DO UPDATE SET
             guest_id = EXCLUDED.guest_id,
             room_code = EXCLUDED.room_code,
             room_name = EXCLUDED.room_name,
             adults = EXCLUDED.adults,
             children = EXCLUDED.children,
             babies = EXCLUDED.babies,
             checkin_on = EXCLUDED.checkin_on,
             checkout_on = EXCLUDED.checkout_on,
             status = EXCLUDED.status,
             channel = EXCLUDED.channel,
             updated_at = now()
           RETURNING id`,
          [
            unit.rows[0].id, number, line, guest?.rows[0]?.id ?? null,
            text(r.roomCode), text(r.roomName),
            int(r.adults) ?? 1, int(r.children) ?? 0, int(r.babies) ?? 0,
            date(r.checkin), date(r.checkout), text(r.status) ?? 'RESERVED', text(r.channel),
          ]
        );
        saved++;

        // Extras are replaced wholesale for this reservation: Wintouch is the
        // source while the guest has not checked in, and a diff would leave a
        // removed occupant behind.
        if (Array.isArray(r.extras)) {
          await client.query(`DELETE FROM guest_extras WHERE reservation_id = $1`, [saved_.rows[0].id]);
          for (const e of r.extras as Record<string, unknown>[]) {
            await client.query(
              `INSERT INTO guest_extras (reservation_id, code, first_name, last_name, age_group)
               VALUES ($1,$2,$3,$4,$5)`,
              [saved_.rows[0].id, text(e.code), text(e.firstName), text(e.lastName), int(e.ageGroup) ?? 0]
            );
          }
        }
      }
    });

    res.json({ saved, unknownUnits: [...unknownUnits] });
  });

  /**
   * Check-ins the guest has completed that Wintouch has not been told about.
   *
   * This is the only path back into the PMS (§620). The agent writes each one
   * into Wintouch and then acknowledges it below.
   */
  router.get('/checkins/pending', agent, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.token, r.number, r.line, u.code AS unit_code,
              g.code AS guest_code, g.first_name, g.last_name, g.email,
              g.document_type, g.document_number, g.document_country,
              g.birth_date, g.nationality, g.address_line1, g.postal_code, g.city, g.country,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'code', e.code, 'firstName', e.first_name, 'lastName', e.last_name,
                   'documentNumber', e.document_number, 'ageGroup', e.age_group)
                 ORDER BY e.created_at)
                   FROM guest_extras e WHERE e.reservation_id = r.id),
                '[]'::json) AS extras
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         LEFT JOIN guests g ON g.id = r.guest_id
        WHERE r.checkin_success = true AND r.checkin_notified = false
        ORDER BY r.updated_at`
    );
    res.json(rows.map(toPendingCheckin));
  });

  /**
   * The agent reports what happened to one check-in.
   *
   * On success the reservation stops appearing above and the guest's row
   * reopens to syncing, because Wintouch now holds what they entered. On
   * failure nothing is marked: it reappears on the next tick, which is the
   * behaviour that makes a transient Wintouch error self-heal instead of
   * silently dropping a guest's check-in.
   */
  router.post('/checkins/:token/ack', agent, async (req, res) => {
    const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;
    const ok = req.body?.ok !== false;
    if (!ok) {
      res.status(202).json({ acknowledged: false });
      return;
    }

    const { rowCount } = await pool.query(
      `WITH done AS (
         UPDATE reservations SET checkin_notified = true, updated_at = now()
          WHERE token = $1 AND checkin_success = true AND checkin_notified = false
        RETURNING guest_id)
       UPDATE guests SET has_changes = false, updated_at = now()
        WHERE id IN (SELECT guest_id FROM done WHERE guest_id IS NOT NULL)`,
      [token]
    );
    // rowCount counts the guest update, which is zero for a reservation with
    // no guest — so re-read rather than infer "not found" from it.
    const still = await pool.query(
      `SELECT checkin_notified FROM reservations WHERE token = $1`,
      [token]
    );
    if (still.rowCount === 0) {
      res.status(404).json({ error: 'no such check-in' });
      return;
    }
    res.json({ acknowledged: still.rows[0].checkin_notified, guestsReopened: rowCount });
  });

  return router;
}

async function inTransaction(pool: Pool, work: (client: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await work(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
/** Wintouch sends 1900-01-01 for "unknown"; storing it as a real date implies knowledge. */
const date = (v: unknown): string | null => {
  const s = text(v);
  if (!s) return null;
  const iso = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso !== '1900-01-01' ? iso : null;
};

function toPendingCheckin(r: Record<string, unknown>) {
  return {
    token: r.token,
    unitCode: r.unit_code,
    number: r.number,
    line: r.line,
    guest: r.guest_code
      ? {
          code: r.guest_code,
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
    extras: r.extras,
  };
}
