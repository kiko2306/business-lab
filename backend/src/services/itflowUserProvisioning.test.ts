import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { resolveItflowBaseUrl } from './itflowAdminBootstrap';
import { addUser, signIn, updateUserPassword } from './itflowClient';
import { runItflowDbScript } from './itflowDb';
import { provisionItflowUser } from './itflowUserProvisioning';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./itflowAdminBootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./itflowAdminBootstrap')>()),
  resolveItflowBaseUrl: vi.fn(),
}));
vi.mock('./itflowClient', () => ({ signIn: vi.fn(), addUser: vi.fn(), updateUserPassword: vi.fn() }));
vi.mock('./itflowDb', () => ({ runItflowDbScript: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedGetAdmin = vi.mocked(getAutheliaAdminUser);
const mockedBaseUrl = vi.mocked(resolveItflowBaseUrl);
const mockedSignIn = vi.mocked(signIn);
const mockedAddUser = vi.mocked(addUser);
const mockedUpdatePassword = vi.mocked(updateUserPassword);
const mockedRunDbScript = vi.mocked(runItflowDbScript);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAdmin.mockReturnValue({ username: 'admin', email: 'admin@example.com', displayName: 'Admin', groups: [] });
  mockedReadEnv.mockImplementation((_service, key) => (key === 'ITFLOW_ADMIN_PASSWORD' ? 'admin-pw' : null));
  mockedBaseUrl.mockResolvedValue('http://10.201.0.1:10420');
  mockedSignIn.mockResolvedValue({ state: 'signed-in', cookie: 'PHPSESSID=admin' });
  mockedRunDbScript.mockResolvedValue({ ok: true, output: 'NOT_FOUND' });
  mockedAddUser.mockResolvedValue('created');
});

describe('provisionItflowUser', () => {
  it('skips when no admin account is tracked yet', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('skips when the generated admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never looks up or creates', async () => {
    mockedSignIn.mockResolvedValue({ state: 'failed' });
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedRunDbScript).not.toHaveBeenCalled();
    expect(mockedAddUser).not.toHaveBeenCalled();
  });

  it('creates a new user with the Technician role when none exists yet', async () => {
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw', displayName: 'Bob Jones' });
    expect(mockedAddUser).toHaveBeenCalledWith('http://10.201.0.1:10420', {
      cookie: 'PHPSESSID=admin',
      name: 'Bob Jones',
      email: 'bob@example.com',
      password: 'pw',
      roleId: 2,
    });
    expect(mockedUpdatePassword).not.toHaveBeenCalled();
    expect(result).toBe('created');
  });

  it('falls back to the email as the name with no display name', async () => {
    await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(mockedAddUser).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: 'bob@example.com' }));
  });

  it('reports failed when addUser itself fails', async () => {
    mockedAddUser.mockResolvedValue('failed');
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
  });

  it('updates the password of an existing user found by the DB lookup', async () => {
    mockedRunDbScript.mockResolvedValue({ ok: true, output: 'FOUND\n42' });
    mockedUpdatePassword.mockResolvedValue('updated');
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'new-pw', displayName: 'Bob Jones' });
    expect(mockedUpdatePassword).toHaveBeenCalledWith('http://10.201.0.1:10420', {
      cookie: 'PHPSESSID=admin',
      userId: 42,
      name: 'Bob Jones',
      email: 'bob@example.com',
      roleId: 2,
      newPassword: 'new-pw',
    });
    expect(mockedAddUser).not.toHaveBeenCalled();
    expect(result).toBe('updated');
  });

  it('reports already-exists when an existing user is found but the password update fails', async () => {
    mockedRunDbScript.mockResolvedValue({ ok: true, output: 'FOUND\n42' });
    mockedUpdatePassword.mockResolvedValue('failed');
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('already-exists');
  });

  it('falls through to create when the DB lookup itself fails', async () => {
    mockedRunDbScript.mockResolvedValue({ ok: false, output: 'boom' });
    const result = await provisionItflowUser({ email: 'bob@example.com', password: 'pw' });
    expect(mockedAddUser).toHaveBeenCalled();
    expect(result).toBe('created');
  });
});
