import path from 'path';
import { Pool } from 'pg';
import { createApp } from './app';
import { migrate } from './migrate';

const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function start(): Promise<void> {
  const applied = await migrate(pool, path.join(__dirname, 'migrations'));
  console.log(`tally: applied ${applied.length} migration file(s)`);
  createApp(pool).listen(port, () => console.log(`tally: listening on ${port}`));
}

start().catch((err) => {
  console.error('tally: failed to start', err);
  process.exit(1);
});
