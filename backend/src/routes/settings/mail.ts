// Settings routes: Global outgoing mail settings.
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { query } from '../../utils/database';
import { writeAuditLog } from '../../utils/audit';
import { schemas, validateBody } from '../../middleware/validation';
import { MAIL_SETTINGS_KEYS, defaultPort, getMailConfig } from '../../utils/mailSettings';
import { testMailConnection } from '../../services/mailTest';
import { setSettings } from '../../utils/settingsStore';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/settings/mail — the shared mailbox every app sends through.
// Passwords are never echoed back, only whether they are set (same masking as
// the NPM password above).
// ---------------------------------------------------------------------------
router.get('/mail', async (_req: Request, res: Response) => {
  try {
    const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
      Object.values(MAIL_SETTINGS_KEYS),
    ]);
    const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

    return res.json({
      // "Can an app actually send?" — host, user and a from address are the
      // minimum. Receiving is reported separately because it is optional.
      configured: Boolean(
        values[MAIL_SETTINGS_KEYS.smtpHost] &&
          values[MAIL_SETTINGS_KEYS.smtpUser] &&
          values[MAIL_SETTINGS_KEYS.fromAddress]
      ),
      receiveConfigured: Boolean(values[MAIL_SETTINGS_KEYS.imapHost]),
      smtpHost: values[MAIL_SETTINGS_KEYS.smtpHost] ?? null,
      smtpPort: values[MAIL_SETTINGS_KEYS.smtpPort] ?? null,
      smtpUser: values[MAIL_SETTINGS_KEYS.smtpUser] ?? null,
      smtpPasswordConfigured: Boolean(values[MAIL_SETTINGS_KEYS.smtpPassword]),
      smtpEncryption: values[MAIL_SETTINGS_KEYS.smtpEncryption] ?? 'tls',
      fromAddress: values[MAIL_SETTINGS_KEYS.fromAddress] ?? null,
      fromName: values[MAIL_SETTINGS_KEYS.fromName] ?? null,
      imapHost: values[MAIL_SETTINGS_KEYS.imapHost] ?? null,
      imapPort: values[MAIL_SETTINGS_KEYS.imapPort] ?? null,
      imapUser: values[MAIL_SETTINGS_KEYS.imapUser] ?? null,
      imapPasswordConfigured: Boolean(values[MAIL_SETTINGS_KEYS.imapPassword]),
      imapEncryption: values[MAIL_SETTINGS_KEYS.imapEncryption] ?? 'ssl',
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load mail settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/mail
// ---------------------------------------------------------------------------
router.put('/mail', validateBody(schemas.mailSettings), async (req: Request, res: Response) => {
  const enc = req.body.smtpEncryption;
  const imapEnc = req.body.imapEncryption ?? 'ssl';
  const imapHost = (req.body.imapHost ?? '').trim();

  const values: Record<string, string> = {
    [MAIL_SETTINGS_KEYS.smtpHost]: req.body.smtpHost,
    [MAIL_SETTINGS_KEYS.smtpPort]: String(req.body.smtpPort ?? defaultPort('smtp', enc)),
    [MAIL_SETTINGS_KEYS.smtpUser]: req.body.smtpUser ?? '',
    [MAIL_SETTINGS_KEYS.smtpEncryption]: enc,
    [MAIL_SETTINGS_KEYS.fromAddress]: req.body.fromAddress,
    [MAIL_SETTINGS_KEYS.fromName]: req.body.fromName ?? '',
    // Written even when empty: clearing the host is how receiving is turned
    // off, so a blank must overwrite rather than be skipped.
    [MAIL_SETTINGS_KEYS.imapHost]: imapHost,
    [MAIL_SETTINGS_KEYS.imapPort]: imapHost ? String(req.body.imapPort ?? defaultPort('imap', imapEnc)) : '',
    [MAIL_SETTINGS_KEYS.imapUser]: imapHost ? (req.body.imapUser ?? '') : '',
    [MAIL_SETTINGS_KEYS.imapEncryption]: imapEnc,
  };

  // Passwords only overwrite when supplied, so saving the form with the field
  // left blank keeps the stored value.
  if (req.body.smtpPassword) values[MAIL_SETTINGS_KEYS.smtpPassword] = req.body.smtpPassword;
  if (req.body.imapPassword) values[MAIL_SETTINGS_KEYS.imapPassword] = req.body.imapPassword;

  try {
    await setSettings(values);

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'mail_config',
      result: 'success',
    });

    return res.json({ message: 'Mail settings saved. Restart an app for it to pick them up.' });
  } catch {
    return res.status(500).json({ error: 'Unable to save mail settings.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/mail/test — actually connect and authenticate.
// Untested mail credentials are a classic silent failure: everything looks
// saved, and you only discover the password is wrong when an app quietly
// stops sending. This proves the login before any app depends on it.
// ---------------------------------------------------------------------------
router.post('/mail/test', async (_req: Request, res: Response) => {
  const config = await getMailConfig();
  if (!config) {
    return res.status(400).json({ error: 'Mail is not configured yet — save the settings first.' });
  }

  const result = await testMailConnection(config);
  return res.status(result.success ? 200 : 400).json(result);
});

export default router;
