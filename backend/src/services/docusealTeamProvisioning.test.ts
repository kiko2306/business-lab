import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue } from './appEnv';
import { DOCUSEAL_ADMIN_EMAIL_KEY, DOCUSEAL_ADMIN_PASSWORD_KEY, resolveDocusealBaseUrl } from './docusealAdminBootstrap';
import { createTeamUser, signIn } from './docusealClient';
import { provisionDocusealTeamMember } from './docusealTeamProvisioning';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./docusealAdminBootstrap', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./docusealAdminBootstrap')>()),
  resolveDocusealBaseUrl: vi.fn(),
}));
vi.mock('./docusealClient', () => ({ createTeamUser: vi.fn(), signIn: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedBaseUrl = vi.mocked(resolveDocusealBaseUrl);
const mockedSignIn = vi.mocked(signIn);
const mockedCreate = vi.mocked(createTeamUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockedReadEnv.mockImplementation((_service, key) => {
    if (key === DOCUSEAL_ADMIN_EMAIL_KEY) return 'admin@example.com';
    if (key === DOCUSEAL_ADMIN_PASSWORD_KEY) return 'admin-pw';
    return null;
  });
  mockedBaseUrl.mockResolvedValue('http://10.201.0.1:10150');
  mockedSignIn.mockResolvedValue({ state: 'signed-in', cookie: '_docuseal_session=admin' });
  mockedCreate.mockResolvedValue('created');
});

describe('provisionDocusealTeamMember', () => {
  it('skips when no admin account is tracked yet', async () => {
    mockedReadEnv.mockReturnValue(null);
    const result = await provisionDocusealTeamMember({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-not-configured');
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('reports admin-sign-in-failed and never attempts to create', async () => {
    mockedSignIn.mockResolvedValue({ state: 'failed' });
    const result = await provisionDocusealTeamMember({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('admin-sign-in-failed');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('signs in as the tracked admin and creates the team member, splitting the display name', async () => {
    const result = await provisionDocusealTeamMember({
      email: 'bob@example.com',
      password: 'pw',
      displayName: 'Bob Jones',
    });
    expect(mockedSignIn).toHaveBeenCalledWith('http://10.201.0.1:10150', 'admin@example.com', 'admin-pw');
    expect(mockedCreate).toHaveBeenCalledWith('http://10.201.0.1:10150', {
      cookie: '_docuseal_session=admin',
      email: 'bob@example.com',
      password: 'pw',
      firstName: 'Bob',
      lastName: 'Jones',
    });
    expect(result).toBe('created');
  });

  it('falls back to Admin / User with no display name', async () => {
    await provisionDocusealTeamMember({ email: 'bob@example.com', password: 'pw' });
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ firstName: 'Admin', lastName: 'User' })
    );
  });

  it('passes through already-exists', async () => {
    mockedCreate.mockResolvedValue('already-exists');
    const result = await provisionDocusealTeamMember({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('already-exists');
  });

  it('passes through failed', async () => {
    mockedCreate.mockResolvedValue('failed');
    const result = await provisionDocusealTeamMember({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
  });
});
