import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { createFirstAdmin, getSetupState } from './docusealClient';
import { reconcileDocusealFirstAdmin } from './docusealAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./docusealClient', () => ({ getSetupState: vi.fn(), createFirstAdmin: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedState = vi.mocked(getSetupState);
const mockedCreate = vi.mocked(createFirstAdmin);

const resolved = () =>
  ({
    projectName: 'docuseal',
    appDir: '/apps/docuseal',
    composeFile: '/apps/docuseal/docker-compose.yml',
    composeArgs: '-f /apps/docuseal/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue(resolved());
  mockedPort.mockReturnValue(10150);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExposure.mockResolvedValue({
    enabled: true,
    hostname: 'docuseal.example.com',
  } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  mockedReadEnv.mockReturnValue('generated-docuseal-pw');
  mockedAdmin.mockReturnValue({
    username: 'mig',
    email: 'mig@example.com',
    displayName: 'Mig Teixeira',
    groups: ['admins'],
  });
  mockedState.mockResolvedValue({ state: 'needs-setup', token: 'csrf-tok', cookie: '_docuseal_session=abc' });
  mockedCreate.mockResolvedValue('created');
});

describe('reconcileDocusealFirstAdmin', () => {
  it('is a no-op for any service other than docuseal', async () => {
    await reconcileDocusealFirstAdmin('immich');
    expect(mockedState).not.toHaveBeenCalled();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when docuseal is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when docuseal is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('skips when the admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin email', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('creates the first admin with the Authelia email, generated password and https app URL', async () => {
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedState).toHaveBeenCalledWith('http://10.201.0.1:10150');
    expect(mockedCreate).toHaveBeenCalledWith('http://10.201.0.1:10150', {
      token: 'csrf-tok',
      cookie: '_docuseal_session=abc',
      email: 'mig@example.com',
      password: 'generated-docuseal-pw',
      firstName: 'Mig',
      lastName: 'Teixeira',
      accountName: 'DocuSeal',
      appUrl: 'https://docuseal.example.com',
    });
  });

  it('treats an already-completed setup as success without posting', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    await expect(reconcileDocusealFirstAdmin('docuseal')).resolves.toBeUndefined();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('retries while unreachable, then gives up without throwing', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue({ state: 'unreachable' });
    try {
      const pending = reconcileDocusealFirstAdmin('docuseal');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedState).toHaveBeenCalledTimes(20);
      expect(mockedCreate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to Admin / User when the Authelia admin has no display name', async () => {
    mockedAdmin.mockReturnValue({ username: 'x', email: 'x@example.com', displayName: '', groups: [] });
    await reconcileDocusealFirstAdmin('docuseal');
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ firstName: 'Admin', lastName: 'User' })
    );
  });
});
