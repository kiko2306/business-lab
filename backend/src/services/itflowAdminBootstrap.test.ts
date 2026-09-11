import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAppTimezone } from '../utils/generalSettings';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { getSetupState, runSetupWizard } from './itflowClient';
import { runItflowDbScript } from './itflowDb';
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
vi.mock('./itflowDb', () => ({ runItflowDbScript: vi.fn() }));
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
const mockedDbScript = vi.mocked(runItflowDbScript);

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
  mockedReadEnv.mockImplementation((_service, key) => {
    switch (key) {
      case 'ITFLOW_ADMIN_PASSWORD':
        return 'generated-itflow-pw';
      case 'ITFLOW_DB_PASSWORD':
        return 'generated-db-pw';
      case 'ITFLOW_DB_NAME':
        return 'itflow';
      case 'ITFLOW_DB_USER':
        return 'itflow';
      default:
        return null;
    }
  });
  mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@example.com', displayName: 'Mig T', groups: [] });
  mockedState.mockResolvedValue('needs-setup');
  mockedWizard.mockResolvedValue('completed');
  mockedDbScript.mockResolvedValue({ ok: true, output: 'hlm: admin identity synced to mig@example.com' });
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

  it('skips when the DB password is not set (cannot run the wizard database step)', async () => {
    mockedReadEnv.mockImplementation((_s, key) => (key === 'ITFLOW_ADMIN_PASSWORD' ? 'pw' : null));
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
      dbHost: 'itflow-db',
      dbName: 'itflow',
      dbUser: 'itflow',
      dbPassword: 'generated-db-pw',
    });
  });

  it('treats an already-complete setup as success without POSTing, and re-syncs the admin identity', async () => {
    mockedState.mockResolvedValue('already-setup');
    await expect(reconcileItflowFirstAdmin('itflow')).resolves.toBeUndefined();
    expect(mockedWizard).not.toHaveBeenCalled();

    // §350's own proof: the wizard's one-shot admin creation can leave a stale
    // email (it ran against a placeholder once) with no later way to fix it —
    // this re-sync is what keeps it converging on the *current* Authelia admin.
    expect(mockedDbScript).toHaveBeenCalledTimes(1);
    const [script, opts] = mockedDbScript.mock.calls[0];
    expect(script.join('\n')).toContain('UPDATE users SET user_email = ?, user_name = ? WHERE user_id = 1');
    expect(opts?.env?.ITFLOW_ADMIN_EMAIL).toBe('mig@example.com');
    expect(opts?.env?.ITFLOW_ADMIN_NAME).toBe('Mig T');
    // The email/name never appear literally in the script — only via getenv().
    expect(script.join('\n')).not.toContain('mig@example.com');
  });

  it('retries while unreachable then gives up without throwing', async () => {
    vi.useFakeTimers();
    mockedState.mockResolvedValue('unreachable');
    try {
      const pending = reconcileItflowFirstAdmin('itflow');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBeUndefined();
      expect(mockedState).toHaveBeenCalledTimes(30);
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
