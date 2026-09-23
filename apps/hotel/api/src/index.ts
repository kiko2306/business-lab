import path from 'path';
import { Pool } from 'pg';
import { createApp } from './app';
import { migrate } from './migrate';

const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function start(): Promise<void> {
  const applied = await migrate(pool, path.join(__dirname, 'migrations'));
  console.log(`hotel-core: applied ${applied.length} migration file(s)`);
  createApp(pool).listen(port, () => console.log(`hotel-core: listening on ${port}`));
}

start().catch((err) => {
  console.error('hotel-core: failed to start', err);
  process.exit(1);
});
