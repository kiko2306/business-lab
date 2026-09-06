import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({ query }));

vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn().mockReturnValue(10110),
}));

vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn().mockResolvedValue('10.201.0.1') }));

const { readAppEnvValue } = vi.hoisted(() => ({ readAppEnvValue: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue }));

const {
  beszelSuperuserLogin,
  beszelListUsers,
  beszelCreateUser,
  beszelSetUserRole,
  beszelDeleteUser,
} = vi.hoisted(() => ({
  beszelSuperuserLogin: vi.fn(),
  beszelListUsers: vi.fn(),
  beszelCreateUser: vi.fn(),
  beszelSetUserRole: vi.fn(),
  beszelDeleteUser: vi.fn(),
}));
vi.mock('./beszelClient', () => ({
  beszelSuperuserLogin,
  beszelListUsers,
  beszelCreateUser,
  beszelSetUserRole,
  beszelDeleteUser,
}));

import { resolveComposeFile } from '../config/services';
import { syncBeszelUsers, syncBeszelUsersSafe } from './beszelSync';

const mockedResolve = vi.mocked(resolveComposeFile);

const installed = () =>
  ({
    projectName: 'beszel',
    appDir: '/apps/beszel',
    composeFile: '/apps/beszel/docker-compose.yml',
    composeArgs: '-f /apps/beszel/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

const BASE = 'http://10.201.0.1:10110';

// readAppEnvValue is called with (service, key) — return per key.
const envValues: Record<string, string | null> = {
  BESZEL_ADMIN_PASSWORD: 'generated-admin-pw',
  BESZEL_ADMIN_EMAIL: 'admin@homelab.local',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue(installed());
  readAppEnvValue.mockImplementation((_service: string, key: string) => envValues[key] ?? null);
  beszelSuperuserLogin.mockResolvedValue('superuser-token');
  beszelListUsers.mockResolvedValue([]);
  query.mockResolvedValue({ rows: [] });
});

describe('syncBeszelUsers', () => {
  it('no-ops when Beszel is not installed', async () => {
    mockedResolve.mockReturnValue(null);

    const result = await syncBeszelUsers('test');

    expect(result).toEqual({ synced: false, created: 0, updated: 0, deleted: 0, reason: 'beszel-not-installed' });
    expect(beszelSuperuserLogin).not.toHaveBeenCalled();
  });

  it('no-ops when the generated admin password is not set yet', async () => {
    readAppEnvValue.mockImplementation((_s: string, key: string) =>
      key === 'BESZEL_ADMIN_PASSWORD' ? null : 'admin@homelab.local'
    );

    const result = await syncBeszelUsers('test');

    expect(result.reason).toBe('admin-password-missing');
    expect(beszelSuperuserLogin).not.toHaveBeenCalled();
  });

  it('reports unreachable on a network failure logging in', async () => {
    beszelSuperuserLogin.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect((await syncBeszelUsers('test')).reason).toBe('unreachable');
  });

  it('reports unreachable when the stored admin password is rejected', async () => {
    beszelSuperuserLogin.mockResolvedValueOnce(null);

    expect((await syncBeszelUsers('test')).reason).toBe('unreachable');
  });

  it('creates an admin account for a webmaster with no existing Beszel account', async () => {
    query.mockResolvedValue({
      rows: [{ email: 'm@x.com', password_hash: '$2b$x', roles: ['webmaster'], has_beszel_access: false }],
    });

    const result = await syncBeszelUsers('test');

    expect(beszelCreateUser).toHaveBeenCalledWith(BASE, 'superuser-token', 'm@x.com', expect.any(String), 'admin');
    expect(result).toMatchObject({ synced: true, created: 1, updated: 0, deleted: 0 });
  });

  it('creates a readonly account for a non-admin granted beszel access', async () => {
    query.mockResolvedValue({
      rows: [{ email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_beszel_access: true }],
    });

    await syncBeszelUsers('test');

    expect(beszelCreateUser).toHaveBeenCalledWith(BASE, 'superuser-token', 'a@x.com', expect.any(String), 'readonly');
  });

  it('skips an account with no email even if webmaster', async () => {
    query.mockResolvedValue({
      rows: [{ email: null, password_hash: '$2b$x', roles: ['webmaster'], has_beszel_access: false }],
    });

    await syncBeszelUsers('test');

    expect(beszelCreateUser).not.toHaveBeenCalled();
  });

  it('promotes an existing readonly account when the user becomes an admin', async () => {
    query.mockResolvedValue({
      rows: [{ email: 'a@x.com', password_hash: '$2b$a', roles: ['admin'], has_beszel_access: true }],
    });
    beszelListUsers.mockResolvedValue([{ id: 'rec1', email: 'a@x.com', role: 'readonly' }]);

    const result = await syncBeszelUsers('test');

    expect(beszelSetUserRole).toHaveBeenCalledWith(BASE, 'superuser-token', 'rec1', 'admin');
    expect(beszelCreateUser).not.toHaveBeenCalled();
    expect(result.updated).toBe(1);
  });

  it('deletes an existing account that is no longer wanted', async () => {
    query.mockResolvedValue({ rows: [] });
    beszelListUsers.mockResolvedValue([{ id: 'rec9', email: 'gone@x.com', role: 'readonly' }]);

    const result = await syncBeszelUsers('test');

    expect(beszelDeleteUser).toHaveBeenCalledWith(BASE, 'superuser-token', 'rec9');
    expect(result.deleted).toBe(1);
  });

  it('never deletes or re-roles the first-run seed admin', async () => {
    query.mockResolvedValue({ rows: [] });
    beszelListUsers.mockResolvedValue([{ id: 'seed', email: 'admin@homelab.local', role: 'admin' }]);

    await syncBeszelUsers('test');

    expect(beszelDeleteUser).not.toHaveBeenCalled();
    expect(beszelSetUserRole).not.toHaveBeenCalled();
  });

  it('matches emails case-insensitively and leaves an in-sync account untouched', async () => {
    query.mockResolvedValue({
      rows: [{ email: 'Ann@X.com', password_hash: '$2b$a', roles: ['user'], has_beszel_access: true }],
    });
    beszelListUsers.mockResolvedValue([{ id: 'rec1', email: 'ann@x.com', role: 'readonly' }]);

    const result = await syncBeszelUsers('test');

    expect(beszelCreateUser).not.toHaveBeenCalled();
    expect(beszelSetUserRole).not.toHaveBeenCalled();
    expect(beszelDeleteUser).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synced: true, created: 0, updated: 0, deleted: 0 });
  });

  it('continues past a per-user failure and still marks the pass synced', async () => {
    query.mockResolvedValue({
      rows: [
        { email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_beszel_access: true },
        { email: 'b@x.com', password_hash: '$2b$b', roles: ['user'], has_beszel_access: true },
      ],
    });
    beszelCreateUser.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    const result = await syncBeszelUsers('test');

    expect(beszelCreateUser).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ synced: true, created: 1 });
  });
});

describe('syncBeszelUsersSafe', () => {
  it('returns null on a clean sync', async () => {
    expect(await syncBeszelUsersSafe('test', 1)).toBeNull();
  });

  it('returns null when Beszel is not installed', async () => {
    mockedResolve.mockReturnValue(null);
    expect(await syncBeszelUsersSafe('test', 1)).toBeNull();
  });

  it('returns a warning string instead of throwing when the sync throws', async () => {
    query.mockRejectedValue(new Error('db down'));

    const warning = await syncBeszelUsersSafe('test', 1);

    expect(warning).toMatch(/updating Beszel failed/);
  });

  it('returns a warning when Beszel is unreachable', async () => {
    beszelSuperuserLogin.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await syncBeszelUsersSafe('test', 1)).toMatch(/could not be reached/);
  });
});
