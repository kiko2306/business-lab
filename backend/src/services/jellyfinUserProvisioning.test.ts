import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { createUser, findUserByName, setDisabled, setPassword, signIn } from './jellyfinClient';
import { disableJellyfinUser, provisionJellyfinUser } from './jellyfinUserProvisioning';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('../config/services', () => ({ getPublishedUpstreamPort: vi.fn(() => 10210) }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn(async () => '10.201.0.1') }));
vi.mock('./jellyfinClient', () => ({
  signIn: vi.fn(),
  findUserByName: vi.fn(),
  createUser: vi.fn(),
  setPassword: vi.fn(),
  setDisabled: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedGetAdmin = vi.mocked(getAutheliaAdminUser);
const mockedSignIn = vi.mocked(signIn);
const mockedFindUserByName = vi.mocked(findUserByName);
const mockedCreateUser = vi.mocked(createUser);
const mockedSetPassword = vi.mocked(setPassword);
const mockedSetDisabled = vi.mocked(setDisabled);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAdmin.mockReturnValue({ username: 'admin', email: 'admin@example.com', displayName: 'Admin', groups: [] });
  mockedReadEnv.mockImplementation((_service, key) => (key === 'JELLYFIN_ADMIN_PASSWORD' ? 'admin-pw' : null));
  mockedSignIn.mockResolvedValue('admin-token');
  mockedFindUserByName.mockResolvedValue(null);
  mockedCreateUser.mockResolvedValue('user-42');
  mockedSetPassword.mockResolvedValue(true);
  mockedSetDisabled.mockResolvedValue(true);
});

describe('provisionJellyfinUser', () => {
  it('skips when no Authelia admin is tracked yet', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('skips when the generated admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never attempts to create/update', async () => {
    mockedSignIn.mockResolvedValue(null);
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedFindUserByName).not.toHaveBeenCalled();
  });

  it('creates a new account keyed by email when none exists', async () => {
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'pw' });
    expect(mockedCreateUser).toHaveBeenCalledWith(expect.any(String), 'admin-token', 'bob@example.com', 'pw');
    expect(mockedSetDisabled).not.toHaveBeenCalled();
    expect(result).toBe('created');
  });

  it('reports failed when creation fails', async () => {
    mockedCreateUser.mockResolvedValue(null);
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
  });

  it('updates the password and re-enables an existing account instead of creating a duplicate', async () => {
    mockedFindUserByName.mockResolvedValue('user-7');
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'new-pw' });
    expect(mockedCreateUser).not.toHaveBeenCalled();
    expect(mockedSetPassword).toHaveBeenCalledWith(expect.any(String), 'admin-token', 'user-7', 'new-pw');
    expect(mockedSetDisabled).toHaveBeenCalledWith(expect.any(String), 'admin-token', 'user-7', false);
    expect(result).toBe('updated');
  });

  it('reports failed when the password update fails, without re-enabling', async () => {
    mockedFindUserByName.mockResolvedValue('user-7');
    mockedSetPassword.mockResolvedValue(false);
    const result = await provisionJellyfinUser({ email: 'bob@example.com', password: 'new-pw' });
    expect(mockedSetDisabled).not.toHaveBeenCalled();
    expect(result).toBe('failed');
  });
});

describe('disableJellyfinUser', () => {
  it('locks the account it finds by email', async () => {
    mockedFindUserByName.mockResolvedValue('user-7');
    const result = await disableJellyfinUser('bob@example.com');
    expect(mockedSetDisabled).toHaveBeenCalledWith(expect.any(String), 'admin-token', 'user-7', true);
    expect(result).toBe('disabled');
  });

  it('reports not-found when no account matches the email', async () => {
    mockedFindUserByName.mockResolvedValue(null);
    const result = await disableJellyfinUser('nobody@example.com');
    expect(mockedSetDisabled).not.toHaveBeenCalled();
    expect(result).toBe('not-found');
  });

  it('reports failed when the disable call fails', async () => {
    mockedFindUserByName.mockResolvedValue('user-7');
    mockedSetDisabled.mockResolvedValue(false);
    const result = await disableJellyfinUser('bob@example.com');
    expect(result).toBe('failed');
  });
});
