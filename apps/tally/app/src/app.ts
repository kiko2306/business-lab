import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import { agentRoutes } from './routes/agent';
import { storeRoutes } from './routes/stores';

/**
 * Split from index.ts so tests can build an app against their own pool without
 * starting a listener or running migrations.
 */
export function createApp(pool: Pool): Express {
  const app = express();
  app.use(express.json());

  // Touches the database deliberately: tally is a relay with no data of its
  // own, so "the process is up" says very little — "it can reach its own store
  // registry" is the useful signal.
  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  // Authelia bypasses /agent (plan.md §628); everything under /api is gated by
  // it and additionally checks the forwarded identity here.
  app.use('/agent', agentRoutes(pool));
  app.use('/api', storeRoutes(pool));

  // Express 5, not 4, specifically for this: it awaits async handlers and
  // forwards a rejection here. On 4 an async throw becomes an unhandled
  // rejection and the request hangs until the client gives up, which is why
  // every Express 4 codebase grows an asyncHandler wrapper around every route.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('tally: unhandled error', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
