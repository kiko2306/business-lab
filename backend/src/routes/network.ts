/**
 * Network scan API route — Utils section of the dashboard.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { scanLan } from '../services/networkScan';
import logger from '../utils/logger';

const router = Router();

// A scan launches a container and sweeps the whole LAN, ~10s — cheap enough
// for an operator to click a few times, expensive enough to not leave
// unthrottled on an authenticated route.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many network scans, please try again later.' },
});

/**
 * POST /api/network/scan
 * Discover devices on the LAN (hostname, MAC-vendor type, IP).
 */
router.post('/scan', scanLimiter, async (_req: Request, res: Response) => {
  try {
    const hosts = await scanLan();
    res.json({ hosts });
  } catch (error) {
    logger.error('Network scan failed', { error: error instanceof Error ? error.message : error });
    res.status(502).json({ error: 'Network scan failed' });
  }
});

export default router;
