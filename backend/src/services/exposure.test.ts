import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { getExposureConfig } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { getPublishedUpstreamPort, getService } from '../config/services';
import { deleteProxyHost, ensureProxyHost } from './npmClient';
import { ensureIngressRoute, removeIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import { deprovisionServiceExposure, getNpmOriginUrl, provisionServiceIfEnabled, upsertServiceExposureConfig } from './exposure';
import { ServiceExposureRow, ExposureGlobalConfig } from '../types';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../config/services', () => ({
  getPublishedUpstreamPort: vi.fn(),
  getService: vi.fn(),
  // Faithful stand-in for the real default behaviour (no exposureSubdomain
  // override); the override itself is unit-tested in config/services.test.ts.
  buildExposureHostname: (name: string, domain: string, suffix?: string) =>
    `${suffix ? `${name}-${suffix}` : name}.${domain}`,
}));
vi.mock('./npmClient', () => ({ ensureProxyHost: vi.fn(), deleteProxyHost: vi.fn() }));
vi.mock('./cloudflareTunnelClient', () => ({ ensureIngressRoute: vi.fn(), removeIngressRoute: vi.fn() }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedQuery = vi.mocked(query);
const mockedGetExposureConfig = vi.mocked(getExposureConfig);
const mockedGetHostGatewayIp = vi.mocked(getHostGatewayIp);
const mockedGetPublishedUpstreamPort = vi.mocked(getPublishedUpstreamPort);
const mockedGetService = vi.mocked(getService);
const mockedEnsureProxyHost = vi.mocked(ensureProxyHost);
const mockedEnsureIngressRoute = vi.mocked(ensureIngressRoute);
const mockedRemoveIngressRoute = vi.mocked(removeIngressRoute);
const mockedDeleteProxyHost = vi.mocked(deleteProxyHost);
const mockedWriteAuditLog = vi.mocked(writeAuditLog);

const globalConfig: ExposureGlobalConfig = {
  baseDomain: 'example.com',
  npmApiUrl: 'http://npm:81',
  npmEmail: 'admin@example.com',
  npmPassword: 'secret',
  cloudflareAccountId: 'acct',
  cloudflareZoneId: 'zone',
  cloudflareTunnelId: 'tunnel',
  cloudflareApiToken: 'token',
};

function exposureRow(overrides: Partial<ServiceExposureRow> = {}): ServiceExposureRow {
  return {
    service_name: 'paperless',
    enabled: true,
    hostname: 'paperless.example.com',
    upstream_scheme: 'http',
    upstream_host: null,
    upstream_port: null,
    websocket: true,
    authelia_protected: false,
    npm_host_id: null,
    cf_hostname_id: null,
    status: 'not_provisioned',
    last_error: null,
    updated_at: new Date(),
    ...overrides,
  };
}

// getServiceExposureRow always runs a `SELECT * FROM service_exposure` first;
// every other `query()` call in this module (updates) is fire-and-forget for
// these tests, so a blanket resolved value covers them once the row lookup
// is queued up front with mockResolvedValueOnce.
beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [] } as never);
  mockedGetExposureConfig.mockReset();
  mockedGetHostGatewayIp.mockReset();
  mockedGetPublishedUpstreamPort.mockReset();
  mockedGetService.mockReset();
  mockedGetService.mockReturnValue(undefined);
  mockedEnsureProxyHost.mockReset();
  mockedEnsureIngressRoute.mockReset();
  mockedRemoveIngressRoute.mockReset();
  mockedDeleteProxyHost.mockReset();
  mockedWriteAuditLog.mockReset();
  mockedWriteAuditLog.mockResolvedValue(undefined);
});

describe('provisionServiceIfEnabled', () => {
  it('does nothing when the service has no exposure row', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result).toEqual({ attempted: false });
    expect(mockedGetExposureConfig).not.toHaveBeenCalled();
  });

  it('does nothing when exposure is disabled for the service', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ enabled: false })] } as never);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result).toEqual({ attempted: false });
    expect(mockedGetExposureConfig).not.toHaveBeenCalled();
  });

  it('fails without touching NPM/Cloudflare when global exposure settings are incomplete', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(null);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result).toEqual({
      attempted: true,
      success: false,
      warning: 'Exposure is enabled for this service, but global exposure settings are incomplete.',
    });
    expect(mockedEnsureProxyHost).not.toHaveBeenCalled();
  });

  it('fails when the published upstream port cannot be determined', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(null);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.warning).toMatch(/Unable to determine the published port/);
    expect(mockedEnsureProxyHost).not.toHaveBeenCalled();
  });

  it("uses the service's exposurePortEnvVar to pick the primary upstream port, not the first port in the file", async () => {
    // Regression: pihole publishes DNS (53/tcp, 53/udp) before its web
    // port — without exposurePortEnvVar, "first port in the file" picks
    // DNS and NPM ends up proxying HTTP at a DNS server (502s).
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ service_name: 'pihole', npm_host_id: 5 })] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetService.mockReturnValueOnce({
      name: 'pihole',
      label: 'Pi-hole',
      description: '',
      icon: '',
      category: 'Networking & Security',
      composePath: '',
      healthCheck: { enabled: false },
      exposurePortEnvVar: 'PIHOLE_WEB_PORT',
    });
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8080);
    mockedGetHostGatewayIp.mockResolvedValueOnce('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValueOnce({ id: 5, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValueOnce({ dnsRecordId: 'dns-1', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('pihole', 1);

    expect(result.success).toBe(true);
    expect(mockedGetPublishedUpstreamPort).toHaveBeenCalledWith('pihole', 'PIHOLE_WEB_PORT');
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(expect.objectContaining({ forwardPort: 8080 }));
  });

  it('provisions NPM and Cloudflare and audits success', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ npm_host_id: 5 })] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8000);
    mockedGetHostGatewayIp.mockResolvedValueOnce('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValueOnce({ id: 5, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValueOnce({ dnsRecordId: 'dns-1', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result).toEqual({ attempted: true, success: true, hostname: 'paperless.example.com' });
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'paperless.example.com',
        forwardHost: '172.17.0.1',
        forwardPort: 8000,
        expectedHostId: 5,
      })
    );
    expect(mockedEnsureIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'paperless.example.com', tunnelId: 'tunnel' })
    );
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exposure_provision', resource: 'paperless', result: 'success' })
    );
  });

  it('records failure and audits it when NPM provisioning throws', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8000);
    mockedGetHostGatewayIp.mockResolvedValueOnce('172.17.0.1');
    mockedEnsureProxyHost.mockRejectedValueOnce(new Error('login failed'));

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result.attempted).toBe(true);
    expect(result.success).toBe(false);
    expect(result.warning).toMatch(/Service started, but exposure provisioning failed: login failed/);
    expect(mockedEnsureIngressRoute).not.toHaveBeenCalled();
    expect(mockedWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exposure_provision', resource: 'paperless', result: 'failure' })
    );
  });

  it('records failure and skips Cloudflare-side audit fields when the tunnel call throws after NPM succeeds', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8000);
    mockedGetHostGatewayIp.mockResolvedValueOnce('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValueOnce({ id: 7, created: true, updated: false });
    mockedEnsureIngressRoute.mockRejectedValueOnce(new Error('tunnel config read failed'));

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result.success).toBe(false);
    expect(result.warning).toMatch(/tunnel config read failed/);
  });

  it('also provisions a service\'s additionalExposures, each with its own hostname and port', async () => {
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return { rows: [exposureRow({ service_name: 'netbird-vpn', hostname: 'netbird-vpn.example.com', npm_host_id: 5 })] } as never;
      }
      if (sql.includes('DO UPDATE SET hostname = EXCLUDED.hostname')) {
        // ensureSecondaryExposureRow upsert
        return {
          rows: [exposureRow({ service_name: 'netbird-vpn:api', hostname: 'netbird-vpn-api.example.com', npm_host_id: null })],
        } as never;
      }
      return { rows: [] } as never;
    });
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedGetService.mockReturnValue({
      name: 'netbird-vpn',
      label: 'NetBird VPN',
      description: '',
      icon: '',
      category: 'Networking & Security',
      composePath: '',
      healthCheck: { enabled: false },
      additionalExposures: [{ suffix: 'api', label: 'Management API', portEnvVar: 'NETBIRD_MGMT_PORT', grpc: true }],
    });
    mockedGetPublishedUpstreamPort.mockImplementation((_name, portEnvVar) => (portEnvVar ? 8080 : 8081));
    mockedGetHostGatewayIp.mockResolvedValue('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValue({ id: 5, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValue({ dnsRecordId: 'dns-1', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('netbird-vpn', 1);

    expect(result).toEqual({ attempted: true, success: true, hostname: 'netbird-vpn.example.com' });
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn.example.com', forwardPort: 8081, expectedHostId: 5, grpc: false })
    );
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn-api.example.com', forwardPort: 8080, expectedHostId: null, grpc: true })
    );
    expect(mockedGetPublishedUpstreamPort).toHaveBeenCalledWith('netbird-vpn', 'NETBIRD_MGMT_PORT');

    // The grpc secondary must get a real https origin (Cloudflare requires
    // TLS+HTTP2/ALPN to the origin for gRPC — see getNpmGrpcOriginUrl),
    // while the primary keeps its plain-http origin.
    expect(mockedEnsureIngressRoute).toHaveBeenCalledWith(
      // Default ports are dropped by URL serialization (http:80, https:443).
      expect.objectContaining({ hostname: 'netbird-vpn.example.com', originUrl: 'http://npm', http2Origin: false, noTLSVerify: false })
    );
    expect(mockedEnsureIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'netbird-vpn-api.example.com',
        originUrl: 'https://npm',
        http2Origin: true,
        noTLSVerify: true,
        originServerName: 'netbird-vpn-api.example.com',
      })
    );
  });

  it('does not let a secondary exposure failure affect the primary result', async () => {
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return { rows: [exposureRow({ service_name: 'netbird-vpn', hostname: 'netbird-vpn.example.com', npm_host_id: 5 })] } as never;
      }
      if (sql.includes('DO UPDATE SET hostname = EXCLUDED.hostname')) {
        return {
          rows: [exposureRow({ service_name: 'netbird-vpn:api', hostname: 'netbird-vpn-api.example.com', npm_host_id: null })],
        } as never;
      }
      return { rows: [] } as never;
    });
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedGetService.mockReturnValue({
      name: 'netbird-vpn',
      label: 'NetBird VPN',
      description: '',
      icon: '',
      category: 'Networking & Security',
      composePath: '',
      healthCheck: { enabled: false },
      additionalExposures: [{ suffix: 'api', label: 'Management API', portEnvVar: 'NETBIRD_MGMT_PORT' }],
    });
    // Primary resolves fine; the secondary's port can't be determined.
    mockedGetPublishedUpstreamPort.mockImplementation((_name, portEnvVar) => (portEnvVar ? null : 8081));
    mockedGetHostGatewayIp.mockResolvedValue('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValue({ id: 5, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValue({ dnsRecordId: 'dns-1', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('netbird-vpn', 1);

    expect(result).toEqual({ attempted: true, success: true, hostname: 'netbird-vpn.example.com' });
    expect(mockedEnsureProxyHost).toHaveBeenCalledTimes(1);
  });
});

describe('upsertServiceExposureConfig', () => {
  it('refuses to enable exposure for a service with no published port at all', async () => {
    // e.g. tailscale — a VPN client sidecar with no `ports:` in its
    // compose file, nothing a reverse proxy could ever forward to.
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(null);

    await expect(upsertServiceExposureConfig('tailscale', { enabled: true })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining("can't be publicly exposed"),
    });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('allows disabling exposure for a service with no published port (turning it back off)', async () => {
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ service_name: 'tailscale', enabled: false })] } as never);

    await expect(upsertServiceExposureConfig('tailscale', { enabled: false })).resolves.toMatchObject({ enabled: false });
    // The no-published-port check only blocks enabling, not disabling.
    expect(mockedGetPublishedUpstreamPort).not.toHaveBeenCalled();
  });

  it('allows enabling exposure for a service that does have a published port', async () => {
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8000);
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ enabled: true })] } as never);

    await expect(upsertServiceExposureConfig('paperless', { enabled: true })).resolves.toMatchObject({ enabled: true });
  });
});

describe('exposure teardown', () => {
  it('removes the old hostname when a service is renamed, instead of stranding it', async () => {
    // ensureProxyHost matches on hostname, so without this the rename leaves
    // the previous NPM host in place, still serving the old hostname.
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return {
          rows: [exposureRow({ service_name: 'paperless', hostname: 'old-name.example.com', npm_host_id: 7 })],
        } as never;
      }
      return { rows: [] } as never;
    });
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedGetService.mockReturnValue(undefined as never);
    mockedGetPublishedUpstreamPort.mockReturnValue(8000);
    mockedGetHostGatewayIp.mockResolvedValue('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValue({ id: 9, created: true, updated: false });
    mockedEnsureIngressRoute.mockResolvedValue({ updated: true, dnsRecordId: 'dns-9' });

    await provisionServiceIfEnabled('paperless', 1);

    expect(mockedRemoveIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'old-name.example.com' })
    );
    expect(mockedDeleteProxyHost).toHaveBeenCalledWith(
      globalConfig.npmApiUrl,
      globalConfig.npmEmail,
      globalConfig.npmPassword,
      7
    );
    // ...and the new hostname is still provisioned afterwards.
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'paperless.example.com' })
    );
  });

  it('deprovisionServiceExposure tears down the primary and every secondary', async () => {
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return {
          rows: [
            exposureRow({ service_name: 'netbird-vpn', hostname: 'netbird-vpn.example.com', npm_host_id: 1 }),
            exposureRow({ service_name: 'netbird-vpn:api', hostname: 'netbird-vpn-api.example.com', npm_host_id: 2 }),
          ],
        } as never;
      }
      return { rows: [] } as never;
    });
    mockedGetExposureConfig.mockResolvedValue(globalConfig);

    await deprovisionServiceExposure('netbird-vpn', 1);

    expect(mockedRemoveIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn.example.com' })
    );
    expect(mockedRemoveIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn-api.example.com' })
    );
    expect(mockedDeleteProxyHost).toHaveBeenCalledTimes(2);
  });

  it('does nothing when exposure settings are incomplete', async () => {
    mockedGetExposureConfig.mockResolvedValue(null);
    await deprovisionServiceExposure('paperless', 1);
    expect(mockedRemoveIngressRoute).not.toHaveBeenCalled();
  });
});

describe('getNpmOriginUrl', () => {
  // Regression: this used to special-case only port 81 and pass any other
  // port straight through. When NPM's admin port was reallocated to 10270,
  // every tunnel ingress route was repointed at the ADMIN port — so all 33
  // public hostnames served the NPM admin UI instead of their app. An
  // estate-wide outage plus an unintended exposure of the admin panel, from
  // one port that "looked custom".
  it('always targets the proxy listener, never the admin port it is given', () => {
    // ':80' is absent from the expectations because it is http's default port
    // and URL.toString() omits it — this is the exact string shape the tunnel
    // ingress has always carried for non-gRPC hosts (http://<ip>).
    expect(getNpmOriginUrl('http://10.201.0.1:81')).toBe('http://10.201.0.1');
    expect(getNpmOriginUrl('http://10.201.0.1:10270')).toBe('http://10.201.0.1');
    expect(getNpmOriginUrl('http://10.201.0.1:65000')).toBe('http://10.201.0.1');
  });

  it('strips any path, query or fragment', () => {
    expect(getNpmOriginUrl('http://10.201.0.1:10270/api?x=1#y')).toBe('http://10.201.0.1');
  });
});
