import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { readAppEnvValue } from './appEnv';
import { guacamoleLogin, guacamoleLogout, guacamoleSetPassword } from './guacamoleClient';
import { reconcileGuacamoleAdminPassword } from './guacamoleAdminRotate';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./guacamoleClient', () => ({
  guacamoleLogin: vi.fn(),
  guacamoleLogout: vi.fn(),
  guacamoleSetPassword: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedLogin = vi.mocked(guacamoleLogin);
const mockedLogout = vi.mocked(guacamoleLogout);
const mockedSetPassword = vi.mocked(guacamoleSetPassword);

const resolved = (name: string) =>
  ({
    projectName: name,
    appDir: `/apps/${name}`,
    composeFile: `/apps/${name}/docker-compose.yml`,
    composeArgs: `-f /apps/${name}/docker-compose.yml`,
  }) as ReturnType<typeof resolveComposeFile>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockedResolve.mockImplementation((name: string) => resolved(name));
  mockedPort.mockReturnValue(10430);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedReadEnv.mockReturnValue('generated-secret');
});

describe('reconcileGuacamoleAdminPassword', () => {
  it('is a no-op for any service other than guacamole', async () => {
    await reconcileGuacamoleAdminPassword('nextcloud');

    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('is a no-op when guacamole is not installed', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'guacamole',
      appDir: '/apps/guacamole',
      composeFile: null,
      composeArgs: '',
    } as ReturnType<typeof resolveComposeFile>);

    await reconcileGuacamoleAdminPassword('guacamole');

    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('logs and returns when the generated password was never set', async () => {
    mockedReadEnv.mockReturnValue(null);

    await reconcileGuacamoleAdminPassword('guacamole');

    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('rotates the default password on a successful default-credential login', async () => {
    mockedLogin.mockResolvedValueOnce({ authToken: 'tok', dataSource: 'postgresql' });
    mockedSetPassword.mockResolvedValueOnce(true);

    await reconcileGuacamoleAdminPassword('guacamole');

    expect(mockedLogin).toHaveBeenCalledWith('http://10.201.0.1:10430', 'guacadmin', 'guacadmin');
    expect(mockedSetPassword).toHaveBeenCalledWith(
      'http://10.201.0.1:10430',
      { authToken: 'tok', dataSource: 'postgresql' },
      'guacadmin',
      'guacadmin',
      'generated-secret'
    );
    expect(mockedLogout).toHaveBeenCalledWith('http://10.201.0.1:10430', { authToken: 'tok', dataSource: 'postgresql' });
  });

  it('does nothing further once the default credentials are already rejected', async () => {
    mockedLogin.mockResolvedValueOnce(null);

    await reconcileGuacamoleAdminPassword('guacamole');

    expect(mockedSetPassword).not.toHaveBeenCalled();
    expect(mockedLogout).not.toHaveBeenCalled();
  });

  it('retries on a network failure and rotates once the app becomes reachable', async () => {
    mockedLogin
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ authToken: 'tok', dataSource: 'postgresql' });
    mockedSetPassword.mockResolvedValueOnce(true);

    const pending = reconcileGuacamoleAdminPassword('guacamole');
    // Pump the two 3s retry delays (setTimeout) without a real 6s wait.
    await vi.runAllTimersAsync();
    await pending;

    expect(mockedLogin).toHaveBeenCalledTimes(3);
    expect(mockedSetPassword).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget without rotating', async () => {
    mockedLogin.mockRejectedValue(new Error('ECONNREFUSED'));

    const pending = reconcileGuacamoleAdminPassword('guacamole');
    await vi.runAllTimersAsync();
    await pending;

    expect(mockedLogin).toHaveBeenCalledTimes(20);
    expect(mockedSetPassword).not.toHaveBeenCalled();
  });
});
