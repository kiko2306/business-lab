import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue, saveServiceEnv } from './appEnv';
import { createFirstAdmin, getSetupState, signIn, updateProfileEmail } from './docusealClient';
import {
  DOCUSEAL_ADMIN_EMAIL_KEY,
  DOCUSEAL_ADMIN_PASSWORD_KEY,
  reconcileDocusealFirstAdmin,
} from './docusealAdminBootstrap';

vi.mock('../config/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config/services')>()),
  resolveComposeFile: vi.fn(),
  getPublishedUpstreamPort: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn(), saveServiceEnv: vi.fn() }));
vi.mock('./docusealClient', () => ({
  getSetupState: vi.fn(),
  createFirstAdmin: vi.fn(),
  signIn: vi.fn(),
  updateProfileEmail: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedSaveEnv = vi.mocked(saveServiceEnv);
const mockedState = vi.mocked(getSetupState);
const mockedCreate = vi.mocked(createFirstAdmin);
const mockedSignIn = vi.mocked(signIn);
const mockedUpdateEmail = vi.mocked(updateProfileEmail);

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
  mockedReadEnv.mockImplementation((_service, key) =>
    key === DOCUSEAL_ADMIN_PASSWORD_KEY ? 'generated-docuseal-pw' : null
  );
  mockedAdmin.mockReturnValue({
    username: 'mig',
    email: 'mig@example.com',
    displayName: 'Mig Teixeira',
    groups: ['admins'],
  });
  mockedState.mockResolvedValue({ state: 'needs-setup', token: 'csrf-tok', cookie: '_docuseal_session=abc' });
  mockedCreate.mockResolvedValue('created');
  mockedSignIn.mockResolvedValue({ state: 'failed' });
  mockedUpdateEmail.mockResolvedValue('updated');
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
    // Records what it just created so a future run can tell a drift apart
    // from "nothing to sync" without guessing.
    expect(mockedSaveEnv).toHaveBeenCalledWith('docuseal', { [DOCUSEAL_ADMIN_EMAIL_KEY]: 'mig@example.com' });
  });

  it('already-setup + tracked email matches Authelia: no-op, no sign-in attempted', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    mockedReadEnv.mockImplementation((_service, key) =>
      key === DOCUSEAL_ADMIN_PASSWORD_KEY ? 'generated-docuseal-pw' : 'mig@example.com'
    );
    await expect(reconcileDocusealFirstAdmin('docuseal')).resolves.toBeUndefined();
    expect(mockedCreate).not.toHaveBeenCalled();
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('already-setup + email drifted: signs in as the tracked email and updates the profile', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    mockedReadEnv.mockImplementation((_service, key) =>
      key === DOCUSEAL_ADMIN_PASSWORD_KEY ? 'generated-docuseal-pw' : 'old@example.com'
    );
    mockedSignIn.mockResolvedValue({ state: 'signed-in', cookie: '_docuseal_session=fresh' });

    await reconcileDocusealFirstAdmin('docuseal');

    expect(mockedSignIn).toHaveBeenCalledWith('http://10.201.0.1:10150', 'old@example.com', 'generated-docuseal-pw');
    expect(mockedUpdateEmail).toHaveBeenCalledWith('http://10.201.0.1:10150', {
      cookie: '_docuseal_session=fresh',
      email: 'mig@example.com',
      firstName: 'Mig',
      lastName: 'Teixeira',
    });
    expect(mockedSaveEnv).toHaveBeenCalledWith('docuseal', { [DOCUSEAL_ADMIN_EMAIL_KEY]: 'mig@example.com' });
  });

  it('already-setup + no tracked email recorded yet: falls back to the known pre-existing install default', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    mockedSignIn.mockResolvedValue({ state: 'signed-in', cookie: '_docuseal_session=fresh' });

    await reconcileDocusealFirstAdmin('docuseal');

    expect(mockedSignIn).toHaveBeenCalledWith(
      'http://10.201.0.1:10150',
      'admin@example.com',
      'generated-docuseal-pw'
    );
  });

  it('already-setup + drifted + sign-in fails: warns and never attempts the update', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    mockedReadEnv.mockImplementation((_service, key) =>
      key === DOCUSEAL_ADMIN_PASSWORD_KEY ? 'generated-docuseal-pw' : 'old@example.com'
    );
    mockedSignIn.mockResolvedValue({ state: 'failed' });

    await expect(reconcileDocusealFirstAdmin('docuseal')).resolves.toBeUndefined();

    expect(mockedUpdateEmail).not.toHaveBeenCalled();
    expect(mockedSaveEnv).not.toHaveBeenCalled();
  });

  it('already-setup + drifted + update rejected: does not record a new tracked email', async () => {
    mockedState.mockResolvedValue({ state: 'already-setup' });
    mockedReadEnv.mockImplementation((_service, key) =>
      key === DOCUSEAL_ADMIN_PASSWORD_KEY ? 'generated-docuseal-pw' : 'old@example.com'
    );
    mockedSignIn.mockResolvedValue({ state: 'signed-in', cookie: '_docuseal_session=fresh' });
    mockedUpdateEmail.mockResolvedValue('failed');

    await reconcileDocusealFirstAdmin('docuseal');

    expect(mockedSaveEnv).not.toHaveBeenCalled();
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
