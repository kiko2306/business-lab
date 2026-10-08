import { Router, Request, Response } from 'express';
import { requireCapability } from '../../middleware/requireCapability';
import cloudflareRouter from './cloudflare';
import aiRouter from './ai';
import exposureRouter from './exposure';
import mailRouter from './mail';
import backupTargetRouter from './backupTarget';
import generalRouter from './general';
import alertsRouter from './alerts';
import crowdsecRouter from './crowdsec';

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

// One router per concern (plan.md §903). The gate above sits in front of all of
// them, so no sub-router needs, or can forget, its own capability check.
router.use(cloudflareRouter);
router.use(aiRouter);
router.use(exposureRouter);
router.use(mailRouter);
router.use(backupTargetRouter);
router.use(generalRouter);
router.use(alertsRouter);
router.use(crowdsecRouter);

export default router;
