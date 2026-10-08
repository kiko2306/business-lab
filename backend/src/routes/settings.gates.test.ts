import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/database', () => ({ query: vi.fn(), withTransaction: vi.fn() }));
// The gate itself is the subject: record which capability each request demanded
// and stop there, so no handler (and no database) is reached.
vi.mock('../middleware/requireCapability', () => ({
  requireCapability: (capability: string) => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(200).json({ gate: capability }),
}));

import settingsRouter from './settings';

// plan.md §903: routes/settings.ts was split into one router per concern. The
// capability gate is applied once, in front of all of them, by path prefix; this
// pins every route's existence and the capability it needs, so a router moved
// out of the gate (or a path mistyped in the move) fails here.
const EXPOSURE = 'exposure:settings';
const MANAGE = 'settings:manage';
const ROUTES: [string, string, string][] = [
  ['GET', '/cloudflare-token', EXPOSURE],
  ['PUT', '/cloudflare-account-model', EXPOSURE],
  ['PUT', '/cloudflare-token', EXPOSURE],
  ['POST', '/cloudflare-token/test', EXPOSURE],
  ['GET', '/exposure', EXPOSURE],
  ['PUT', '/exposure', EXPOSURE],
  ['POST', '/exposure/test', EXPOSURE],
  ['GET', '/ai-keys', MANAGE],
  ['PUT', '/ai-keys/anthropic', MANAGE],
  ['POST', '/ai-keys/anthropic/test', MANAGE],
  ['PUT', '/ai-feature-provider', MANAGE],
  ['GET', '/mail', MANAGE],
  ['PUT', '/mail', MANAGE],
  ['POST', '/mail/test', MANAGE],
  ['GET', '/backup-target', MANAGE],
  ['PUT', '/backup-target', MANAGE],
  ['GET', '/backup-target/kopia-status', MANAGE],
  ['POST', '/backup-target/test', MANAGE],
  ['GET', '/deployment', MANAGE],
  ['GET', '/general', MANAGE],
  ['PUT', '/general', MANAGE],
  ['GET', '/alerts', MANAGE],
  ['PUT', '/alerts', MANAGE],
  ['POST', '/alerts/test', MANAGE],
  ['GET', '/crowdsec/bans', MANAGE],
  ['DELETE', '/crowdsec/bans', MANAGE],
];

describe('settings router capability gates', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use('/settings', settingsRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/settings`;
  });

  afterAll(() => {
    server.close();
  });

  it.each(ROUTES)('%s %s needs %s', async (method, path, capability) => {
    const response = await fetch(base + path, { method });
    expect(await response.json()).toEqual({ gate: capability });
  });

  // The gate answers any path, so a missing handler would still "pass" above;
  // this lists what is actually registered, through nested routers too.
  it('registers exactly these routes', () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };
    const collect = (stack: Layer[]): string[] =>
      stack.flatMap((layer) =>
        layer.route
          ? Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route!.path}`)
          : layer.handle?.stack
            ? collect(layer.handle.stack)
            : []
      );
    const registered = collect((settingsRouter as unknown as { stack: Layer[] }).stack).sort();
    const expected = ROUTES.map(([m, p]) => `${m} ${p.replace('/anthropic', '/:provider')}`).sort();
    expect(registered).toEqual(expected);
  });
});
