import { Router } from 'express';
import type { Pool } from 'pg';
import { inTransaction, int, text, UUID } from '../util';
import { param } from './units';

/**
 * The guest-facing half of pulse, hotel-core's post-stay feedback flow
 * (plan.md §644). Same shape as checkin.ts: public, no `requireIdentity` —
 * the unguessable v4 `token` is the authorisation, and a disabled flow 404s
 * the same as an unknown token so neither can be told apart from the other.
 */
export function pulseRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/:token', async (req, res) => {
    const token = param(req.params.token);
    if (!UUID.test(token)) {
      res.status(404).json({ error: 'no such feedback link' });
      return;
    }
    const reservation = await loadReservation(pool, token);
    if (!reservation) {
      res.status(404).json({ error: 'no such feedback link' });
      return;
    }
    res.json(await toFeedback(pool, reservation));
  });

  /**
   * Resubmission overwrites the previous answers, the same as check-in — a
   * guest correcting a rating should not need a separate "edit" path.
   */
  router.post('/:token', async (req, res) => {
    const token = param(req.params.token);
    if (!UUID.test(token)) {
      res.status(404).json({ error: 'no such feedback link' });
      return;
    }
    const reservation = await loadReservation(pool, token);
    if (!reservation) {
      res.status(404).json({ error: 'no such feedback link' });
      return;
    }

    const { rows: questions } = await pool.query(
      `SELECT id, type FROM pulse_questions WHERE is_active`
    );
    const typeById = new Map<string, string>(questions.map((q) => [q.id, q.type]));

    const submitted = Array.isArray(req.body?.responses)
      ? (req.body.responses as Record<string, unknown>[])
      : [];
    // A Map, not an array: the UNIQUE (reservation_id, question_id) constraint
    // means a duplicate questionId in one submission has to collapse to one
    // answer before it reaches the insert, not fail there. Last one wins.
    const answers = new Map<string, string>();
    for (const r of submitted) {
      const questionId = text(r.questionId)?.toLowerCase();
      const type = questionId ? typeById.get(questionId) : undefined;
      if (!questionId || !type) continue;
      if (type === 'rating') {
        const n = int(r.answer);
        if (n === null || n < 1 || n > 5) continue;
        answers.set(questionId, String(n));
      } else {
        const t = text(r.answer);
        if (t === null) continue;
        answers.set(questionId, t);
      }
    }

    await inTransaction(pool, async (client) => {
      await client.query(`DELETE FROM pulse_responses WHERE reservation_id = $1`, [reservation.id]);
      for (const [questionId, answer] of answers) {
        await client.query(
          `INSERT INTO pulse_responses (reservation_id, question_id, answer) VALUES ($1, $2, $3)`,
          [reservation.id, questionId, answer]
        );
      }
      await client.query(
        `UPDATE reservations SET quiz_answered = true, updated_at = now() WHERE id = $1`,
        [reservation.id]
      );
    });

    res.json(await toFeedback(pool, reservation));
  });

  return router;
}

interface Reservation {
  id: string;
}

async function loadReservation(pool: Pool, token: string): Promise<Reservation | null> {
  const { rows } = await pool.query(
    `SELECT r.id
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
      WHERE r.token = $1 AND u.quiz_is_active`,
    [token]
  );
  return rows[0] ?? null;
}

async function toFeedback(pool: Pool, reservation: Reservation) {
  const { rows } = await pool.query(
    `SELECT r.checkin_on, r.checkout_on, r.room_name, r.quiz_answered, u.name AS unit_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
      WHERE r.id = $1`,
    [reservation.id]
  );
  const r = rows[0];
  const { rows: questions } = await pool.query(
    `SELECT id, text, type FROM pulse_questions WHERE is_active ORDER BY sort_order`
  );
  const { rows: responses } = await pool.query(
    `SELECT question_id, answer FROM pulse_responses WHERE reservation_id = $1`,
    [reservation.id]
  );
  const answered = new Map<string, string>(responses.map((row) => [row.question_id, row.answer]));
  return {
    unit: r.unit_name,
    checkinOn: r.checkin_on,
    checkoutOn: r.checkout_on,
    roomName: r.room_name,
    submitted: r.quiz_answered,
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      answer: answered.get(q.id) ?? null,
    })),
  };
}
