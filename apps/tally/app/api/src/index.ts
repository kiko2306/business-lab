import http from 'http';
import path from 'path';
import { Pool } from 'pg';
import { AgentHub } from './agentHub';
import { createApp } from './app';
import { migrate } from './migrate';

const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function start(): Promise<void> {
  const applied = await migrate(pool, path.join(__dirname, 'migrations'));
  console.log(`tally: applied ${applied.length} migration file(s)`);

  const hub = new AgentHub(pool);
  // An explicit http.Server, not app.listen(): the hub needs it to take over
  // the upgrade handshake for /agent/connect.
  const server = http.createServer(createApp(pool, hub));
  hub.attach(server);
  server.listen(port, () => console.log(`tally: listening on ${port}`));
}

start().catch((err) => {
  console.error('tally: failed to start', err);
  process.exit(1);
});
