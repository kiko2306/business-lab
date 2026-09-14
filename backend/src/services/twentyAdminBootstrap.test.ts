import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { checkTwentyUserState, createTwentyWorkspace, getTwentyAccessToken } from './twentyClient';
import { reconcileTwentyFirstAdmin } from './twentyAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./twentyClient', () => ({
  checkTwentyUserState: vi.fn(),
  getTwentyAccessToken: vi.fn(),
  createTwentyWorkspace: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedState = vi.mocked(checkTwentyUserState);
const mockedToken = vi.mocked(getTwentyAccessToken);
const mockedCreateWorkspace = vi.mocked(createTwentyWorkspace);

const resolved = () =>
  ({
    projectName: 'twenty',
    appDir: '/apps/twenty',
    composeFile: '/apps/twenty/docker-compose.yml',
    composeArgs: '-f /apps/twenty/docker-compose.yml',
  }) as ReturnType<typeof resolveComposeFile>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue(resolved());
  mockedPort.mockReturnValue(10580);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExposure.mockResolvedValue({
    enabled: true,
    hostname: 'twenty.example.com',
  } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  mockedReadEnv.mockReturnValue('generated-twenty-pw');
  mockedAdmin.mockReturnValue({
    username: 'mig',
    email: 'mig@example.com',
    displayName: 'Mig Teixeira',
    groups: ['admins'],
  });
  mockedState.mockResolvedValue('needs-signup');
  mockedToken.mockResolvedValue('access-token');
  mockedCreateWorkspace.mockResolvedValue(true);
});

describe('reconcileTwentyFirstAdmin', () => {
  it('is a no-op for any service other than twenty', async () => {
    await reconcileTwentyFirstAdmin('immich');
    expect(mockedState).not.toHaveBeenCalled();
  });

  it('is a no-op when twenty is not installed', async () => {
    mockedResolve.mockReturnValue({ composeFile: null } as ReturnType<typeof resolveComposeFile>);
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedState).not.toHaveBeenCalled();
  });

  it('is a no-op when twenty is not exposed', async () => {
    mockedExposure.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedState).not.toHaveBeenCalled();
  });

  it('skips when the admin password is not set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedState).not.toHaveBeenCalled();
  });

  it('skips when there is no Authelia admin email', async () => {
    mockedAdmin.mockReturnValue(null);
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedState).not.toHaveBeenCalled();
  });

  it('signs up and creates the workspace on a fresh instance', async () => {
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedState).toHaveBeenCalledWith('http://10.201.0.1:10580', 'mig@example.com');
    expect(mockedToken).toHaveBeenCalledWith('http://10.201.0.1:10580', 'signUp', 'mig@example.com', 'generated-twenty-pw');
    expect(mockedCreateWorkspace).toHaveBeenCalledWith('http://10.201.0.1:10580', 'access-token', 'Business Lab');
  });

  it('resumes via signIn when our own account exists but has no workspace yet', async () => {
    mockedState.mockResolvedValue('needs-workspace');
    await reconcileTwentyFirstAdmin('twenty');
    expect(mockedToken).toHaveBeenCalledWith('http://10.201.0.1:10580', 'signIn', 'mig@example.com', 'generated-twenty-pw');
    expect(mockedCreateWorkspace).toHaveBeenCalled();
  });

  it('treats an already-owned workspace as success without signing up', async () => {
    mockedState.mockResolvedValue('already-owned');
    await expect(reconcileTwentyFirstAdmin('twenty')).resolves.toBeUndefined();
    expect(mockedToken).not.toHaveBeenCalled();
    expect(mockedCreateWorkspace).not.toHaveBeenCalled();
  });

  it('stops without guessing further when signUp/signIn returns no token (e.g. SIGNUP_DISABLED)', async () => {
    mockedToken.mockResolvedValue(null);
    await expect(reconcileTwentyFirstAdmin('twenty')).resolves.toBeUndefined();
    expect(mockedCreateWorkspace).not.toHaveBeenCalled();
  });

  it('retries while unreachable, then gives up without throwing', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue('unreachable');
    try {
      const pending = reconcileTwentyFirstAdmin('twenty');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedState).toHaveBeenCalledTimes(70);
      expect(mockedToken).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
