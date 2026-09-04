import { Router, Request, Response } from 'express';
import logger from '../utils/logger';
import { checkForUpdate, getSelfUpdateStatus, triggerSelfUpdate } from '../services/selfUpdate';
import { HttpError } from '../types';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getSelfUpdateStatus();
    return res.json(status);
  } catch (error) {
    logger.error('Unable to load self-update status', { error: (error as Error).message });
    return res.status(500).json({ error: 'Unable to load self-update status.' });
  }
});

router.post('/check', async (_req: Request, res: Response) => {
  try {
    const check = await checkForUpdate();
    return res.json(check);
  } catch (error) {
    const httpError = error as HttpError;
    logger.error('Self-update check failed', { error: httpError.message });
    return res.status(httpError.statusCode ?? 500).json({ error: httpError.message || 'Unable to check for updates.' });
  }
});

router.post('/trigger', async (req: Request, res: Response) => {
  const userId = req.user?.id ?? null;
  try {
    const run = await triggerSelfUpdate(userId);
    return res.status(202).json(run);
  } catch (error) {
    const httpError = error as HttpError;
    logger.error('Self-update trigger failed', { error: httpError.message, userId });
    return res.status(httpError.statusCode ?? 500).json({ error: httpError.message || 'Unable to start the self-update.' });
  }
});

export default router;
