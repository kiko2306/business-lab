import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// `vi.hoisted` runs before the hoisted `vi.mock` factory below, so the spies
// exist when the mock is registered and stay referenceable from the tests.
const { getUserRoles, getUserCapabilities } = vi.hoisted(() => ({
  getUserRoles: vi.fn<(id: number) => Promise<string[]>>(),
  getUserCapabilities: vi.fn<(id: number) => Promise<string[]>>(),
}));
vi.mock('../services/userRoles', () => ({ getUserRoles, getUserCapabilities }));

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
    getUserCapabilities.mockReset();
    getUserCapabilities.mockResolvedValue([]);
  });

  it('calls next() when the effective capability set grants it', async () => {
    getUserRoles.mockResolvedValue(['admin']);
    getUserCapabilities.mockResolvedValue(['apps:control']);
    const req = { user: { id: 7 } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('apps:control')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('403s when the effective set does not grant it', async () => {
    getUserRoles.mockResolvedValue(['admin']);
    getUserCapabilities.mockResolvedValue(['audit:view']);
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

  it('reads roles and grants fresh on every call (not from the token)', async () => {
    getUserRoles.mockResolvedValue(['webmaster']);
    const req = { user: { id: 1, roles: ['user'] } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('users:manage')(req, res, next);

    // The stale token said ['user'] (no capability); the DB said ['webmaster'].
    expect(getUserRoles).toHaveBeenCalledWith(1);
    expect(getUserCapabilities).toHaveBeenCalledWith(1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('treats an admin with no grant rows as all-on', async () => {
    getUserRoles.mockResolvedValue(['admin']);
    getUserCapabilities.mockResolvedValue([]);
    const req = { user: { id: 3 } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();

    await requireCapability('settings:manage')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
