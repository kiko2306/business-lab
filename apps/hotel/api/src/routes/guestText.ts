import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAdmin } from '../auth';
import { GUEST_TEXT_KEYS, GUEST_TEXT_LOCALES, type GuestTextKey, type GuestTextLocale } from '../guestText';
import { param } from './units';
import { text } from '../util';

/**
 * Admin CRUD for the guest-text template store (plan.md §649.1, closing the
 * §629 decision #6 README item). Rows are seeded, fixed by key+locale — no
 * POST/DELETE, only editing a value, same shape as `smtp.ts`'s single row but
 * keyed on (key, locale) instead of a fixed id.
 */
export function guestTextRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/guest-text', requireAdmin, async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT key, locale, value, updated_at FROM guest_text_templates ORDER BY key, locale`
    );
    res.json(rows.map(toTemplate));
  });

  router.put('/guest-text/:key/:locale', requireAdmin, async (req, res) => {
    const key = param(req.params.key);
    const locale = param(req.params.locale);
    if (!GUEST_TEXT_KEYS.includes(key as GuestTextKey) || !GUEST_TEXT_LOCALES.includes(locale as GuestTextLocale)) {
      res.status(404).json({ error: 'no such guest-text key/locale' });
      return;
    }
    const value = text(req.body?.value);
    if (!value) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE guest_text_templates SET value = $3, updated_at = now()
        WHERE key = $1 AND locale = $2
        RETURNING key, locale, value, updated_at`,
      [key, locale, value]
    );
    res.json(toTemplate(rows[0]));
  });

  return router;
}

function toTemplate(r: Record<string, unknown>) {
  return { key: r.key, locale: r.locale, value: r.value, updatedAt: r.updated_at };
}
