import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { reconcileKimaiAdminIdentity } from './kimaiDb';
import { KIMAI_ADMIN_PASSWORD_KEY, reconcileKimaiAdminAccount } from './kimaiAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
}));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./kimaiDb', () => ({ reconcileKimaiAdminIdentity: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedReconcile = vi.mocked(reconcileKimaiAdminIdentity);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'kimai',
    appDir: '/apps/kimai',
    composeFile: '/apps/kimai/docker-compose.yml',
    composeArgs: '-f /apps/kimai/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
  mockedExposure.mockResolvedValue({ enabled: true, hostname: 'kimai.example.com' } as Awaited<
    ReturnType<typeof getServiceExposureRow>
  >);
  mockedReadEnv.mockImplementation((_service, key) => (key === KIMAI_ADMIN_PASSWORD_KEY ? 'generated-kimai-pw' : null));
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig Teixeira', groups: ['admins'] });
  mockedReconcile.mockResolvedValue('unchanged');
});

describe('reconcileKimaiAdminAccount', () => {
  it('is a no-op for any service other than kimai', async () => {
    await reconcileKimaiAdminAccount('docuseal');
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('is a no-op when kimai is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileKimaiAdminAccount('kimai');
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('is a no-op when kimai is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileKimaiAdminAccount('kimai');
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('skips when the admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await reconcileKimaiAdminAccount('kimai');
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin email', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileKimaiAdminAccount('kimai');
    expect(mockedReconcile).not.toHaveBeenCalled();
  });

  it('reconciles with the current Authelia email and generated password', async () => {
    await reconcileKimaiAdminAccount('kimai');
    expect(mockedReconcile).toHaveBeenCalledWith('mig@example.com', 'generated-kimai-pw');
  });

  it('never throws when the reconcile reports failed', async () => {
    mockedReconcile.mockResolvedValue('failed');
    await expect(reconcileKimaiAdminAccount('kimai')).resolves.toBeUndefined();
  });

  it('never throws when no admin row exists yet', async () => {
    mockedReconcile.mockResolvedValue('not-found');
    await expect(reconcileKimaiAdminAccount('kimai')).resolves.toBeUndefined();
  });
});
