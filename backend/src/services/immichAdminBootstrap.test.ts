import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { immichAdminSignUp, immichPing } from './immichClient';
import { reconcileImmichFirstAdmin } from './immichAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./immichClient', () => ({ immichPing: vi.fn(), immichAdminSignUp: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedPing = vi.mocked(immichPing);
const mockedSignUp = vi.mocked(immichAdminSignUp);

const resolved = () =>
  ({
    projectName: 'immich',
    appDir: '/apps/immich',
    composeFile: '/apps/immich/docker-compose.yml',
    composeArgs: '-f /apps/immich/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue(resolved());
  mockedPort.mockReturnValue(10200);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExposure.mockResolvedValue({ enabled: true } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  mockedReadEnv.mockReturnValue('generated-immich-pw');
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig', groups: ['admins'] });
  mockedPing.mockResolvedValue(true);
  mockedSignUp.mockResolvedValue('created');
});

describe('reconcileImmichFirstAdmin', () => {
  it('is a no-op for any service other than immich', async () => {
    await reconcileImmichFirstAdmin('mealie');
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('is a no-op when immich is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileImmichFirstAdmin('immich');
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('is a no-op when immich is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileImmichFirstAdmin('immich');
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin email to link to', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileImmichFirstAdmin('immich');
    expect(mockedSignUp).not.toHaveBeenCalled();
  });

  it('signs up the first admin with the Authelia email and generated password', async () => {
    await reconcileImmichFirstAdmin('immich');
    expect(mockedSignUp).toHaveBeenCalledWith(
      'http://10.201.0.1:10200',
      'mig@example.com',
      'generated-immich-pw',
      'Admin'
    );
  });

  it('treats an existing admin as success (idempotent)', async () => {
    mockedSignUp.mockResolvedValue('already-exists');
    await expect(reconcileImmichFirstAdmin('immich')).resolves.toBeUndefined();
    expect(mockedSignUp).toHaveBeenCalledTimes(1);
  });
});
