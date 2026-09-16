import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { schemas, validateBody } from '../middleware/validation';
import { sendMail } from '../utils/mailSend';
import { getMailConfig } from '../utils/mailSettings';
import { query } from '../utils/database';
import { SERVICES } from '../config/services';

const router = Router();

/**
 * A human-readable "<app label> (<hostname>)" for the email, falling back to
 * the bare hostname when it isn't recognised (exposure disabled since the
 * redirect was generated, or the request was hand-crafted). Looks up
 * `service_exposure` rather than recomputing `buildExposureHostname` for
 * every registry entry — it's the same table the exposure system already
 * keeps in step, so this is a reverse lookup against data that's already
 * authoritative, not a second copy of the hostname-building logic.
 */
export async function describeApp(hostname: string): Promise<string> {
  const result = await query<{ service_name: string }>(
    'SELECT service_name FROM service_exposure WHERE hostname = $1 LIMIT 1',
    [hostname]
  );
  // Secondary exposures key as `<service>:<suffix>` (exposure.ts) — the base
  // service is what has a label.
  const serviceName = result.rows[0]?.service_name.split(':')[0];
  const label = serviceName ? SERVICES[serviceName]?.label : undefined;
  return label ? `${label} (${hostname})` : hostname;
}

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

    const app = await describeApp(hostname);
    await sendMail({
      to: mailConfig.fromAddress,
      replyTo: email,
      subject: `Access request: ${app}`,
      text: `${email} is requesting access to ${app}.\n\nReason:\n${reason}`,
    });

    return res.status(204).send();
  } catch (err) {
    console.error('Access request error:', (err as Error).message);
    return res.status(500).json({ error: 'Could not send the request. Try again later.' });
  }
});

export default router;
