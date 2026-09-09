import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAutheliaAdminUser } from './autheliaUsers';
import { buildAdminSeedEnvOverrides } from './adminSeedEnv';

vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
const mockedAdmin = vi.mocked(getAutheliaAdminUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig', groups: [] });
});

describe('buildAdminSeedEnvOverrides', () => {
  it('is empty for any service other than nocodb', async () => {
    expect(await buildAdminSeedEnvOverrides('bookstack')).toEqual({});
  });

  it('supplies NocoDB the Authelia admin email', async () => {
    expect(await buildAdminSeedEnvOverrides('nocodb')).toEqual({ NOCODB_ADMIN_EMAIL: 'mig@example.com' });
  });

  it('is empty for nocodb when there is no Authelia admin email yet', async () => {
    mockedAdmin.mockReturnValue(null);
    expect(await buildAdminSeedEnvOverrides('nocodb')).toEqual({});
  });
});
