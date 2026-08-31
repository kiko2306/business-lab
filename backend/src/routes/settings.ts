import https from 'https';
import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { schemas, validateBody } from '../middleware/validation';
import { MAIL_SETTINGS_KEYS, defaultPort, getMailConfig } from '../utils/mailSettings';
import { testMailConnection } from '../services/mailTest';
import { EXPOSURE_SETTINGS_KEYS, getExposureConfig } from '../utils/exposureSettings';
import { DEFAULT_TIMEZONE, getAppTimezone, isValidTimezone, setAppTimezone } from '../utils/generalSettings';
import { testNpmConnection } from '../services/npmClient';
import { testCloudflareTunnelAccess } from '../services/cloudflareTunnelClient';

const router = Router();

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';
const PERMISSION_EXPLANATION =
  'Required permissions: Account → Cloudflare Tunnel → Edit, Zone → DNS → Edit. ' +
  'To also run CrowdSec, add Account → Workers Scripts → Edit, Account → Workers KV Storage → Edit ' +
  'and Zone → Workers Routes → Edit.';

function maskToken(token: string | null): string | null {
  if (!token) {
    return null;
  }

  if (token.length <= 8) {
    return '••••••••';
  }

  return `${token.slice(0, 4)}••••••${token.slice(-4)}`;
}

function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && token.trim().length >= 20;
}

async function getStoredToken(): Promise<string | null> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [CLOUDFLARE_TOKEN_KEY]);
  return result.rows[0]?.value ?? null;
}

interface CloudflareVerifyResult {
  success: boolean;
  message: string;
}

function verifyCloudflareToken(token: string): Promise<CloudflareVerifyResult> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      'https://api.cloudflare.com/client/v4/user/tokens/verify',
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
      },
      (response) => {
        let body = '';

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const statusCode = response.statusCode ?? 500;
            if (statusCode >= 200 && statusCode < 300 && parsed.success) {
              resolve({ success: true, message: 'Cloudflare token verified successfully.' });
              return;
            }

            const errorMessage = parsed?.errors?.[0]?.message || 'Cloudflare rejected the supplied token.';
            resolve({ success: false, message: errorMessage });
          } catch {
            reject(new Error('Unable to parse Cloudflare verification response.'));
          }
        });
      }
    );

    request.on('error', (error) => reject(error));
    request.setTimeout(10000, () => request.destroy(new Error('Cloudflare verification timed out.')));
    request.end();
  });
}

router.get('/cloudflare-token', async (_req: Request, res: Response) => {
  try {
    const token = await getStoredToken();
    return res.json({
      configured: Boolean(token),
      tokenMasked: maskToken(token),
      permissionExplanation: PERMISSION_EXPLANATION,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load Cloudflare settings.' });
  }
});

router.put('/cloudflare-token', validateBody(schemas.cloudflareTokenUpdate), async (req: Request, res: Response) => {
  const token = req.body.token;

  try {
    await query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [CLOUDFLARE_TOKEN_KEY, token]
    );
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: CLOUDFLARE_TOKEN_KEY,
      result: 'success',
    }).catch(() => {});

    return res.json({
      configured: true,
      tokenMasked: maskToken(token),
      permissionExplanation: PERMISSION_EXPLANATION,
      message: 'Cloudflare token saved successfully.',
    });
  } catch {
    return res.status(500).json({ error: 'Unable to save Cloudflare token.' });
  }
});

router.post('/cloudflare-token/test', validateBody(schemas.cloudflareTokenTest), async (req: Request, res: Response) => {
  try {
    const providedToken = req.body.token || '';
    const token = providedToken || (await getStoredToken());

    if (!isValidToken(token)) {
      return res.status(400).json({ error: 'No valid Cloudflare token is available to test.' });
    }

    const result = await verifyCloudflareToken(token);
    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json({
      success: true,
      message: result.message,
    });
  } catch {
    return res.status(502).json({ error: 'Unable to reach Cloudflare to verify the token.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/exposure — read first-start exposure provisioning config
// ---------------------------------------------------------------------------
router.get('/exposure', async (_req: Request, res: Response) => {
  try {
    const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
      Object.values(EXPOSURE_SETTINGS_KEYS),
    ]);
    const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

    return res.json({
      configured: Boolean(
        values[EXPOSURE_SETTINGS_KEYS.baseDomain] &&
          values[EXPOSURE_SETTINGS_KEYS.npmApiUrl] &&
          values[EXPOSURE_SETTINGS_KEYS.npmEmail] &&
          values[EXPOSURE_SETTINGS_KEYS.npmPassword] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareAccountId] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareZoneId] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId]
      ),
      baseDomain: values[EXPOSURE_SETTINGS_KEYS.baseDomain] ?? null,
      npmApiUrl: values[EXPOSURE_SETTINGS_KEYS.npmApiUrl] ?? null,
      npmEmail: values[EXPOSURE_SETTINGS_KEYS.npmEmail] ?? null,
      npmPasswordConfigured: Boolean(values[EXPOSURE_SETTINGS_KEYS.npmPassword]),
      cloudflareAccountId: values[EXPOSURE_SETTINGS_KEYS.cloudflareAccountId] ?? null,
      cloudflareZoneId: values[EXPOSURE_SETTINGS_KEYS.cloudflareZoneId] ?? null,
      cloudflareTunnelId: values[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId] ?? null,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load exposure settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/exposure — save first-start exposure provisioning config
// ---------------------------------------------------------------------------
router.put('/exposure', validateBody(schemas.exposureGlobalSettings), async (req: Request, res: Response) => {
  const values: Record<string, string> = {
    [EXPOSURE_SETTINGS_KEYS.baseDomain]: req.body.baseDomain,
    [EXPOSURE_SETTINGS_KEYS.npmApiUrl]: req.body.npmApiUrl.replace(/\/+$/, ''),
    [EXPOSURE_SETTINGS_KEYS.npmEmail]: req.body.npmEmail,
    [EXPOSURE_SETTINGS_KEYS.cloudflareAccountId]: req.body.cloudflareAccountId,
    [EXPOSURE_SETTINGS_KEYS.cloudflareZoneId]: req.body.cloudflareZoneId,
    [EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId]: req.body.cloudflareTunnelId,
  };

  // Only overwrite the stored password when a new one was supplied, so a
  // save with the password field left blank keeps the existing value.
  if (req.body.npmPassword) {
    values[EXPOSURE_SETTINGS_KEYS.npmPassword] = req.body.npmPassword;
  }

  try {
    for (const [key, value] of Object.entries(values)) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'exposure_config',
      result: 'success',
    }).catch(() => {});

    return res.json({ message: 'Exposure settings saved successfully.' });
  } catch {
    return res.status(500).json({ error: 'Unable to save exposure settings.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/exposure/test — validate the saved NPM credentials and
// Cloudflare account/zone/tunnel access on demand, without provisioning
// anything. Tests the currently saved config, same as what a service start
// would use.
// ---------------------------------------------------------------------------
router.post('/exposure/test', async (_req: Request, res: Response) => {
  let config;
  try {
    config = await getExposureConfig();
  } catch {
    return res.status(500).json({ error: 'Unable to load exposure settings.' });
  }

  if (!config) {
    return res.status(400).json({ error: 'Exposure settings are incomplete — save all fields before testing.' });
  }

  const npmResult = await testNpmConnection(config.npmApiUrl, config.npmEmail, config.npmPassword)
    .then(() => ({ success: true, message: 'Nginx Proxy Manager login succeeded.' }))
    .catch((error: Error) => ({ success: false, message: error.message }));

  const cloudflareResult = await testCloudflareTunnelAccess({
    apiToken: config.cloudflareApiToken,
    accountId: config.cloudflareAccountId,
    zoneId: config.cloudflareZoneId,
    tunnelId: config.cloudflareTunnelId,
  })
    .then(() => ({ success: true, message: 'Cloudflare account, zone, and tunnel access verified.' }))
    .catch((error: Error) => ({ success: false, message: error.message }));

  return res.json({
    success: npmResult.success && cloudflareResult.success,
    npm: npmResult,
    cloudflare: cloudflareResult,
  });
});

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
    for (const [key, value] of Object.entries(values)) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value]
      );
    }

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'mail_config',
      result: 'success',
    }).catch(() => {});

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

// ---------------------------------------------------------------------------
// GET /api/settings/general — read general dashboard settings (timezone)
// ---------------------------------------------------------------------------
router.get('/general', async (_req: Request, res: Response) => {
  try {
    return res.json({
      timezone: await getAppTimezone(),
      defaultTimezone: DEFAULT_TIMEZONE,
      // A snapshot of what this Node build recognises, for the UI picker.
      timezones: Intl.supportedValuesOf('timeZone'),
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load general settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/general — update general dashboard settings
// Applies to every managed app that reads ${TZ} and hasn't pinned its own in
// that app's .env; takes effect the next time each app is started/restarted.
// ---------------------------------------------------------------------------
router.put('/general', async (req: Request, res: Response) => {
  const timezone = req.body?.timezone;
  if (!isValidTimezone(timezone)) {
    return res.status(400).json({ error: 'Unknown timezone. Use an IANA name like "Europe/Lisbon".' });
  }

  try {
    await setAppTimezone(timezone);
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'app_timezone',
      result: 'success',
    }).catch(() => {});

    return res.json({ timezone, message: 'Timezone saved. Restart apps to apply.' });
  } catch {
    return res.status(500).json({ error: 'Unable to save general settings.' });
  }
});

export default router;
