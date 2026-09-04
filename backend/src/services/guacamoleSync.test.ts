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
}));

const { readAppEnvValue } = vi.hoisted(() => ({ readAppEnvValue: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue }));

const {
  guacamoleLogin,
  guacamoleLogout,
  guacamoleListUsers,
  guacamoleCreateUser,
  guacamoleSetUserDisabled,
} = vi.hoisted(() => ({
  guacamoleLogin: vi.fn(),
  guacamoleLogout: vi.fn(),
  guacamoleListUsers: vi.fn(),
  guacamoleCreateUser: vi.fn(),
  guacamoleSetUserDisabled: vi.fn(),
}));
vi.mock('./guacamoleClient', () => ({
  guacamoleLogin,
  guacamoleLogout,
  guacamoleListUsers,
  guacamoleCreateUser,
  guacamoleSetUserDisabled,
}));

vi.mock('./guacamoleAdminRotate', () => ({
  GUACAMOLE_SERVICE: 'guacamole',
  GUACAMOLE_ADMIN_USERNAME: 'guacadmin',
  GUACAMOLE_ADMIN_PASSWORD_KEY: 'GUACAMOLE_ADMIN_PASSWORD',
  resolveGuacamoleBaseUrl: vi.fn().mockResolvedValue('http://10.201.0.1:10430'),
}));

import { resolveComposeFile } from '../config/services';
import { syncGuacamoleUsers, syncGuacamoleUsersSafe } from './guacamoleSync';

const mockedResolve = vi.mocked(resolveComposeFile);

const installed = () =>
  ({
    projectName: 'guacamole',
    appDir: '/apps/guacamole',
    composeFile: '/apps/guacamole/docker-compose.yml',
    composeArgs: '-f /apps/guacamole/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

const session = { authToken: 'tok', dataSource: 'postgresql' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue(installed());
  readAppEnvValue.mockReturnValue('rotated-admin-password');
  guacamoleLogin.mockResolvedValue(session);
  guacamoleListUsers.mockResolvedValue({});
  query.mockResolvedValue({ rows: [] });
});

describe('syncGuacamoleUsers', () => {
  it('no-ops when Guacamole is not installed', async () => {
    mockedResolve.mockReturnValue(null);

    const result = await syncGuacamoleUsers('test');

    expect(result).toEqual({ synced: false, created: 0, enabled: 0, disabled: 0, reason: 'guacamole-not-installed' });
    expect(guacamoleLogin).not.toHaveBeenCalled();
  });

  it('no-ops when the admin password was never rotated', async () => {
    readAppEnvValue.mockReturnValue(null);

    const result = await syncGuacamoleUsers('test');

    expect(result.reason).toBe('admin-not-rotated');
    expect(guacamoleLogin).not.toHaveBeenCalled();
  });

  it('reports unreachable on a network failure logging in', async () => {
    guacamoleLogin.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await syncGuacamoleUsers('test');

    expect(result.reason).toBe('unreachable');
  });

  it('reports unreachable when the stored admin password is rejected', async () => {
    guacamoleLogin.mockResolvedValueOnce(null);

    const result = await syncGuacamoleUsers('test');

    expect(result.reason).toBe('unreachable');
  });

  it('creates an account for a webmaster with no existing Guacamole account', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'mat', email: 'm@x.com', password_hash: '$2b$x', roles: ['webmaster'], has_guacamole_access: false }],
    });

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).toHaveBeenCalledWith('http://10.201.0.1:10430', session, 'mat', expect.any(String));
    expect(result).toMatchObject({ synced: true, created: 1, enabled: 0, disabled: 0 });
    expect(guacamoleLogout).toHaveBeenCalledWith('http://10.201.0.1:10430', session);
  });

  it('creates an account for a non-webmaster granted app-guacamole access', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_guacamole_access: true }],
    });

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).toHaveBeenCalledWith(expect.any(String), session, 'ann', expect.any(String));
    expect(result.created).toBe(1);
  });

  it('skips an account with no email even if webmaster', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'mat', email: null, password_hash: '$2b$x', roles: ['webmaster'], has_guacamole_access: false }],
    });

    await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).not.toHaveBeenCalled();
  });

  it('re-enables an existing disabled account that is wanted again', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_guacamole_access: true }],
    });
    guacamoleListUsers.mockResolvedValue({ ann: { username: 'ann', disabled: true, attributes: {} } });

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).not.toHaveBeenCalled();
    expect(guacamoleSetUserDisabled).toHaveBeenCalledWith('http://10.201.0.1:10430', session, 'ann', false);
    expect(result.enabled).toBe(1);
  });

  it('disables an existing account that is no longer wanted', async () => {
    query.mockResolvedValue({ rows: [] });
    guacamoleListUsers.mockResolvedValue({ ann: { username: 'ann', disabled: false, attributes: {} } });

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleSetUserDisabled).toHaveBeenCalledWith('http://10.201.0.1:10430', session, 'ann', true);
    expect(result.disabled).toBe(1);
  });

  it('never touches guacadmin, wanted or not', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'guacadmin', email: 'admin@x.com', password_hash: '$2b$x', roles: ['webmaster'], has_guacamole_access: false }],
    });
    guacamoleListUsers.mockResolvedValue({ guacadmin: { username: 'guacadmin', disabled: false, attributes: {} } });

    await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).not.toHaveBeenCalled();
    expect(guacamoleSetUserDisabled).not.toHaveBeenCalled();
  });

  it('leaves an already-enabled wanted account and an already-disabled unwanted one untouched', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_guacamole_access: true }],
    });
    guacamoleListUsers.mockResolvedValue({
      ann: { username: 'ann', disabled: false, attributes: {} },
      bob: { username: 'bob', disabled: true, attributes: {} },
    });

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).not.toHaveBeenCalled();
    expect(guacamoleSetUserDisabled).not.toHaveBeenCalled();
    expect(result).toMatchObject({ synced: true, created: 0, enabled: 0, disabled: 0 });
  });

  it('logs out even when reconciling a user fails, and continues past the failure', async () => {
    query.mockResolvedValue({
      rows: [
        { username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], has_guacamole_access: true },
        { username: 'bob', email: 'b@x.com', password_hash: '$2b$b', roles: ['user'], has_guacamole_access: true },
      ],
    });
    guacamoleCreateUser.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    const result = await syncGuacamoleUsers('test');

    expect(guacamoleCreateUser).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ synced: true, created: 1 });
    expect(guacamoleLogout).toHaveBeenCalled();
  });
});

describe('syncGuacamoleUsersSafe', () => {
  it('returns null on a clean sync', async () => {
    query.mockResolvedValue({ rows: [] });

    expect(await syncGuacamoleUsersSafe('test', 1)).toBeNull();
  });

  it('returns null when Guacamole is not installed', async () => {
    mockedResolve.mockReturnValue(null);

    expect(await syncGuacamoleUsersSafe('test', 1)).toBeNull();
  });

  it('returns a warning string instead of throwing when the sync throws', async () => {
    query.mockRejectedValue(new Error('db down'));

    const warning = await syncGuacamoleUsersSafe('test', 1);

    expect(warning).toMatch(/updating Guacamole failed/);
  });
});
