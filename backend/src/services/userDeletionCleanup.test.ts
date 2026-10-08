import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({ query }));

const { getUserAppAccess } = vi.hoisted(() => ({ getUserAppAccess: vi.fn() }));
vi.mock('./userAppAccess', () => ({ getUserAppAccess }));

const { deprovisionNoSsoCredentials } = vi.hoisted(() => ({ deprovisionNoSsoCredentials: vi.fn() }));
vi.mock('./noSsoCredentialFanout', () => ({ deprovisionNoSsoCredentials }));

import { deprovisionNoSsoAppsForUser } from './userDeletionCleanup';

describe('deprovisionNoSsoAppsForUser', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locks the account in every app the user was granted, using their email', async () => {
    query.mockResolvedValue({ rows: [{ email: 'a@b.pt' }] });
    getUserAppAccess.mockResolvedValue(['samba', 'vaultwarden']);

    await deprovisionNoSsoAppsForUser(7);

    expect(deprovisionNoSsoCredentials).toHaveBeenCalledWith(['samba', 'vaultwarden'], 'a@b.pt');
  });

  it('does nothing for an account with no email or no grants', async () => {
    query.mockResolvedValue({ rows: [{ email: null }] });
    getUserAppAccess.mockResolvedValue(['samba']);
    await deprovisionNoSsoAppsForUser(7);

    query.mockResolvedValue({ rows: [{ email: 'a@b.pt' }] });
    getUserAppAccess.mockResolvedValue([]);
    await deprovisionNoSsoAppsForUser(8);

    expect(deprovisionNoSsoCredentials).not.toHaveBeenCalled();
  });
});
