import https from 'https';
import { isIP } from 'net';
import { Router, Request, Response } from 'express';
import { query } from '../utils/database';
import { writeAuditLog } from '../utils/audit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { requireCapability } from '../middleware/requireCapability';
import {
  BACKUP_TARGET_KEYS,
  getBackupTarget,
  isMountedKind,
  toKopiaRepositoryMount,
  toMountSpec,
  validateTarget,
} from '../utils/backupTarget';
import { testBackupTarget } from '../services/backupTargetTest';
import { applyKopiaTarget } from '../services/kopiaTargetApply';
import { checkKopiaConnection } from '../services/kopiaClient';
import { readAppEnvValue } from '../services/appEnv';
import { MAIL_SETTINGS_KEYS, defaultPort, getMailConfig } from '../utils/mailSettings';
import { testMailConnection } from '../services/mailTest';
import { EXPOSURE_SETTINGS_KEYS, getExposureConfig, getNpmApiUrl } from '../utils/exposureSettings';
import {
  DEFAULT_TIMEZONE,
  DEFAULT_UPDATE_BRANCH,
  getAppTimezone,
  getDashboardBaseUrl,
  getStoredDashboardUrl,
  getUpdateBranch,
  isValidBranchName,
  isValidDashboardUrl,
  isValidTimezone,
  setAppTimezone,
  setDashboardUrl,
  setUpdateBranch,
} from '../utils/generalSettings';
import {
  ALERT_CATEGORIES,
  AlertSource,
  appsToApplyAlertSettings,
  getAlertNotifyConfig,
  isValidAlertTopic,
  setAlertCategoryEnabled,
  setAlertCategoryTopic,
} from '../utils/alertNotify';
import { restartService } from '../services/executor';
import logger from '../utils/logger';
import { getService } from '../config/services';
import { CrowdsecUnavailableError, listCrowdsecBans, unbanCrowdsecIp } from '../services/crowdsecBans';
import { runAlertTest } from '../services/alertTest';
import { testNpmConnection } from '../services/npmClient';
import { testCloudflareTunnelAccess, countTokenZones } from '../services/cloudflareTunnelClient';
import {
  AI_FEATURES,
  AI_PROVIDERS,
  AiFeature,
  AiProviderId,
  getAiApiKey,
  getFeatureProvider,
  maskAiApiKey,
  setAiApiKey,
  setFeatureProvider,
} from '../utils/aiSettings';
import { testAiProviderKey } from '../services/aiProviderTest';
import { syncMealieAiProvider } from '../services/mealieAiSync';
import { getDeploymentStatus } from '../services/deploymentStatus';

const router = Router();

/**
 * Capability gate for the whole settings router (plan.md §149). The Cloudflare
 * token and exposure-provisioning routes are the webmaster's remit
 * (`exposure:settings`); everything else — timezone, ntfy, mail, backup
 * destination — is the IT admin's (`settings:manage`). The split matches the
 * two frontend pages: `/exposure` calls the first group, `/settings` the rest.
 */
router.use((req: Request, res: Response, next) => {
  const isExposure =
    req.path.startsWith('/cloudflare-') || req.path.startsWith('/exposure');
  return requireCapability(isExposure ? 'exposure:settings' : 'settings:manage')(req, res, next);
});

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';
// Per-deployment contract term: 'self-controlled' (client runs their own
// Cloudflare account) or 'contracted' (a reseller-managed account). Recorded
// only — nothing branches on it; the provisioning flow supports both
// (plan.md §203/§357 P9b).
const CLOUDFLARE_ACCOUNT_MODEL_KEY = 'cloudflare_account_model';
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
    const modelRow = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [
      CLOUDFLARE_ACCOUNT_MODEL_KEY,
    ]);
    return res.json({
      configured: Boolean(token),
      tokenMasked: maskToken(token),
      permissionExplanation: PERMISSION_EXPLANATION,
      accountModel: modelRow.rows[0]?.value ?? null,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load Cloudflare settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/cloudflare-account-model — record self-controlled vs
// contracted (plan.md §203/§357 P9b). For the record; nothing branches on it.
// ---------------------------------------------------------------------------
router.put(
  '/cloudflare-account-model',
  validateBody(schemas.cloudflareAccountModel),
  async (req: Request, res: Response) => {
    try {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [CLOUDFLARE_ACCOUNT_MODEL_KEY, req.body.model]
      );
      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'settings_change',
        resource: CLOUDFLARE_ACCOUNT_MODEL_KEY,
        result: 'success',
      });
      return res.json({ accountModel: req.body.model, message: 'Cloudflare account model saved.' });
    } catch {
      return res.status(500).json({ error: 'Unable to save the Cloudflare account model.' });
    }
  }
);

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
    });

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

    // A token that can see more than one zone is account-wide, not
    // zone-scoped — for a reseller-managed account that means a leak reaches
    // every client's DNS (plan.md §202/§357 P9b). Not a failure; just flagged.
    // Needs Zone:Read, so a token without it silently skips the check.
    let zoneCount: number | undefined;
    let warning: string | undefined;
    try {
      zoneCount = await countTokenZones(token);
      if (zoneCount > 1) {
        warning =
          `This token can see ${zoneCount} Cloudflare zones. Scope it to a single zone ` +
          `(Zone Resources → Include → Specific zone) so a leaked token can't reach another ` +
          `deployment's DNS — required for a reseller-managed (contracted) account.`;
      }
    } catch {
      // Zone listing is best-effort; its absence doesn't invalidate the token.
    }

    return res.json({
      success: true,
      message: result.message,
      ...(zoneCount !== undefined ? { zoneCount } : {}),
      ...(warning ? { warning } : {}),
    });
  } catch {
    return res.status(502).json({ error: 'Unable to reach Cloudflare to verify the token.' });
  }
});

// ---------------------------------------------------------------------------
// AI API keys — one third-party token per provider (Anthropic, Google
// Gemini, Groq), entered once, used by content generation (§84.3) and
// Mealie AI parsing (§238). Generalized from a single Anthropic-only "Claude
// API key" in plan.md §610. Same shape as the Cloudflare token above: masked
// on read, overwrite on write, verify on test — plus which provider is
// active for each feature.
// ---------------------------------------------------------------------------
router.get('/ai-keys', async (_req: Request, res: Response) => {
  try {
    const providers = await Promise.all(
      AI_PROVIDERS.map(async (definition) => {
        const key = await getAiApiKey(definition.id);
        return { provider: definition.id, label: definition.label, configured: Boolean(key), keyMasked: maskAiApiKey(key) };
      })
    );
    const features = Object.fromEntries(
      await Promise.all(AI_FEATURES.map(async (feature) => [feature, await getFeatureProvider(feature)]))
    ) as Record<AiFeature, AiProviderId>;
    return res.json({ providers, features });
  } catch {
    return res.status(500).json({ error: 'Unable to load the AI API keys.' });
  }
});

router.put(
  '/ai-keys/:provider',
  validateParams(schemas.aiProviderIdParam),
  validateBody(schemas.aiKeyUpdate),
  async (req: Request, res: Response) => {
    const provider = req.params.provider as AiProviderId;
    try {
      const key = req.body.apiKey.trim();
      await setAiApiKey(provider, key);
      await writeAuditLog({
        userId: req.user?.id ?? null,
        action: 'settings_change',
        resource: `ai_api_key_${provider}`,
        result: 'success',
      });

      // Push the new key into Mealie's AI recipe parser if this is the
      // provider configured for it, and it's running (§238). Detached: the
      // reconcile polls Mealie for up to a minute, and a Mealie start
      // re-runs it anyway (executor.ts), so the response never waits.
      void syncMealieAiProvider('mealie').catch(() => {});

      return res.json({ configured: true, keyMasked: maskAiApiKey(key), message: 'API key saved.' });
    } catch {
      return res.status(500).json({ error: 'Unable to save the AI API key.' });
    }
  }
);

router.post(
  '/ai-keys/:provider/test',
  validateParams(schemas.aiProviderIdParam),
  validateBody(schemas.aiKeyTest),
  async (req: Request, res: Response) => {
    const provider = req.params.provider as AiProviderId;
    const key = (req.body.apiKey || '').trim() || (await getAiApiKey(provider));
    if (!key) {
      return res.status(400).json({ error: 'No API key to test — save one first.' });
    }

    try {
      const result = await testAiProviderKey(provider, key);
      return res.status(result.success ? 200 : 400).json(result);
    } catch {
      return res.status(502).json({ error: 'Unable to reach the provider to verify the key.' });
    }
  }
);

router.put('/ai-feature-provider', validateBody(schemas.aiFeatureProviderUpdate), async (req: Request, res: Response) => {
  const feature = req.body.feature as AiFeature;
  const provider = req.body.provider as AiProviderId;
  try {
    await setFeatureProvider(feature, provider);
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: `ai_provider_${feature}`,
      metadata: { provider },
      result: 'success',
    });

    // Same reasoning as the key save above — apply immediately if it's the
    // Mealie feature and Mealie is running.
    if (feature === 'mealie_parse') {
      void syncMealieAiProvider('mealie').catch(() => {});
    }

    return res.json({ feature, provider });
  } catch {
    return res.status(500).json({ error: 'Unable to save the AI provider selection.' });
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
  const values: Record<string, string> = {
    [EXPOSURE_SETTINGS_KEYS.baseDomain]: req.body.baseDomain,
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

// ---------------------------------------------------------------------------
// GET /api/settings/backup-target — where backups are written.
// ---------------------------------------------------------------------------
router.get('/backup-target', async (_req: Request, res: Response) => {
  try {
    const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
      Object.values(BACKUP_TARGET_KEYS),
    ]);
    const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

    return res.json({
      // Unconfigured is meaningfully different from "set to a local disk":
      // until this is chosen, backups sit beside the data they protect.
      configured: Boolean(values[BACKUP_TARGET_KEYS.kind]),
      kind: values[BACKUP_TARGET_KEYS.kind] ?? 'disk',
      path: values[BACKUP_TARGET_KEYS.path] ?? null,
      server: values[BACKUP_TARGET_KEYS.server] ?? null,
      share: values[BACKUP_TARGET_KEYS.share] ?? null,
      username: values[BACKUP_TARGET_KEYS.username] ?? null,
      passwordConfigured: Boolean(values[BACKUP_TARGET_KEYS.password]),
      options: values[BACKUP_TARGET_KEYS.options] ?? null,
    });
  } catch {
    return res.status(500).json({ error: 'Unable to load the backup destination.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/backup-target
// ---------------------------------------------------------------------------
router.put('/backup-target', validateBody(schemas.backupTarget), async (req: Request, res: Response) => {
  const existing = await getBackupTarget();
  const target = {
    kind: req.body.kind,
    path: (req.body.path ?? '').trim(),
    server: (req.body.server ?? '').trim(),
    share: (req.body.share ?? '').trim(),
    username: (req.body.username ?? '').trim(),
    // Keep the stored password when the field is left blank.
    password: req.body.password || existing?.password || '',
    options: (req.body.options ?? '').trim(),
  };

  const problem = validateTarget(target);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const values: Record<string, string> = {
    [BACKUP_TARGET_KEYS.kind]: target.kind,
    [BACKUP_TARGET_KEYS.path]: target.path,
    [BACKUP_TARGET_KEYS.server]: target.server,
    [BACKUP_TARGET_KEYS.share]: target.share,
    [BACKUP_TARGET_KEYS.username]: target.username,
    [BACKUP_TARGET_KEYS.options]: target.options,
  };
  // Secrets only overwrite when supplied, so saving with the field blank keeps
  // the stored value — same convention as every other credential here.
  if (req.body.password) values[BACKUP_TARGET_KEYS.password] = req.body.password;

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
      resource: 'backup_target',
      result: 'success',
    });

    // Saving alone leaves Kopia mounted at the previous destination while the
    // UI claims otherwise, so apply it here rather than asking the user to
    // remember a restart — and a restart alone is not enough, because Docker
    // reuses a named volume whose definition changed (see kopiaTargetApply).
    const applied = await applyKopiaTarget(target);

    return res.json({
      message: applied.detail,
      restarted: applied.restarted,
      // No Docker mount at all for s3 (§221) or ftp (§267) — toMountSpec
      // throws for those on purpose, so the mount details are simply omitted.
      ...(isMountedKind(target.kind)
        ? { mount: toMountSpec(target), kopiaRepository: toKopiaRepositoryMount(target) }
        : {}),
    });
  } catch {
    return res.status(500).json({ error: 'Unable to save the backup destination.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/backup-target/kopia-status — polled by the destination
// save modal after PUT above recreates the container, since `docker compose
// up -d` returns as soon as the container starts, well before its entrypoint
// has actually reconnected (or failed to) against the new destination
// (plan.md §581).
// ---------------------------------------------------------------------------
router.get('/backup-target/kopia-status', async (_req: Request, res: Response) => {
  const password = readAppEnvValue('kopia', 'KOPIA_SERVER_PASSWORD');
  if (!password) {
    return res.json({ ok: false, detail: 'Kopia has no password configured yet.' });
  }
  return res.json(await checkKopiaConnection(password));
});

// ---------------------------------------------------------------------------
// POST /api/settings/backup-target/test — mount it and write to it.
// ---------------------------------------------------------------------------
router.post('/backup-target/test', async (_req: Request, res: Response) => {
  const target = await getBackupTarget();
  if (!target) {
    return res.status(400).json({ error: 'No backup destination is configured yet.' });
  }
  const problem = validateTarget(target);
  if (problem) {
    return res.status(400).json({ error: problem });
  }

  const result = await testBackupTarget(target);
  return res.status(result.success ? 200 : 400).json(result);
});

// ---------------------------------------------------------------------------
// GET /api/settings/deployment — the per-client provisioning checklist
// (plan.md §357 P9a). Read-only; derived from the same settings the sections
// above read, so an operator provisioning a new box sees what is still blank.
// ---------------------------------------------------------------------------
router.get('/deployment', async (_req: Request, res: Response) => {
  try {
    return res.json(await getDeploymentStatus());
  } catch {
    return res.status(500).json({ error: 'Unable to load the deployment checklist.' });
  }
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
      // What the operator has set (may be ''); `dashboardUrlEffective` is what
      // the invite links (plan.md §158) will actually use — the stored value
      // or a `dashboard.<domain>` guess, or null if neither is available.
      dashboardUrl: await getStoredDashboardUrl(),
      dashboardUrlEffective: await getDashboardBaseUrl(),
      // Which branch the self-update panel (Update page) fetches/pulls —
      // plan.md §406. `main` unless this deployment tracks something else
      // (e.g. `beta` on a test box that stages ahead of production).
      updateBranch: await getUpdateBranch(),
      defaultUpdateBranch: DEFAULT_UPDATE_BRANCH,
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

  // Optional; '' clears it (back to the derived guess). Anything else must be
  // a bare absolute http(s) origin.
  const dashboardUrl = req.body?.dashboardUrl;
  const hasDashboardUrl = dashboardUrl !== undefined && dashboardUrl !== null;
  if (hasDashboardUrl && dashboardUrl !== '' && !isValidDashboardUrl(dashboardUrl)) {
    return res.status(400).json({ error: 'Dashboard URL must be a full https:// address with no path.' });
  }

  // Optional; '' (or omitted) resets to the default (main). Anything else
  // must look like a real branch name — it's interpolated into a git argv.
  const updateBranch = req.body?.updateBranch;
  const hasUpdateBranch = updateBranch !== undefined && updateBranch !== null;
  if (hasUpdateBranch && updateBranch !== '' && !isValidBranchName(updateBranch)) {
    return res.status(400).json({ error: 'Update branch must be a plain git branch name.' });
  }

  try {
    await setAppTimezone(timezone);
    if (hasDashboardUrl) {
      await setDashboardUrl(dashboardUrl);
    }
    if (hasUpdateBranch) {
      await setUpdateBranch(updateBranch || DEFAULT_UPDATE_BRANCH);
    }
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: [
        'app_timezone',
        hasDashboardUrl && 'dashboard_url',
        hasUpdateBranch && 'update_branch',
      ]
        .filter(Boolean)
        .join(', '),
      result: 'success',
    });

    return res.json({
      timezone,
      ...(hasDashboardUrl ? { dashboardUrl: await getStoredDashboardUrl() } : {}),
      ...(hasUpdateBranch ? { updateBranch: await getUpdateBranch() } : {}),
      message: 'Settings saved. Restart apps to apply the timezone.',
    });
  } catch {
    return res.status(500).json({ error: 'Unable to save general settings.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings/alerts — the shared ntfy alert topic + per-source flags
// ---------------------------------------------------------------------------
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    return res.json(await getAlertNotifyConfig());
  } catch {
    return res.status(500).json({ error: 'Unable to load alert settings.' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings/alerts — set a category's topic and/or enabled flag
// (§609: no more shared default topic, no separate Enforcement switch).
// A CrowdSec change takes effect on the next CrowdSec (re)start:
// services/crowdsecConfig.ts re-renders profiles.yaml + notifications/http.yaml.
// ---------------------------------------------------------------------------
router.put('/alerts', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  // { topics: { crowdsec?: string, 'critical-service'?: string, ... } }.
  // An empty string clears that category's override back to DEFAULT_ALERT_TOPIC.
  const topicsBody: Record<string, unknown> = typeof body.topics === 'object' && body.topics !== null ? body.topics : {};
  const changedTopics = Object.keys(topicsBody) as AlertSource[];
  // { enabled: { crowdsec?: boolean, ... } }.
  const enabledBody: Record<string, unknown> = typeof body.enabled === 'object' && body.enabled !== null ? body.enabled : {};
  const changedEnabled = Object.keys(enabledBody) as AlertSource[];

  if (!changedTopics.length && !changedEnabled.length) {
    return res.status(400).json({ error: 'Provide "topics" and/or "enabled".' });
  }
  for (const category of changedTopics) {
    if (!ALERT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Unknown alert category "${category}".` });
    }
    const value = topicsBody[category];
    if (value !== '' && !isValidAlertTopic(value)) {
      return res.status(400).json({
        error: `"${category}" topic must be empty (to clear it) or 1–64 characters: letters, digits, hyphens and underscores only.`,
      });
    }
  }
  for (const category of changedEnabled) {
    if (!ALERT_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Unknown alert category "${category}".` });
    }
    if (typeof enabledBody[category] !== 'boolean') {
      return res.status(400).json({ error: `"${category}" enabled must be true or false.` });
    }
  }

  try {
    for (const category of changedTopics) {
      await setAlertCategoryTopic(category, topicsBody[category] as string);
    }
    for (const category of changedEnabled) {
      await setAlertCategoryEnabled(category, enabledBody[category] as boolean);
    }
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'ntfy_alerts',
      result: 'success',
      metadata: {
        ...(changedTopics.length ? { topics: topicsBody } : {}),
        ...(changedEnabled.length ? { enabled: enabledBody } : {}),
      },
    });

    // Apply now, not "on the next restart" (§532). Each of these settings is
    // rendered into its app's config only when that app starts, and saving
    // used to stop at "Restart CrowdSec to apply" (n8n wasn't even
    // mentioned). The next restart was a host reboot, which re-uses the stale
    // files, so alerts stayed off for days (§531). restartService re-renders
    // and recreates, and leaves an app that isn't running alone: its next
    // start renders the same config.
    const restarted: string[] = [];
    const notRunning: string[] = [];
    const failed: string[] = [];
    const appsToApply = appsToApplyAlertSettings({
      crowdsecTopic: changedTopics.includes('crowdsec'),
      criticalServiceTopic: changedTopics.includes('critical-service'),
      crowdsec: changedEnabled.includes('crowdsec'),
    });
    for (const app of appsToApply) {
      const label = getService(app)?.label ?? app;
      try {
        const result = await restartService(app, req.user!.id);
        (result.message.includes('not currently running') ? notRunning : restarted).push(label);
      } catch (error) {
        logger.error(`Applying alert settings: restart of ${app} failed`, { error: (error as { message?: string }).message });
        failed.push(label);
      }
    }

    const saved = await getAlertNotifyConfig();
    const parts = ['Saved.'];
    if (restarted.length) parts.push(`Applied: restarted ${restarted.join(', ')}.`);
    if (notRunning.length) parts.push(`${notRunning.join(', ')} not running; applies when started.`);
    if (failed.length) parts.push(`Could not restart ${failed.join(', ')}; restart it from Apps to apply.`);
    if (saved.enabled.crowdsec && changedEnabled.includes('crowdsec')) {
      parts.push('Subscribe to the topic in ntfy to receive pushes.');
    }
    return res.json({ ...saved, applied: failed.length === 0, message: parts.join(' ') });
  } catch {
    return res.status(500).json({ error: 'Unable to save alert settings.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/settings/alerts/test — fire a sample alert down one source's path
// ---------------------------------------------------------------------------
router.post('/alerts/test', async (req: Request, res: Response) => {
  const source = req.body?.source;
  if (!ALERT_CATEGORIES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${ALERT_CATEGORIES.join(', ')}.` });
  }

  const result = await runAlertTest(source as AlertSource);
  await writeAuditLog({
    userId: req.user?.id ?? null,
    action: 'settings_change',
    resource: 'ntfy_alerts_test',
    result: result.ok ? 'success' : 'failure',
    metadata: { source },
  });

  return res.status(result.ok ? 200 : 502).json(result);
});

// ---------------------------------------------------------------------------
// GET /api/settings/crowdsec/bans — this host's active bans, one row per IP
// DELETE /api/settings/crowdsec/bans?ip= — lift every ban on that IP
// Through CrowdSec's local API as the `dashboard` machine (§540), so a false
// positive (the operator's own IP, §538) needs no `cscli` on the host.
// ---------------------------------------------------------------------------
router.get('/crowdsec/bans', async (_req: Request, res: Response) => {
  try {
    return res.json({ bans: await listCrowdsecBans() });
  } catch (error) {
    if (error instanceof CrowdsecUnavailableError) return res.status(503).json({ error: error.message });
    logger.error('Listing CrowdSec bans failed', { error: (error as Error).message });
    return res.status(500).json({ error: 'Unable to list CrowdSec bans.' });
  }
});

router.delete('/crowdsec/bans', async (req: Request, res: Response) => {
  const ip = typeof req.query.ip === 'string' ? req.query.ip.trim() : '';
  if (!isIP(ip)) {
    return res.status(400).json({ error: 'ip must be an IPv4 or IPv6 address.' });
  }
  try {
    const removed = await unbanCrowdsecIp(ip);
    await writeAuditLog({
      userId: req.user?.id ?? null,
      action: 'settings_change',
      resource: 'crowdsec_unban',
      result: 'success',
      metadata: { ip, removed },
    });
    return res.json({
      removed,
      message: removed
        ? `Unbanned ${ip}. Nginx Proxy Manager lets it through within about 10 seconds.`
        : `${ip} had no active ban.`,
    });
  } catch (error) {
    if (error instanceof CrowdsecUnavailableError) return res.status(503).json({ error: error.message });
    logger.error('CrowdSec unban failed', { ip, error: (error as Error).message });
    return res.status(500).json({ error: 'Unable to unban that IP.' });
  }
});

export default router;
