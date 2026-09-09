import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getService, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { createOwner, getOnboardingState } from './homeAssistantClient';
import { reconcileHomeAssistantFirstAdmin } from './homeAssistantAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getService: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./homeAssistantClient', () => ({ getOnboardingState: vi.fn(), createOwner: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedGetService = vi.mocked(getService);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedState = vi.mocked(getOnboardingState);
const mockedCreate = vi.mocked(createOwner);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'home-assistant',
    appDir: '/apps/home-assistant',
    composeFile: '/apps/home-assistant/docker-compose.yml',
    composeArgs: '-f /apps/home-assistant/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
  mockedGetService.mockReturnValue({ hostNetworkPort: 8123 } as ReturnType<typeof getService>);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExposure.mockResolvedValue({
    enabled: true,
    hostname: 'ha.example.com',
  } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  mockedReadEnv.mockReturnValue('generated-ha-pw');
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig T', groups: [] });
  mockedState.mockResolvedValue('needs-user');
  mockedCreate.mockResolvedValue('created');
});

describe('reconcileHomeAssistantFirstAdmin', () => {
  it('is a no-op for a service other than home-assistant', async () => {
    await reconcileHomeAssistantFirstAdmin('immich');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when HA is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileHomeAssistantFirstAdmin('home-assistant');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when HA is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileHomeAssistantFirstAdmin('home-assistant');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('skips when the admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await reconcileHomeAssistantFirstAdmin('home-assistant');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileHomeAssistantFirstAdmin('home-assistant');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('creates the owner with the Authelia username, generated password and https client_id', async () => {
    await reconcileHomeAssistantFirstAdmin('home-assistant');
    expect(mockedState).toHaveBeenCalledWith('http://10.201.0.1:8123');
    expect(mockedCreate).toHaveBeenCalledWith('http://10.201.0.1:8123', {
      name: 'Mig T',
      username: 'mig',
      password: 'generated-ha-pw',
      clientId: 'https://ha.example.com/',
      language: 'en',
    });
  });

  it('treats a completed onboarding as success without POSTing', async () => {
    mockedState.mockResolvedValue('done');
    await expect(reconcileHomeAssistantFirstAdmin('home-assistant')).resolves.toBeUndefined();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('retries while unreachable then gives up without throwing', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue('unreachable');
    try {
      const pending = reconcileHomeAssistantFirstAdmin('home-assistant');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedState).toHaveBeenCalledTimes(30);
      expect(mockedCreate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
