import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas, validateBody, validateParams } from '../middleware/validation';
import { subscribe, unsubscribeByToken, resubscribeByToken, senderFromBaseUrl } from '../services/advertSubscribers';
import { getDashboardBaseUrl } from '../utils/generalSettings';

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

// POST /api/subscribers/unsubscribe/:token — what the frontend's
// /unsubscribe/:token page calls when the person taps its one button
// (plan.md §612, §854). A POST, not the GET it started as: mail gateways
// (Safe Links, Proofpoint, Mimecast) open every link in a browser that runs
// scripts, and a GET that mutates would unsubscribe a customer who never
// tapped anything. Idempotent: a second tap or an old link just succeeds.
router.post(
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

// POST /api/subscribers/resubscribe/:token — "Changed your mind?" on the unsubscribe
// page (plan.md §854). The person's own token, so it is the person speaking. A POST
// for the same scanner reason as unsubscribe.
router.post(
  '/resubscribe/:token',
  subscribersLimiter,
  validateParams(schemas.subscriberToken),
  async (req: Request, res: Response) => {
    try {
      await resubscribeByToken(req.params.token);
      return res.status(204).send();
    } catch (err) {
      console.error('Resubscribe error:', (err as Error).message);
      return res.status(500).json({ error: 'Could not subscribe again. Try again later.' });
    }
  }
);

// GET /api/subscribers/sender — whose emails these are, for the unsubscribe page to say.
// Reads nothing about any subscriber and changes nothing, so a link scanner cannot hurt it.
router.get('/sender', subscribersLimiter, async (_req: Request, res: Response) => {
  try {
    return res.json({ sender: senderFromBaseUrl(await getDashboardBaseUrl()) });
  } catch (err) {
    console.error('Sender lookup error:', (err as Error).message);
    return res.json({ sender: null });
  }
});

export default router;
