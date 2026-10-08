import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/database', () => ({ query: vi.fn(), withTransaction: vi.fn() }));

import authMiddleware from '../middleware/auth';
import servicesRouter from './services';

// index.ts mounts this router behind apiLimiter + setup mode + authMiddleware, so
// a second authMiddleware per route verified every JWT twice (plan.md §899). The
// per-route capability gates are what this router owns; authentication is not.
describe('routes/services', () => {
  it('does not authenticate again behind the mount-level gate', () => {
    const routes = (servicesRouter as unknown as {
      stack: { route?: { path: string; stack: { handle: unknown }[] } }[];
    }).stack.filter((layer) => layer.route);
    expect(routes.length).toBeGreaterThan(5);

    const doubled = routes
      .filter((layer) => layer.route!.stack.some((h) => h.handle === authMiddleware))
      .map((layer) => layer.route!.path);
    expect(doubled).toEqual([]);
  });

  // The other half of the contract: dropping the inner check is only safe while the
  // mount still carries the gate.
  it('is still mounted behind the auth gate in index.ts', () => {
    const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(index).toMatch(/app\.use\(`\$\{prefix\}\/services`, \.\.\.protectedGate\(\), servicesRouter\)/);
    expect(index).toMatch(/const protectedGate = \(\) => \[[^\]]*authMiddleware\]/);
  });
});
