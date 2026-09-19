import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));
vi.mock('../utils/alertNotify', () => ({ publishAlert: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn(), getPublishedUpstreamPort: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn(async () => '10.201.0.1') }));
vi.mock('./netbirdAuthFlow', () => ({ managementJsonPath: vi.fn(() => '/fake/management.json') }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('fs/promises', () => ({ default: { readFile: vi.fn() } }));

const execFileMock = vi.fn((...args: unknown[]) => {
  const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
  cb(null, { stdout: '', stderr: '' });
});
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));

import { getExposureConfig } from '../utils/exposureSettings';
import { publishAlert } from '../utils/alertNotify';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import fs from 'fs/promises';
import { isDnsFailure, parseKumaMonitorStatus } from './criticalServiceHealth';

const mockedGetExposureConfig = vi.mocked(getExposureConfig);
const mockedPublishAlert = vi.mocked(publishAlert);
const mockedResolveComposeFile = vi.mocked(resolveComposeFile);
const mockedKumaPort = vi.mocked(getPublishedUpstreamPort);
const mockedReadFile = vi.mocked(fs.readFile);

const FUNNEL_URL = 'https://businesslab-signal.tail122b53.ts.net/';
const KUMA_METRICS = 'http://10.201.0.1:10370/metrics';

function kumaLine(url: string, status: number) {
  return `monitor_status{monitor_name="x",monitor_type="http",monitor_url="${url}",monitor_hostname="null",monitor_port="null"} ${status}`;
}

/**
 * Probes all fail or all succeed; Uptime Kuma's /metrics answers with the
 * given status for every probed URL, or is unreachable when kuma is null.
 */
function stubFetch({ probesUp, kuma, dns = false }: { probesUp: boolean; kuma: number | null; dns?: boolean }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === KUMA_METRICS) {
        if (kuma === null) throw new Error('ECONNREFUSED');
        const urls = [FUNNEL_URL, 'https://netbird-vpn-api.example.com/api/networks', 'https://netbird-vpn-relay.example.com/'];
        const text = urls.map((u) => kumaLine(u, kuma)).join('\n');
        return { ok: true, status: 200, text: async () => text } as unknown as Response;
      }
      if (!probesUp) {
        const error = new TypeError('fetch failed') as TypeError & { cause?: { code: string } };
        if (dns) error.cause = { code: 'ENOTFOUND' };
        throw error;
      }
      return { ok: false, status: 405, body: null } as unknown as Response;
    })
  );
}

function restartedProjects() {
  return execFileMock.mock.calls.map((call) => (call[1] as string[])[2]);
}

async function passes(check: () => Promise<void>, n: number) {
  for (let i = 0; i < n; i += 1) await check();
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
  mockedKumaPort.mockReturnValue(10370);
  mockedPublishAlert.mockResolvedValue(true);
});

describe('parseKumaMonitorStatus', () => {
  const metrics = [
    '# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)',
    kumaLine('https://authelia.example.com/api/health', 1),
    kumaLine(FUNNEL_URL, 0),
  ].join('\n');

  it('reads the status of the monitor probing the given URL', () => {
    expect(parseKumaMonitorStatus(metrics, FUNNEL_URL)).toBe(0);
    expect(parseKumaMonitorStatus(metrics, 'https://authelia.example.com/api/health')).toBe(1);
  });

  it('is null when no monitor probes that URL', () => {
    expect(parseKumaMonitorStatus(metrics, 'https://nope.example.com/')).toBeNull();
    expect(parseKumaMonitorStatus('', FUNNEL_URL)).toBeNull();
  });
});

describe('isDnsFailure', () => {
  it('matches resolution failures only', () => {
    expect(isDnsFailure('TypeError: fetch failed (ENOTFOUND)')).toBe(true);
    expect(isDnsFailure('TypeError: fetch failed (EAI_AGAIN)')).toBe(true);
    expect(isDnsFailure('TypeError: fetch failed (ECONNREFUSED)')).toBe(false);
    expect(isDnsFailure('TimeoutError: The operation was aborted due to timeout')).toBe(false);
  });
});

describe('checkCriticalServices', () => {
  it('does nothing when every probe is reachable', async () => {
    stubFetch({ probesUp: true, kuma: 1 });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 5);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mockedPublishAlert).not.toHaveBeenCalled();
  });

  // §444: the probe failed from the backend for an hour while Uptime Kuma saw
  // a 405 every minute, and each restart dropped every real NetBird client.
  it('never restarts while Uptime Kuma sees the same URL up', async () => {
    stubFetch({ probesUp: false, kuma: 1 });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 20);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('does not treat Uptime Kuma "pending" as confirmation', async () => {
    stubFetch({ probesUp: false, kuma: 2 });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 5);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('restarts after 3 failures when Uptime Kuma confirms down — once per project, not once per probe', async () => {
    stubFetch({ probesUp: false, kuma: 0 });
    const { checkCriticalServices } = await import('./criticalServiceHealth');

    await passes(checkCriticalServices, 2);
    expect(execFileMock).not.toHaveBeenCalled();

    await checkCriticalServices();
    expect(restartedProjects().sort()).toEqual(['netbird-vpn', 'tailscale']);
    expect(mockedPublishAlert).toHaveBeenCalledTimes(2);
  });

  // §543: ts.net's 300 s negative cache made the Funnel name fail to resolve
  // for ~5 min a day, and each time this restarted Tailscale for nothing.
  it('rides out a DNS failure that lasts the negative-cache window, restarts if it persists', async () => {
    stubFetch({ probesUp: false, kuma: 0, dns: true });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 7);
    expect(execFileMock).not.toHaveBeenCalled();
    await checkCriticalServices();
    expect(restartedProjects().sort()).toEqual(['netbird-vpn', 'tailscale']);
  });

  // The recovery path must not go dark just because Uptime Kuma is down too.
  it('falls back to its own probe when Uptime Kuma is unreachable', async () => {
    stubFetch({ probesUp: false, kuma: null });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 3);
    expect(restartedProjects().sort()).toEqual(['netbird-vpn', 'tailscale']);
  });

  it('restarts at most once per outage, then alerts that it gave up', async () => {
    stubFetch({ probesUp: false, kuma: null });
    const { checkCriticalServices } = await import('./criticalServiceHealth');

    await passes(checkCriticalServices, 3); // first restart
    execFileMock.mockClear();
    mockedPublishAlert.mockClear();

    await passes(checkCriticalServices, 30);
    expect(execFileMock).not.toHaveBeenCalled();
    // One "didn't help" alert per project, not one per pass.
    expect(mockedPublishAlert).toHaveBeenCalledTimes(2);
    expect(mockedPublishAlert.mock.calls.every(([a]) => a.title.includes("didn't help"))).toBe(true);
  });

  it('re-arms once everything has recovered', async () => {
    stubFetch({ probesUp: false, kuma: null });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 6); // restart, then gave up

    stubFetch({ probesUp: true, kuma: 1 });
    await checkCriticalServices();

    execFileMock.mockClear();
    stubFetch({ probesUp: false, kuma: null });
    await passes(checkCriticalServices, 3);
    expect(restartedProjects().sort()).toEqual(['netbird-vpn', 'tailscale']);
  });

  it('resets the failure count once a probe recovers', async () => {
    stubFetch({ probesUp: false, kuma: null });
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 2);

    stubFetch({ probesUp: true, kuma: 1 });
    await checkCriticalServices();

    stubFetch({ probesUp: false, kuma: null });
    await passes(checkCriticalServices, 2);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('quietly skips the restart when the service has no compose file (not installed)', async () => {
    stubFetch({ probesUp: false, kuma: null });
    mockedResolveComposeFile.mockReturnValue(null);
    const { checkCriticalServices } = await import('./criticalServiceHealth');
    await passes(checkCriticalServices, 6);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(mockedPublishAlert).not.toHaveBeenCalled();
  });
});
