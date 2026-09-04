import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import {
  reconcileNextcloudClamav,
  buildNextcloudClamavPlan,
  buildAntivirusScript,
} from './nextcloudClamav';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn(), getPublishedUpstreamPort: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);
const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);

const resolved = (name: string) => ({
  projectName: name,
  appDir: `/apps/${name}`,
  composeFile: `/apps/${name}/docker-compose.yml`,
  composeArgs: `-f /apps/${name}/docker-compose.yml`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockImplementation((name: string) => resolved(name) as ReturnType<typeof resolveComposeFile>);
  mockedPort.mockReturnValue(10450);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, 'hlm: files_antivirus configured', '');
  }) as unknown as typeof exec);
});

describe('buildAntivirusScript', () => {
  const script = buildAntivirusScript('10.201.0.1', 10450).join('\n');

  it('installs the app only when absent, then enables and points it at clamd', () => {
    expect(script).toContain('if ! php occ app:getpath files_antivirus');
    expect(script).toContain('php occ app:install files_antivirus');
    expect(script).toContain('php occ app:enable files_antivirus');
    expect(script).toContain('config:app:set files_antivirus av_mode --value "daemon"');
    expect(script).toContain('config:app:set files_antivirus av_host --value "10.201.0.1"');
    expect(script).toContain('config:app:set files_antivirus av_port --type integer --value "10450"');
  });

  it('deletes stored infected files and does not block uploads when clamd is down', () => {
    expect(script).toContain('av_infected_action --value "delete"');
    expect(script).toContain('av_block_unreachable --type boolean --value "false"');
  });
});

describe('buildNextcloudClamavPlan', () => {
  it('returns the host gateway and clamd published port', async () => {
    expect(await buildNextcloudClamavPlan()).toEqual({ host: '10.201.0.1', port: 10450 });
  });

  it('falls back to clamd\'s default port when the published port is unknown', async () => {
    mockedPort.mockReturnValue(null);
    expect(await buildNextcloudClamavPlan()).toEqual({ host: '10.201.0.1', port: 3310 });
  });

  it('returns null when ClamAV is not part of the deployment', async () => {
    mockedResolve.mockImplementation((name: string) =>
      name === 'clamav'
        ? ({ projectName: 'clamav', appDir: '/apps/clamav', composeFile: null, composeArgs: '' } as ReturnType<
            typeof resolveComposeFile
          >)
        : (resolved(name) as ReturnType<typeof resolveComposeFile>)
    );
    expect(await buildNextcloudClamavPlan()).toBeNull();
  });
});

describe('reconcileNextcloudClamav', () => {
  it('does nothing for any other service', async () => {
    await reconcileNextcloudClamav('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs the wiring in a www-data Nextcloud container', async () => {
    await reconcileNextcloudClamav('nextcloud');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p nextcloud');
    expect(command).toContain('run --rm --no-deps -T --user www-data');
  });

  it('skips quietly when ClamAV is not part of the deployment', async () => {
    mockedResolve.mockImplementation((name: string) =>
      name === 'clamav'
        ? ({ projectName: 'clamav', appDir: '/apps/clamav', composeFile: null, composeArgs: '' } as ReturnType<
            typeof resolveComposeFile
          >)
        : (resolved(name) as ReturnType<typeof resolveComposeFile>)
    );
    await reconcileNextcloudClamav('nextcloud');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'boom');
    }) as unknown as typeof exec);
    await expect(reconcileNextcloudClamav('nextcloud')).resolves.toBeUndefined();
  });
});
