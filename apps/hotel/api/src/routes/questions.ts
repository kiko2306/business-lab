import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from '../auth';
import { text, UUID } from '../util';
import { param } from './units';

const TYPES = ['rating', 'text'] as const;

/**
 * Admin CRUD for pulse's shared question list (plan.md §646, following up on
 * §644's seed-only table). No DELETE: `pulse_responses` references a
 * question, so removing one loses history — `isActive` is the only way to
 * retire one, same as `units.is_active`.
 */
export function questionRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/questions', requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(`SELECT * FROM pulse_questions ORDER BY sort_order`);
    res.json(rows.map(toQuestion));
  });

  router.post('/questions', requireAdmin, async (req, res) => {
    const questionText = text(req.body?.text);
    const type = text(req.body?.type);
    if (!questionText || !TYPES.includes(type as (typeof TYPES)[number])) {
      res.status(400).json({ error: 'text and a valid type are required' });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO pulse_questions (text, type, sort_order)
       VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) + 1 FROM pulse_questions), 1))
       RETURNING *`,
      [questionText, type]
    );
    res.status(201).json(toQuestion(rows[0]));
  });

  /** Reordering is two of these: the frontend swaps sortOrder with a neighbour. */
  router.patch('/questions/:id', requireAdmin, async (req, res) => {
    const id = param(req.params.id);
    if (!UUID.test(id)) {
      res.status(404).json({ error: 'no such question' });
      return;
    }

    const sets: string[] = [];
    const values: unknown[] = [id];
    const body = req.body ?? {};
    if (text(body.text) !== null) {
      values.push(text(body.text));
      sets.push(`text = $${values.length}`);
    }
    if (typeof body.type === 'string' && TYPES.includes(body.type as (typeof TYPES)[number])) {
      values.push(body.type);
      sets.push(`type = $${values.length}`);
    }
    if (typeof body.isActive === 'boolean') {
      values.push(body.isActive);
      sets.push(`is_active = $${values.length}`);
    }
    if (Number.isInteger(body.sortOrder)) {
      values.push(body.sortOrder);
      sets.push(`sort_order = $${values.length}`);
    }
    if (sets.length === 0) {
      res.status(400).json({ error: 'nothing to update' });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE pulse_questions SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      values
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'no such question' });
      return;
    }
    res.json(toQuestion(rows[0]));
  });

  return router;
}

function toQuestion(r: Record<string, unknown>) {
  return {
    id: r.id,
    text: r.text,
    type: r.type,
    isActive: r.is_active,
    sortOrder: r.sort_order,
  };
}
