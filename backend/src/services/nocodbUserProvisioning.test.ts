import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { findUserId, getAppSettings, inviteUser, saveAppSettings, setPassword, signIn } from './nocodbClient';
import { disableNocodbUser, ensureNocodbInviteOnlySignup, provisionNocodbUser } from './nocodbUserProvisioning';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('../config/services', () => ({ getPublishedUpstreamPort: vi.fn(() => 10280) }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn(async () => '10.201.0.1') }));
vi.mock('./nocodbClient', () => ({
  signIn: vi.fn(),
  inviteUser: vi.fn(),
  findUserId: vi.fn(),
  setPassword: vi.fn(),
  getAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedGetAdmin = vi.mocked(getAutheliaAdminUser);
const mockedSignIn = vi.mocked(signIn);
const mockedInvite = vi.mocked(inviteUser);
const mockedFindUserId = vi.mocked(findUserId);
const mockedSetPassword = vi.mocked(setPassword);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetAdmin.mockReturnValue({ username: 'admin', email: 'admin@example.com', displayName: 'Admin', groups: [] });
  mockedReadEnv.mockImplementation((_service, key) => {
    if (key === 'NOCODB_ADMIN_PASSWORD') return 'admin-pw';
    return null;
  });
  mockedSignIn.mockResolvedValue('admin-token');
  mockedInvite.mockResolvedValue('created');
  mockedFindUserId.mockResolvedValue('user-42');
  mockedSetPassword.mockResolvedValue(true);
});

describe('provisionNocodbUser', () => {
  it('skips when no admin account is tracked yet (no Authelia admin email)', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('skips when the generated admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never attempts to invite', async () => {
    mockedSignIn.mockResolvedValue(null);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedInvite).not.toHaveBeenCalled();
  });

  it('signs in as the tracked admin, invites, looks up the id and sets the password', async () => {
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(mockedSignIn).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin@example.com', 'admin-pw');
    expect(mockedInvite).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', 'bob@example.com');
    expect(mockedFindUserId).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', 'bob@example.com');
    expect(mockedSetPassword).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', 'user-42', 'pw');
    expect(result).toBe('created');
  });

  it('reports updated when the invite finds an existing account', async () => {
    mockedInvite.mockResolvedValue('already-exists');
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('updated');
  });

  it('reports failed when the invite itself fails', async () => {
    mockedInvite.mockResolvedValue('failed');
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
    expect(mockedFindUserId).not.toHaveBeenCalled();
  });

  it('reports failed when the invited user cannot be found afterwards', async () => {
    mockedFindUserId.mockResolvedValue(null);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });

  it('reports failed when a fresh invite could not get its password set', async () => {
    mockedSetPassword.mockResolvedValue(false);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
  });

  it('reports already-exists when an existing account could not get its password updated', async () => {
    mockedInvite.mockResolvedValue('already-exists');
    mockedSetPassword.mockResolvedValue(false);
    const result = await provisionNocodbUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('already-exists');
  });
});

describe('disableNocodbUser', () => {
  it('skips when no admin account is tracked yet', async () => {
    mockedGetAdmin.mockReturnValue(null);
    const result = await disableNocodbUser('bob@example.com');
    expect(result).toBe('admin-not-configured');
    expect(mockedFindUserId).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never looks up the account', async () => {
    mockedSignIn.mockResolvedValue(null);
    const result = await disableNocodbUser('bob@example.com');
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedFindUserId).not.toHaveBeenCalled();
  });

  it('reports not-found when no account exists for the email', async () => {
    mockedFindUserId.mockResolvedValue(null);
    const result = await disableNocodbUser('bob@example.com');
    expect(result).toBe('not-found');
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });

  it('locks the account by resetting its password to an unknown value', async () => {
    const result = await disableNocodbUser('bob@example.com');
    expect(mockedFindUserId).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', 'bob@example.com');
    expect(mockedSetPassword).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', 'user-42', expect.any(String));
    // The password handed to setPassword is never the caller's input — there is none — and isn't a fixed string.
    const usedPassword = mockedSetPassword.mock.calls[0][3];
    expect(usedPassword.length).toBeGreaterThanOrEqual(8);
    expect(result).toBe('disabled');
  });

  it('reports failed when the password reset itself fails', async () => {
    mockedSetPassword.mockResolvedValue(false);
    const result = await disableNocodbUser('bob@example.com');
    expect(result).toBe('failed');
  });
});

describe('ensureNocodbInviteOnlySignup', () => {
  const mockedGetSettings = vi.mocked(getAppSettings);
  const mockedSaveSettings = vi.mocked(saveAppSettings);

  it('turns invite-only on, keeping the other settings, when signup is open', async () => {
    mockedGetSettings.mockResolvedValue({ invite_only_signup: false, restrict_workspace_creation: false });
    mockedSaveSettings.mockResolvedValue(true);
    await ensureNocodbInviteOnlySignup('nocodb', 0);
    expect(mockedSaveSettings).toHaveBeenCalledWith('http://10.201.0.1:10280', 'admin-token', {
      invite_only_signup: true,
      restrict_workspace_creation: false,
    });
  });

  it('writes nothing when signup is already invite-only', async () => {
    mockedGetSettings.mockResolvedValue({ invite_only_signup: true });
    await ensureNocodbInviteOnlySignup('nocodb', 0);
    expect(mockedSaveSettings).not.toHaveBeenCalled();
  });

  // NocoDB answers sign-in only once it has booted, well after `up` returns.
  it('retries sign-in while NocoDB is still booting', async () => {
    mockedSignIn.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue('admin-token');
    mockedGetSettings.mockResolvedValue({ invite_only_signup: true });
    await ensureNocodbInviteOnlySignup('nocodb', 0);
    expect(mockedSignIn).toHaveBeenCalledTimes(3);
    expect(mockedGetSettings).toHaveBeenCalled();
  });

  it('ignores every other service', async () => {
    await ensureNocodbInviteOnlySignup('kimai', 0);
    expect(mockedSignIn).not.toHaveBeenCalled();
  });
});
