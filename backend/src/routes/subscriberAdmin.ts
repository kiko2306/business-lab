/**
 * The dashboard's view of the advert mailing list (plan.md §847), mounted
 * under /social/subscribers behind `settings:manage` in index.ts. The public
 * subscribe form and unsubscribe link live in subscribers.ts and stay open.
 */

import { Router, Request, Response } from 'express';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { addSubscriber, listAllSubscribers, removeSubscriber } from '../services/advertSubscribers';
import logger from '../utils/logger';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    return res.json({ subscribers: await listAllSubscribers() });
  } catch (error) {
    logger.error('Listing subscribers failed', { error: error instanceof Error ? error.message : error });
    return res.status(500).json({ error: 'Unable to load subscribers.' });
  }
});

router.post('/', validateBody(schemas.subscriberAdd), async (req: Request, res: Response) => {
  try {
    const outcome = await addSubscriber((req.body as { email: string }).email);
    if (outcome === 'unsubscribed') {
      return res.status(409).json({ error: 'This address unsubscribed. Only they can sign up again.' });
    }
    return res.status(outcome === 'added' ? 201 : 200).json({ result: outcome });
  } catch (error) {
    logger.error('Adding subscriber failed', { error: error instanceof Error ? error.message : error });
    return res.status(500).json({ error: 'Unable to add the subscriber.' });
  }
});

router.delete('/:id', validateParams(schemas.socialDraftIdParam), async (req: Request, res: Response) => {
  try {
    const removed = await removeSubscriber(Number(req.params.id));
    return removed ? res.status(204).send() : res.status(404).json({ error: 'Subscriber not found.' });
  } catch (error) {
    logger.error('Removing subscriber failed', { error: error instanceof Error ? error.message : error });
    return res.status(500).json({ error: 'Unable to remove the subscriber.' });
  }
});

export default router;
