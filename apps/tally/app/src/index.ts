import express from 'express';
import path from 'path';
import { Pool } from 'pg';
import { migrate } from './migrate';

const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(express.json());

// Liveness for the compose healthcheck. It touches the database deliberately:
// tally is a relay with no data of its own, so "the process is up" says very
// little — "it can reach its own store registry" is the useful signal.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'database unavailable' });
  }
});

async function start(): Promise<void> {
  const applied = await migrate(pool, path.join(__dirname, 'migrations'));
  console.log(`tally: applied ${applied.length} migration file(s)`);
  app.listen(port, () => console.log(`tally: listening on ${port}`));
}

start().catch((err) => {
  console.error('tally: failed to start', err);
  process.exit(1);
});
