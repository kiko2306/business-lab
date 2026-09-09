import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAppTimezone } from '../utils/generalSettings';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { getSetupState, runSetupWizard } from './itflowClient';
import { reconcileItflowFirstAdmin } from './itflowAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../utils/generalSettings', () => ({ getAppTimezone: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./itflowClient', () => ({ getSetupState: vi.fn(), runSetupWizard: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedTz = vi.mocked(getAppTimezone);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedState = vi.mocked(getSetupState);
const mockedWizard = vi.mocked(runSetupWizard);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'itflow',
    appDir: '/apps/itflow',
    composeFile: '/apps/itflow/docker-compose.yml',
    composeArgs: '-f /apps/itflow/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
  mockedPort.mockReturnValue(10420);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedTz.mockResolvedValue('Europe/Lisbon');
  mockedExposure.mockResolvedValue({ enabled: true } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  mockedReadEnv.mockReturnValue('generated-itflow-pw');
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig T', groups: [] });
  mockedState.mockResolvedValue('needs-setup');
  mockedWizard.mockResolvedValue('completed');
});

describe('reconcileItflowFirstAdmin', () => {
  it('is a no-op for a service other than itflow', async () => {
    await reconcileItflowFirstAdmin('nocodb');
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('is a no-op when itflow is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('is a no-op when itflow is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('skips when the admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin email', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('runs the wizard with the Authelia name/email, generated password and app timezone', async () => {
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedState).toHaveBeenCalledWith('http://10.201.0.1:10420');
    expect(mockedWizard).toHaveBeenCalledWith('http://10.201.0.1:10420', {
      name: 'Mig T',
      email: 'mig@example.com',
      password: 'generated-itflow-pw',
      companyName: 'Company',
      timezone: 'Europe/Lisbon',
    });
  });

  it('treats an already-complete setup as success without POSTing', async () => {
    mockedState.mockResolvedValue('already-setup');
    await expect(reconcileItflowFirstAdmin('itflow')).resolves.toBeUndefined();
    expect(mockedWizard).not.toHaveBeenCalled();
  });

  it('keeps polling while not-ready (schema still migrating) and never runs the wizard', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue('not-ready');
    try {
      const pending = reconcileItflowFirstAdmin('itflow');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedState).toHaveBeenCalledTimes(60);
      expect(mockedWizard).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('also gives up cleanly when it stays unreachable', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue('unreachable');
    try {
      const pending = reconcileItflowFirstAdmin('itflow');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedWizard).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to Admin / UTC when the Authelia admin has no name and the tz lookup fails', async () => {
    mockedAdmin.mockReturnValue({ username: 'x', email: 'x@example.com', displayName: '', groups: [] });
    mockedTz.mockRejectedValue(new Error('no db'));
    await reconcileItflowFirstAdmin('itflow');
    expect(mockedWizard).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'Admin', timezone: 'UTC' })
    );
  });
});
