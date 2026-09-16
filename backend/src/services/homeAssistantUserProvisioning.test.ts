import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { resolveHaBaseUrl } from './homeAssistantAdminBootstrap';
import { getAdminAccessToken, runHaWsCommand } from './homeAssistantClient';
import { disableHomeAssistantUser, provisionHomeAssistantUser } from './homeAssistantUserProvisioning';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./homeAssistantAdminBootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./homeAssistantAdminBootstrap')>()),
  resolveHaBaseUrl: vi.fn(),
}));
vi.mock('./homeAssistantClient', () => ({ getAdminAccessToken: vi.fn(), runHaWsCommand: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedGetAdmin = vi.mocked(getAutheliaAdminUser);
const mockedBaseUrl = vi.mocked(resolveHaBaseUrl);
const mockedToken = vi.mocked(getAdminAccessToken);
const mockedWsCommand = vi.mocked(runHaWsCommand);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAdmin.mockReturnValue({ username: 'admin', email: 'admin@example.com', displayName: 'Admin', groups: [] });
  mockedReadEnv.mockImplementation((_service, key) => (key === 'HOMEASSISTANT_ADMIN_PASSWORD' ? 'owner-pw' : null));
  mockedBaseUrl.mockResolvedValue('http://10.201.0.1:8123');
  mockedToken.mockResolvedValue({ state: 'ok', accessToken: 'token-abc' });
  mockedWsCommand.mockResolvedValue({ success: true, result: [] });
});

describe('provisionHomeAssistantUser', () => {
  const input = { email: 'bob@example.com', password: 'pw', displayName: 'Bob Jones' };

  it('skips when no admin account is tracked yet', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('admin-not-configured');
    expect(mockedToken).not.toHaveBeenCalled();
  });

  it('skips when the owner password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('admin-not-configured');
    expect(mockedToken).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never lists or creates', async () => {
    mockedToken.mockResolvedValue({ state: 'failed' });
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedWsCommand).not.toHaveBeenCalled();
  });

  it('creates a new user in the system-users group when none exists yet', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({ success: true, result: [] }) // config/auth/list
      .mockResolvedValueOnce({ success: true, result: { user: { id: 'user-1' } } }) // config/auth/create
      .mockResolvedValueOnce({ success: true, result: null }); // config/auth_provider/homeassistant/create

    const result = await provisionHomeAssistantUser(input);

    expect(mockedWsCommand).toHaveBeenNthCalledWith(2, 'http://10.201.0.1:8123', 'token-abc', {
      type: 'config/auth/create',
      name: 'Bob Jones',
      group_ids: ['system-users'],
    });
    expect(mockedWsCommand).toHaveBeenNthCalledWith(3, 'http://10.201.0.1:8123', 'token-abc', {
      type: 'config/auth_provider/homeassistant/create',
      user_id: 'user-1',
      username: 'bob@example.com',
      password: 'pw',
    });
    expect(result).toBe('created');
  });

  it('falls back to the email as the name with no display name', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValueOnce({ success: true, result: { user: { id: 'user-1' } } })
      .mockResolvedValueOnce({ success: true, result: null });
    await provisionHomeAssistantUser({ email: 'bob@example.com', password: 'pw' });
    expect(mockedWsCommand).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ name: 'bob@example.com' })
    );
  });

  it('reports failed when the list command itself fails', async () => {
    mockedWsCommand.mockResolvedValueOnce({ success: false });
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('failed');
  });

  it('reports failed when create fails', async () => {
    mockedWsCommand.mockResolvedValueOnce({ success: true, result: [] }).mockResolvedValueOnce({ success: false });
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('failed');
  });

  it('reports failed when attaching credentials fails', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({ success: true, result: [] })
      .mockResolvedValueOnce({ success: true, result: { user: { id: 'user-1' } } })
      .mockResolvedValueOnce({ success: false });
    const result = await provisionHomeAssistantUser(input);
    expect(result).toBe('failed');
  });

  it('changes the password of an existing active user found by email', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({
        success: true,
        result: [{ id: 'user-1', username: 'bob@example.com', name: 'Bob Jones', is_active: true, is_owner: false }],
      })
      .mockResolvedValueOnce({ success: true, result: null }); // admin_change_password

    const result = await provisionHomeAssistantUser({ email: 'bob@example.com', password: 'new-pw' });

    expect(mockedWsCommand).toHaveBeenNthCalledWith(2, 'http://10.201.0.1:8123', 'token-abc', {
      type: 'config/auth_provider/homeassistant/admin_change_password',
      user_id: 'user-1',
      password: 'new-pw',
    });
    expect(mockedWsCommand).toHaveBeenCalledTimes(2);
    expect(result).toBe('updated');
  });

  it('also re-activates a disabled user on regrant', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({
        success: true,
        result: [{ id: 'user-1', username: 'bob@example.com', name: 'Bob Jones', is_active: false, is_owner: false }],
      })
      .mockResolvedValueOnce({ success: true, result: null }) // admin_change_password
      .mockResolvedValueOnce({ success: true, result: null }); // config/auth/update is_active: true

    const result = await provisionHomeAssistantUser({ email: 'bob@example.com', password: 'new-pw' });

    expect(mockedWsCommand).toHaveBeenNthCalledWith(3, 'http://10.201.0.1:8123', 'token-abc', {
      type: 'config/auth/update',
      user_id: 'user-1',
      is_active: true,
    });
    expect(result).toBe('updated');
  });

  it('reports failed when an existing user is found but the password change fails', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({
        success: true,
        result: [{ id: 'user-1', username: 'bob@example.com', name: 'Bob Jones', is_active: true, is_owner: false }],
      })
      .mockResolvedValueOnce({ success: false });
    const result = await provisionHomeAssistantUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
  });
});

describe('disableHomeAssistantUser', () => {
  it('skips when no admin account is tracked yet', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await disableHomeAssistantUser('bob@example.com');
    expect(result).toBe('admin-not-configured');
    expect(mockedWsCommand).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never lists', async () => {
    mockedToken.mockResolvedValue({ state: 'failed' });
    const result = await disableHomeAssistantUser('bob@example.com');
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedWsCommand).not.toHaveBeenCalled();
  });

  it('reports not-found when no user has that email as their HA username', async () => {
    mockedWsCommand.mockResolvedValueOnce({ success: true, result: [] });
    const result = await disableHomeAssistantUser('bob@example.com');
    expect(result).toBe('not-found');
  });

  it('disables the account found by email', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({
        success: true,
        result: [{ id: 'user-1', username: 'bob@example.com', name: 'Bob Jones', is_active: true, is_owner: false }],
      })
      .mockResolvedValueOnce({ success: true, result: null });

    const result = await disableHomeAssistantUser('bob@example.com');

    expect(mockedWsCommand).toHaveBeenNthCalledWith(2, 'http://10.201.0.1:8123', 'token-abc', {
      type: 'config/auth/update',
      user_id: 'user-1',
      is_active: false,
    });
    expect(result).toBe('disabled');
  });

  it('reports failed when the disable command itself fails', async () => {
    mockedWsCommand
      .mockResolvedValueOnce({
        success: true,
        result: [{ id: 'user-1', username: 'bob@example.com', name: 'Bob Jones', is_active: true, is_owner: false }],
      })
      .mockResolvedValueOnce({ success: false });
    const result = await disableHomeAssistantUser('bob@example.com');
    expect(result).toBe('failed');
  });
});
