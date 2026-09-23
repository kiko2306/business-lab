import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { subscribe, unsubscribeByToken } from '../services/advertSubscribers';

const router = Router();

// Public and unauthenticated — an outside site's own signup form, or an
// email client following the unsubscribe link, has no dashboard session.
// Same generous-but-bounded shape as accessRequests.ts.
const subscribersLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// POST /api/subscribers — meant to be called as a plain HTML
// <form method="post"> from an external site, not fetch(): a bare form
// submit isn't subject to CORS, so this needs no CORS/origin change. On
// success, bounces back to the caller-supplied `redirect` if present, else
// a built-in confirmation page — the caller may have no page of its own to
// land on.
router.post('/', subscribersLimiter, validateBody(schemas.subscriberSubscribe), async (req: Request, res: Response) => {
  const { email, redirect } = req.body as { email: string; redirect?: string };
  try {
    await subscribe(email);
    if (redirect) {
      return res.redirect(303, redirect);
    }
    return res
      .status(200)
      .type('html')
      .send('<!doctype html><html><body><p>You’re subscribed.</p></body></html>');
  } catch (err) {
    console.error('Subscribe error:', (err as Error).message);
    return res.status(500).json({ error: 'Could not subscribe. Try again later.' });
  }
});

// GET /api/subscribers/unsubscribe/:token — what the frontend's
// /unsubscribe/:token page calls to both perform the unsubscribe and learn
// the result to render (plan.md §612).
router.get(
  '/unsubscribe/:token',
  subscribersLimiter,
  validateParams(schemas.subscriberToken),
  async (req: Request, res: Response) => {
    try {
      await unsubscribeByToken(req.params.token);
      return res.status(204).send();
    } catch (err) {
      console.error('Unsubscribe error:', (err as Error).message);
      return res.status(500).json({ error: 'Could not unsubscribe. Try again later.' });
    }
  }
);

export default router;
