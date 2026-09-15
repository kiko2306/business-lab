import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));
vi.mock('../utils/alertNotify', () => ({ publishAlert: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('./netbirdAuthFlow', () => ({ managementJsonPath: vi.fn(() => '/fake/management.json') }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('fs/promises', () => ({ default: { readFile: vi.fn() } }));

const execFileMock = vi.fn((..._args: unknown[]) => {
  const cb = _args[_args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
  cb(null, { stdout: '', stderr: '' });
});
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

import { getExposureConfig } from '../utils/exposureSettings';
import { publishAlert } from '../utils/alertNotify';
import { resolveComposeFile } from '../config/services';
import fs from 'fs/promises';

const mockedGetExposureConfig = vi.mocked(getExposureConfig);
const mockedPublishAlert = vi.mocked(publishAlert);
const mockedResolveComposeFile = vi.mocked(resolveComposeFile);
const mockedReadFile = vi.mocked(fs.readFile);

function allHealthy() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
}

function allUnreachable() {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockedGetExposureConfig.mockResolvedValue({
    baseDomain: 'example.com',
    npmApiUrl: '',
    npmEmail: '',
    npmPassword: '',
    cloudflareAccountId: '',
    cloudflareZoneId: '',
    cloudflareTunnelId: '',
    cloudflareApiToken: '',
  });
  mockedReadFile.mockResolvedValue(JSON.stringify({ Signal: { URI: 'businesslab-signal.tail122b53.ts.net:443' } }));
  mockedResolveComposeFile.mockImplementation((name: string) => ({
    projectName: name,
    appDir: `/apps/${name}`,
    composeFile: `/apps/${name}/docker-compose.yml`,
    composeArgs: `-f /apps/${name}/docker-compose.yml`,
  }));
  execFileMock.mockClear();
  mockedPublishAlert.mockResolvedValue(true);
});

describe('checkCriticalServices', () => {
  it('does nothing when every probe is reachable', async () => {
    allHealthy();
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await checkCriticalServices();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mockedPublishAlert).not.toHaveBeenCalled();
  });

  it('restarts the owning compose project after 3 consecutive failures, not before', async () => {
    allUnreachable();
    const { checkCriticalServices } = await import('./criticalServiceHealth');

    await checkCriticalServices();
    await checkCriticalServices();
    expect(execFileMock).not.toHaveBeenCalled();

    await checkCriticalServices();
    // Tailscale + the two NetBird probes (management, relay) all fail together
    // here, but NetBird's project is one compose file — restarted at most once
    // per pass per project, not once per failing probe within it.
    const restartedProjects = execFileMock.mock.calls.map((call) => (call[1] as string[])[2]);
    expect(new Set(restartedProjects)).toEqual(new Set(['tailscale', 'netbird-vpn']));
    expect(mockedPublishAlert).toHaveBeenCalled();
  });

  it('does not restart again inside the cooldown window even if still down', async () => {
    allUnreachable();
    const { checkCriticalServices } = await import('./criticalServiceHealth');

    await checkCriticalServices();
    await checkCriticalServices();
    await checkCriticalServices(); // triggers the first restart
    execFileMock.mockClear();
    mockedPublishAlert.mockClear();

    await checkCriticalServices();
    await checkCriticalServices();
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mockedPublishAlert).not.toHaveBeenCalled();
  });

  it('resets the failure count once a probe recovers', async () => {
    allUnreachable();
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await checkCriticalServices();
    await checkCriticalServices();

    allHealthy();
    await checkCriticalServices(); // recovers before hitting the 3-failure threshold

    allUnreachable();
    await checkCriticalServices();
    await checkCriticalServices();
    expect(execFileMock).not.toHaveBeenCalled(); // only 2 consecutive since the recovery
  });

  it('quietly no-ops the restart when the service has no compose file (not installed)', async () => {
    allUnreachable();
    mockedResolveComposeFile.mockReturnValue(null);
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await checkCriticalServices();
    await checkCriticalServices();
    await checkCriticalServices();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
