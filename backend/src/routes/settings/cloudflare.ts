// Settings routes: Cloudflare API token and account model (the webmaster's `exposure:settings` remit).
// Mounted, behind the capability gate, by ./index.ts.
import { Router, Request, Response } from 'express';
import { query } from '../../utils/database';
import { writeAuditLog } from '../../utils/audit';
import { schemas, validateBody } from '../../middleware/validation';
import { countTokenZones, verifyCloudflareToken } from '../../services/cloudflareTunnelClient';
import { openSettingValue, setSetting } from '../../utils/settingsStore';

const router = Router();

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

export async function getStoredToken(): Promise<string | null> {
  const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [CLOUDFLARE_TOKEN_KEY]);
  const stored = result.rows[0]?.value;
  return stored ? openSettingValue(CLOUDFLARE_TOKEN_KEY, stored) : null;
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
      await setSetting(CLOUDFLARE_ACCOUNT_MODEL_KEY, req.body.model);
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
    await setSetting(CLOUDFLARE_TOKEN_KEY, token);
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

export default router;
