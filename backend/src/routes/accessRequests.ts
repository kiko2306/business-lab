import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas, validateBody } from '../middleware/validation';
import { sendMail } from '../utils/mailSend';
import { getMailConfig } from '../utils/mailSettings';

const router = Router();

// Public and unauthenticated by nature — the person hitting this is exactly
// the one Authelia just turned away, so they may have no dashboard session at
// all. A generous-but-bounded budget, same shape as the other public forms
// (auth.ts's authLimiter, recovery.ts's recoveryLimiter), keeps it from being
// usable as an open mail relay.
const accessRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// POST /api/access-requests — sent from the themed /access-denied page a
// group-denied Authelia request now redirects to (npmClient.ts's
// buildAutheliaAdvancedConfig, plan.md §463). Mails the dashboard's own
// configured mailbox (settings:email's from-address) with the requester's
// email set as Reply-To, so answering is just hitting reply.
router.post('/', accessRequestLimiter, validateBody(schemas.accessRequest), async (req: Request, res: Response) => {
  const { hostname, email, reason } = req.body as { hostname: string; email: string; reason: string };
  try {
    const mailConfig = await getMailConfig();
    if (!mailConfig) {
      return res
        .status(503)
        .json({ error: 'Email is not configured on this dashboard yet — contact an administrator directly.' });
    }

    await sendMail({
      to: mailConfig.fromAddress,
      replyTo: email,
      subject: `Access request: ${hostname}`,
      text: `${email} is requesting access to ${hostname}.\n\nReason:\n${reason}`,
    });

    return res.status(204).send();
  } catch (err) {
    console.error('Access request error:', (err as Error).message);
    return res.status(500).json({ error: 'Could not send the request. Try again later.' });
  }
});

export default router;
