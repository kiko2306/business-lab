// Settings routes: First-start exposure provisioning config (`exposure:settings`).
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { query } from '../../utils/database';
import { writeAuditLog } from '../../utils/audit';
import { schemas, validateBody } from '../../middleware/validation';
import {
  EXPOSURE_SETTINGS_KEYS,
  getExposureConfig,
  getNpmApiUrl,
} from '../../utils/exposureSettings';
import { resolveCloudflareIds } from '../../services/exposureIds';
import { testNpmConnection } from '../../services/npmClient';
import { testCloudflareTunnelAccess } from '../../services/cloudflareTunnelClient';
import { setSettings } from '../../utils/settingsStore';
import { getStoredToken } from './cloudflare';

const router = Router();

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
          values[EXPOSURE_SETTINGS_KEYS.npmEmail] &&
          values[EXPOSURE_SETTINGS_KEYS.npmPassword] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareAccountId] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareZoneId] &&
          values[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId]
      ),
      baseDomain: values[EXPOSURE_SETTINGS_KEYS.baseDomain] ?? null,
      // Derived, read-only — shown so an operator can see where the tunnel
      // origin points without it being hand-editable (plan.md §253).
      npmApiUrl: await getNpmApiUrl(),
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
  let ids: { cloudflareAccountId: string; cloudflareZoneId: string };
  try {
    ids = await resolveCloudflareIds({
      baseDomain: req.body.baseDomain,
      token: await getStoredToken(),
      cloudflareAccountId: req.body.cloudflareAccountId,
      cloudflareZoneId: req.body.cloudflareZoneId,
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to look up the Cloudflare account and zone.' });
  }

  const values: Record<string, string> = {
    [EXPOSURE_SETTINGS_KEYS.baseDomain]: req.body.baseDomain,
    [EXPOSURE_SETTINGS_KEYS.npmEmail]: req.body.npmEmail,
    [EXPOSURE_SETTINGS_KEYS.cloudflareAccountId]: ids.cloudflareAccountId,
    [EXPOSURE_SETTINGS_KEYS.cloudflareZoneId]: ids.cloudflareZoneId,
    [EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId]: req.body.cloudflareTunnelId,
  };

  // Only overwrite the stored password when a new one was supplied, so a
  // save with the password field left blank keeps the existing value.
  if (req.body.npmPassword) {
    values[EXPOSURE_SETTINGS_KEYS.npmPassword] = req.body.npmPassword;
  }

  try {
    await setSettings(values);

    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'exposure_config',
      result: 'success',
    });

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

export default router;
