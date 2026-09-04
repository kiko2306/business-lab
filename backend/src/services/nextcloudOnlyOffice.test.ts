import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { getServiceExposureRow } from './exposure';
import { getHostGatewayIp } from '../utils/network';
import { reconcileNextcloudOnlyOffice, buildNextcloudOnlyOfficePlan, __test } from './nextcloudOnlyOffice';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn(), getPublishedUpstreamPort: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedEnv = vi.mocked(readAppEnvValue);
const mockedExposure = vi.mocked(getServiceExposureRow);
const mockedGateway = vi.mocked(getHostGatewayIp);

function execSucceeds(stdout = 'hlm: OnlyOffice connector configured') {
  mockedExec.mockImplementation(((_cmd: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, stdout, '');
  }) as unknown as typeof exec);
}

const resolved = (name: string) => ({
  projectName: name,
  appDir: `/apps/${name}`,
  composeFile: `/apps/${name}/docker-compose.yml`,
  composeArgs: `-f /apps/${name}/docker-compose.yml`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockImplementation((name: string) => resolved(name) as ReturnType<typeof resolveComposeFile>);
  mockedEnv.mockImplementation((_s: string, key: string) =>
    key === 'ONLYOFFICE_JWT_SECRET' ? 'shhh-secret' : null
  );
  mockedPort.mockImplementation((name: string) => (name === 'onlyoffice' ? 10460 : 10260));
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExposure.mockResolvedValue(null);
});

describe('buildWiringScript', () => {
  const script = __test
    .buildWiringScript('https://oo.example.com/', 'http://10.201.0.1:10460/', 'http://10.201.0.1:10260/')
    .join('\n');

  it('installs the connector only when absent, then always enables it', () => {
    expect(script).toContain('if ! php occ app:getpath onlyoffice');
    expect(script).toContain('php occ app:install onlyoffice');
    expect(script).toContain('php occ app:enable onlyoffice');
  });

  it('sets the browser URL, the internal URL and the storage URL', () => {
    expect(script).toContain('config:app:set onlyoffice DocumentServerUrl --value "https://oo.example.com/"');
    expect(script).toContain('config:app:set onlyoffice DocumentServerInternalUrl --value "http://10.201.0.1:10460/"');
    expect(script).toContain('config:app:set onlyoffice StorageUrl --value "http://10.201.0.1:10260/"');
  });

  it('passes the JWT secret through the environment, never inline', () => {
    expect(script).toContain('jwt_secret --value "$OO_JWT_SECRET"');
    expect(script).not.toContain('shhh-secret');
  });
});

describe('buildNextcloudOnlyOfficePlan', () => {
  it('uses OnlyOffice\'s public hostname for the browser URL when it is exposed', async () => {
    mockedExposure.mockResolvedValue({
      enabled: true,
      status: 'provisioned',
      hostname: 'onlyoffice.example.com',
    } as Awaited<ReturnType<typeof getServiceExposureRow>>);

    const plan = await buildNextcloudOnlyOfficePlan();
    expect(plan).toMatchObject({
      documentServerUrl: 'https://onlyoffice.example.com/',
      internalUrl: 'http://10.201.0.1:10460/',
      storageUrl: 'http://10.201.0.1:10260/',
      jwtSecret: 'shhh-secret',
      jwtHeader: 'Authorization',
    });
  });

  it('falls back to the internal gateway URL for the browser leg when OnlyOffice is LAN-only', async () => {
    const plan = await buildNextcloudOnlyOfficePlan();
    expect(plan?.documentServerUrl).toBe('http://10.201.0.1:10460/');
  });

  it('returns null (does not wire) when OnlyOffice has no generated JWT secret yet', async () => {
    mockedEnv.mockReturnValue(null);
    expect(await buildNextcloudOnlyOfficePlan()).toBeNull();
  });

  it('returns null when a published port cannot be resolved', async () => {
    mockedPort.mockReturnValue(null);
    expect(await buildNextcloudOnlyOfficePlan()).toBeNull();
  });

  it('returns null when OnlyOffice is not in the registry', async () => {
    mockedResolve.mockImplementation((name: string) =>
      name === 'onlyoffice'
        ? ({ projectName: 'onlyoffice', appDir: '/apps/onlyoffice', composeFile: null, composeArgs: '' } as ReturnType<
            typeof resolveComposeFile
          >)
        : (resolved(name) as ReturnType<typeof resolveComposeFile>)
    );
    expect(await buildNextcloudOnlyOfficePlan()).toBeNull();
  });
});

describe('reconcileNextcloudOnlyOffice', () => {
  it('does nothing for any other service', async () => {
    execSucceeds();
    await reconcileNextcloudOnlyOffice('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs a throwaway www-data container with the secret in the environment', async () => {
    execSucceeds();
    await reconcileNextcloudOnlyOffice('nextcloud');

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const [command, opts] = mockedExec.mock.calls[0] as unknown as [string, { env: NodeJS.ProcessEnv }];
    expect(command).toContain('docker compose -p nextcloud');
    expect(command).toContain('run --rm --no-deps -T');
    expect(command).toContain('--user www-data');
    expect(command).toContain('-e OO_JWT_SECRET -e OO_JWT_HEADER');
    expect(command).not.toContain('shhh-secret');
    expect(opts.env.OO_JWT_SECRET).toBe('shhh-secret');
  });

  it('keeps the JWT secret out of the log even if occ echoes it back', async () => {
    const logger = (await import('../utils/logger')).default;
    execSucceeds("jwt_secret ... is now set to 'shhh-secret'\nhlm: OnlyOffice connector configured");
    await reconcileNextcloudOnlyOffice('nextcloud');

    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain('shhh-secret');
    expect(logged).toContain('***');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'boom');
    }) as unknown as typeof exec);
    await expect(reconcileNextcloudOnlyOffice('nextcloud')).resolves.toBeUndefined();
  });
});
