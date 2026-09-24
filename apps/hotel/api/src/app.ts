import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { agentRoutes } from './routes/agent';
import { checkinRoutes } from './routes/checkin';
import { guestTextRoutes } from './routes/guestText';
import { pulseRoutes } from './routes/pulse';
import { questionRoutes } from './routes/questions';
import { smtpRoutes } from './routes/smtp';
import { unitRoutes } from './routes/units';

/** Split from index.ts so tests build an app without starting a listener. */
export function createApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());

  // Touches the database deliberately: "the process is up" says little for a
  // service whose whole job is owning rows.
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  // Authelia bypasses /agent (§628, §637); /api is gated by it and checks the
  // forwarded identity here as well. /checkin and /pulse have no gate at all
  // — each is the guest's own unguessable link, not something Authelia is
  // ever asked about (mounted here ahead of the `check-in`/`pulse` apps that
  // will proxy to them).
  app.use('/agent', agentRoutes(pool));
  app.use('/api', unitRoutes(pool));
  app.use('/api', questionRoutes(pool));
  app.use('/api', smtpRoutes(pool));
  app.use('/api', guestTextRoutes(pool));
  app.use('/checkin', checkinRoutes(pool));
  app.use('/pulse', pulseRoutes(pool));

  // Express 5 awaits async handlers and forwards rejections here. On 4 an
  // async throw becomes an unhandled rejection and the request hangs.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('hotel-core: unhandled error', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
