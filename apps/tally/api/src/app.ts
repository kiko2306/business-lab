import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';
import type { AgentHub } from './agentHub';
import { agentRoutes } from './routes/agent';
import { shopRoutes } from './routes/shop';
import { smtpRoutes } from './routes/smtp';
import { storeRoutes } from './routes/stores';

/**
 * Split from index.ts so tests can build an app against their own pool without
 * starting a listener or running migrations.
 */
export function createApp(pool: Pool, hub: AgentHub): Express {
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
  app.use('/api', storeRoutes(pool, hub));
  app.use('/api', shopRoutes(pool, hub));
  app.use('/api', smtpRoutes(pool));

  // The built Angular bundle, served by this same process on this same origin
  // (plan.md §632) — one image, one port, one hostname, so no CORS boundary.
  // Absent in tests and in `ng serve` development, where only the API matters.
  const webRoot = process.env.WEB_ROOT ?? path.join(__dirname, 'web');
  if (fs.existsSync(webRoot)) {
    app.use(express.static(webRoot));
    // Client-side routing: any other GET returns index.html so a deep link
    // survives a refresh. Middleware rather than `app.get('*')`, because
    // Express 5 replaced the bare '*' path with named wildcards and rejects
    // the old form outright.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/agent')) {
        next();
        return;
      }
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

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
