// Settings routes: CrowdSec bans listed and lifted from Settings.
// Mounted, behind the capability gate, by ./index.ts.
import { isIP } from 'net';
import { Router, Request, Response } from 'express';
import { writeAuditLog } from '../../utils/audit';
import logger from '../../utils/logger';
import {
  CrowdsecUnavailableError,
  listCrowdsecBans,
  unbanCrowdsecIp,
} from '../../services/crowdsecBans';

const router = Router();

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
