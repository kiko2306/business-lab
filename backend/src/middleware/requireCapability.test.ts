import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// `vi.hoisted` runs before the hoisted `vi.mock` factory below, so the spy
// exists when the mock is registered and stays referenceable from the tests.
const { getUserRoles } = vi.hoisted(() => ({
  getUserRoles: vi.fn<(id: number) => Promise<string[]>>(),
}));
vi.mock('../services/userRoles', () => ({ getUserRoles }));

import { requireCapability } from './requireCapability';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn().mockImplementation((payload: unknown) => {
    res.body = payload;
    return res;
  });
  return res;
}

describe('requireCapability', () => {
  beforeEach(() => {
    getUserRoles.mockReset();
  });

  it('calls next() when a held role grants the capability', async () => {
    getUserRoles.mockResolvedValue(['it_admin']);
    const req = { user: { id: 7 } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('apps:control')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403s when no held role grants the capability', async () => {
    getUserRoles.mockResolvedValue(['webmaster']);
    const req = { user: { id: 7 } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('apps:control')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('401s when the request is unauthenticated', async () => {
    const req = {} as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('users:manage')(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(getUserRoles).not.toHaveBeenCalled();
  });

  it('reads roles fresh on every call (not from the token)', async () => {
    getUserRoles.mockResolvedValue(['owner']);
    const req = { user: { id: 1, roles: ['user'] } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('users:manage')(req, res, next);

    // The stale token said ['user'] (no capability); the DB said ['owner'].
    expect(getUserRoles).toHaveBeenCalledWith(1);
    expect(next).toHaveBeenCalledOnce();
  });
});
