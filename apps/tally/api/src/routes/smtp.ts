import { Router } from 'express';
import nodemailer from 'nodemailer';
import type { Pool } from 'pg';
import { requireAdmin } from '../auth';
import { defaultPort, loadSmtpRow, smtpConfigured, type SmtpEncryption } from '../smtpSettings';

const ENCRYPTIONS: SmtpEncryption[] = ['tls', 'ssl', 'none'];

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Admin-only settings for tally's own SMTP sender (plan.md §648). One row
 * (`id = 1`), same shape as `stores.ts`'s CRUD but with nothing to list —
 * there is only ever one sender.
 */
export function smtpRoutes(pool: Pool): Router {
  const router = Router();

  router.get('/smtp', requireAdmin, async (_req, res) => {
    const row = await loadSmtpRow(pool);
    res.json({
      configured: row ? smtpConfigured(row) : false,
      host: row?.host ?? '',
      port: row?.port ?? defaultPort('tls'),
      encryption: row?.encryption ?? 'tls',
      username: row?.username ?? '',
      passwordConfigured: Boolean(row?.password),
      fromAddress: row?.from_address ?? '',
      fromName: row?.from_name ?? '',
    });
  });

  router.put('/smtp', requireAdmin, async (req, res) => {
    const host = str(req.body?.host);
    const fromAddress = str(req.body?.fromAddress);
    const encryption = ENCRYPTIONS.includes(req.body?.encryption) ? req.body.encryption : 'tls';
    if (!host || !fromAddress) {
      res.status(400).json({ error: 'host and fromAddress are required' });
      return;
    }
    const port = Number.isInteger(req.body?.port) ? req.body.port : defaultPort(encryption);

    const existing = await loadSmtpRow(pool);
    // A blank password field keeps the stored one — saving the form without
    // retyping it must not wipe a working credential.
    const password = str(req.body?.password) ?? existing?.password ?? '';

    const { rows } = await pool.query(
      `INSERT INTO smtp_settings (id, host, port, encryption, username, password, from_address, from_name, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO UPDATE SET
         host = EXCLUDED.host, port = EXCLUDED.port, encryption = EXCLUDED.encryption,
         username = EXCLUDED.username, password = EXCLUDED.password,
         from_address = EXCLUDED.from_address, from_name = EXCLUDED.from_name, updated_at = now()
       RETURNING *`,
      [host, port, encryption, str(req.body?.username) ?? '', password, fromAddress, str(req.body?.fromName) ?? '']
    );
    const row = rows[0];
    res.json({
      configured: smtpConfigured(row),
      host: row.host,
      port: row.port,
      encryption: row.encryption,
      username: row.username,
      passwordConfigured: Boolean(row.password),
      fromAddress: row.from_address,
      fromName: row.from_name,
    });
  });

  router.post('/smtp/test', requireAdmin, async (_req, res) => {
    const row = await loadSmtpRow(pool);
    if (!row || !smtpConfigured(row)) {
      res.status(400).json({ error: 'SMTP is not configured yet — save the settings first.' });
      return;
    }
    const transport = nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.encryption === 'ssl',
      requireTLS: row.encryption === 'tls',
      auth: row.username ? { user: row.username, pass: row.password } : undefined,
    });
    try {
      await transport.verify();
      res.json({ success: true, message: 'Connected and authenticated.' });
    } catch (err) {
      res.status(400).json({ success: false, message: (err as Error).message });
    } finally {
      transport.close();
    }
  });

  return router;
}
