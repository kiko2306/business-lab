import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { getExposureConfig, getNpmApiUrl } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { getPublishedUpstreamPort, getService } from '../config/services';
import { bootstrapNpmAdminIfDefault, deleteProxyHost, ensureProxyHost, NpmProxyHostPartialCreateError } from './npmClient';
import { ensureIngressRoute, removeIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import { deprovisionServiceExposure, ensureAutoExposure, getExposability, getNpmOriginUrl, provisionServiceIfEnabled } from './exposure';
import { ServiceExposureRow, ExposureGlobalConfig } from '../types';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/exposureSettings', async (importOriginal) => ({
  // EXPOSURE_SETTINGS_KEYS is a plain const object — keep the real one so
  // the query-shape assertions below match production key names.
  ...(await importOriginal<typeof import('../utils/exposureSettings')>()),
  getExposureConfig: vi.fn(),
  getNpmApiUrl: vi.fn(),
}));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../config/services', () => ({
  getPublishedUpstreamPort: vi.fn(),
  getService: vi.fn(),
  isAutheliaProtectionRequired: vi.fn().mockReturnValue(true),
  // Faithful stand-in for the real default behaviour (no exposureSubdomain
  // override); the override itself is unit-tested in config/services.test.ts.
  buildExposureHostname: (name: string, domain: string, suffix?: string, opts?: { apex?: boolean }) =>
    opts?.apex ? domain : `${suffix ? `${name}-${suffix}` : name}.${domain}`,
}));
// Keep the real NpmProxyHostPartialCreateError — exposure.ts does an
// `instanceof` check against it, which breaks if the class is mocked away.
vi.mock('./npmClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./npmClient')>()),
  ensureProxyHost: vi.fn(),
  deleteProxyHost: vi.fn(),
  bootstrapNpmAdminIfDefault: vi.fn(),
}));
vi.mock('./cloudflareTunnelClient', () => ({ ensureIngressRoute: vi.fn(), removeIngressRoute: vi.fn() }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedQuery = vi.mocked(query);
const mockedGetExposureConfig = vi.mocked(getExposureConfig);
const mockedGetNpmApiUrl = vi.mocked(getNpmApiUrl);
const mockedGetHostGatewayIp = vi.mocked(getHostGatewayIp);
const mockedGetPublishedUpstreamPort = vi.mocked(getPublishedUpstreamPort);
const mockedGetService = vi.mocked(getService);
const mockedEnsureProxyHost = vi.mocked(ensureProxyHost);
const mockedEnsureIngressRoute = vi.mocked(ensureIngressRoute);
const mockedRemoveIngressRoute = vi.mocked(removeIngressRoute);
const mockedDeleteProxyHost = vi.mocked(deleteProxyHost);
const mockedBootstrapNpmAdminIfDefault = vi.mocked(bootstrapNpmAdminIfDefault);
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
  mockedGetNpmApiUrl.mockReset();
  mockedGetNpmApiUrl.mockResolvedValue('http://npm:81');
  mockedBootstrapNpmAdminIfDefault.mockReset();
  mockedBootstrapNpmAdminIfDefault.mockResolvedValue(null);
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

  it('fails without touching NPM/Cloudflare when global exposure settings are incomplete and NPM is not on default credentials', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValue(null);
    mockedBootstrapNpmAdminIfDefault.mockResolvedValueOnce(null);

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result).toEqual({
      attempted: true,
      success: false,
      warning: 'Exposure is enabled for this service, but global exposure settings are incomplete.',
    });
    expect(mockedBootstrapNpmAdminIfDefault).toHaveBeenCalledWith('http://npm:81');
    expect(mockedEnsureProxyHost).not.toHaveBeenCalled();
  });

  it('self-heals by rotating NPM off its default admin credentials, then proceeds to provision', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow()] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(null).mockResolvedValueOnce(globalConfig);
    mockedBootstrapNpmAdminIfDefault.mockResolvedValueOnce({ email: 'admin@example.com', password: 'rotated-secret' });
    mockedGetPublishedUpstreamPort.mockReturnValue(8080);
    mockedEnsureProxyHost.mockResolvedValue({ id: 1, created: true, updated: false });

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings'),
      ['exposure_npm_email', 'admin@example.com', 'exposure_npm_password', 'rotated-secret']
    );
    expect(result.attempted).toBe(true);
    expect(mockedEnsureProxyHost).toHaveBeenCalled();
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

  it('records the recovered NPM host id on a partial-create failure, so it is not orphaned (§99.1)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ npm_host_id: null })] } as never);
    mockedGetExposureConfig.mockResolvedValueOnce(globalConfig);
    mockedGetPublishedUpstreamPort.mockReturnValueOnce(8000);
    mockedGetHostGatewayIp.mockResolvedValueOnce('172.17.0.1');
    mockedEnsureProxyHost.mockRejectedValueOnce(
      new NpmProxyHostPartialCreateError('Internal Error — NPM host 11 was created but not confirmed', 11)
    );

    const result = await provisionServiceIfEnabled('paperless', 1);

    expect(result.success).toBe(false);
    // The failed row carries id 11 now, so a later disable/retry can delete or
    // reconcile it instead of ensureProxyHost refusing an untracked host.
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('npm_host_id = COALESCE($3, npm_host_id)'),
      ['paperless', 'failed', 11, null, expect.stringContaining('Internal Error')]
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
      expect.objectContaining({ hostname: 'netbird-vpn.example.com', originUrl: 'http://127.0.0.1', http2Origin: false, noTLSVerify: false })
    );
    expect(mockedEnsureIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'netbird-vpn-api.example.com',
        originUrl: 'https://127.0.0.1',
        http2Origin: true,
        noTLSVerify: true,
        originServerName: 'netbird-vpn-api.example.com',
      })
    );
  });

  it('provisions an apex additionalExposures entry at the bare base domain (§111)', async () => {
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return { rows: [exposureRow({ service_name: 'homepage', hostname: 'homepage.example.com', npm_host_id: 7 })] } as never;
      }
      if (sql.includes('DO UPDATE SET hostname = EXCLUDED.hostname')) {
        return {
          rows: [exposureRow({ service_name: 'homepage:apex', hostname: 'example.com', npm_host_id: null })],
        } as never;
      }
      return { rows: [] } as never;
    });
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedGetService.mockReturnValue({
      name: 'homepage',
      label: 'Home Page',
      description: '',
      icon: '',
      category: 'Productivity',
      composePath: '',
      healthCheck: { enabled: false },
      additionalExposures: [{ apex: true, label: 'Bare domain', portEnvVar: 'HOMEPAGE_PORT' }],
    });
    mockedGetPublishedUpstreamPort.mockImplementation((_name, portEnvVar) => (portEnvVar ? 10190 : 10190));
    mockedGetHostGatewayIp.mockResolvedValue('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValue({ id: 7, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValue({ dnsRecordId: 'dns-apex', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('homepage', 1);

    expect(result).toEqual({ attempted: true, success: true, hostname: 'homepage.example.com' });
    // The apex hostname is the bare domain — no subdomain, no suffix.
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'example.com', forwardPort: 10190, expectedHostId: null, grpc: false })
    );
    expect(mockedEnsureIngressRoute).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'example.com', originUrl: 'http://127.0.0.1' })
    );
    expect(mockedGetPublishedUpstreamPort).toHaveBeenCalledWith('homepage', 'HOMEPAGE_PORT');
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

describe('ensureAutoExposure (§331)', () => {
  it('creates an enabled row for an exposable app that has none', async () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(8000);
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never); // getServiceExposureRow → no row

    await ensureAutoExposure('paperless', 0);

    const upsert = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO service_exposure'));
    expect(upsert).toBeDefined();
    expect(upsert![1]).toEqual(['paperless', 'paperless.example.com', 'http', true]);
  });

  it('is a no-op when an exposable app already has an enabled row with the right hostname', async () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(8000);
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    mockedQuery.mockResolvedValueOnce({
      rows: [exposureRow({ enabled: true, hostname: 'paperless.example.com' })],
    } as never);

    await ensureAutoExposure('paperless', 0);

    expect(mockedQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO service_exposure'))).toBe(false);
  });

  it('tears down and disables an app that stopped being exposable', async () => {
    mockedGetService.mockReturnValue({ overlayOnly: true } as never);
    mockedGetExposureConfig.mockResolvedValue(globalConfig);
    // getServiceExposureRow (enabled), then deprovisionServiceExposure's own SELECT.
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ service_name: 'nginx-proxy-manager', enabled: true })] } as never);
    mockedQuery.mockResolvedValueOnce({ rows: [exposureRow({ service_name: 'nginx-proxy-manager', enabled: true })] } as never);

    await ensureAutoExposure('nginx-proxy-manager', 0);

    const disable = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('SET enabled = false'));
    expect(disable).toBeDefined();
    expect(disable![1]).toEqual(['nginx-proxy-manager']);
  });

  it('ignores secondary exposure keys', async () => {
    await ensureAutoExposure('netbird-vpn:api', 0);
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('getExposability', () => {
  it('no published port → not exposable', () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(null);
    mockedGetService.mockReturnValue(undefined as never);

    expect(getExposability('tailscale')).toMatchObject({ exposable: false, reason: expect.stringContaining('no published port') });
  });

  it('lanOnly → not exposable, "cannot" wording', () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(445);
    mockedGetService.mockReturnValue({ lanOnly: true } as never);

    expect(getExposability('samba')).toMatchObject({ exposable: false, reason: expect.stringContaining('LAN-only') });
  });

  it('overlayOnly → not exposable, "sensitive gateway" wording', () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(8080);
    mockedGetService.mockReturnValue({ overlayOnly: true } as never);

    expect(getExposability('pihole')).toMatchObject({ exposable: false, reason: expect.stringContaining('sensitive gateway') });
  });

  it('ordinary HTTP app with a port → exposable, no reason', () => {
    mockedGetPublishedUpstreamPort.mockReturnValue(8000);
    mockedGetService.mockReturnValue({} as never);

    expect(getExposability('paperless')).toEqual({ exposable: true, reason: null });
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
  it('always targets the proxy listener on loopback, never the admin host/port it is given', () => {
    // ':80' is absent from the expectations because it is http's default port
    // and URL.toString() omits it. The host is forced to 127.0.0.1: NPM's
    // proxy listener is bound to loopback (§180, §279), so the admin URL's
    // host (the bridge gateway) is discarded.
    expect(getNpmOriginUrl('http://10.201.0.1:81')).toBe('http://127.0.0.1');
    expect(getNpmOriginUrl('http://10.201.0.1:10270')).toBe('http://127.0.0.1');
    expect(getNpmOriginUrl('http://10.201.0.1:65000')).toBe('http://127.0.0.1');
  });

  it('strips any path, query or fragment', () => {
    expect(getNpmOriginUrl('http://10.201.0.1:10270/api?x=1#y')).toBe('http://127.0.0.1');
  });
});
