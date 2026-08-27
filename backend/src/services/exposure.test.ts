import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { getExposureConfig } from '../utils/exposureSettings';
import { getHostGatewayIp } from '../utils/network';
import { getPublishedUpstreamPort, getService } from '../config/services';
import { ensureProxyHost } from './npmClient';
import { ensureIngressRoute } from './cloudflareTunnelClient';
import { writeAuditLog } from '../utils/audit';
import { provisionServiceIfEnabled } from './exposure';
import { ServiceExposureRow, ExposureGlobalConfig } from '../types';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('../config/services', () => ({ getPublishedUpstreamPort: vi.fn(), getService: vi.fn() }));
vi.mock('./npmClient', () => ({ ensureProxyHost: vi.fn() }));
vi.mock('./cloudflareTunnelClient', () => ({ ensureIngressRoute: vi.fn() }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedQuery = vi.mocked(query);
const mockedGetExposureConfig = vi.mocked(getExposureConfig);
const mockedGetHostGatewayIp = vi.mocked(getHostGatewayIp);
const mockedGetPublishedUpstreamPort = vi.mocked(getPublishedUpstreamPort);
const mockedGetService = vi.mocked(getService);
const mockedEnsureProxyHost = vi.mocked(ensureProxyHost);
const mockedEnsureIngressRoute = vi.mocked(ensureIngressRoute);
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
        return { rows: [exposureRow({ service_name: 'netbird-vpn', npm_host_id: 5 })] } as never;
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
      additionalExposures: [{ suffix: 'api', label: 'Management API', portEnvVar: 'NETBIRD_MGMT_PORT' }],
    });
    mockedGetPublishedUpstreamPort.mockImplementation((_name, portEnvVar) => (portEnvVar ? 8080 : 8081));
    mockedGetHostGatewayIp.mockResolvedValue('172.17.0.1');
    mockedEnsureProxyHost.mockResolvedValue({ id: 5, created: false, updated: true });
    mockedEnsureIngressRoute.mockResolvedValue({ dnsRecordId: 'dns-1', created: false, updated: true } as never);

    const result = await provisionServiceIfEnabled('netbird-vpn', 1);

    expect(result).toEqual({ attempted: true, success: true, hostname: 'netbird-vpn.example.com' });
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn.example.com', forwardPort: 8081, expectedHostId: 5 })
    );
    expect(mockedEnsureProxyHost).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'netbird-vpn-api.example.com', forwardPort: 8080, expectedHostId: null })
    );
    expect(mockedGetPublishedUpstreamPort).toHaveBeenCalledWith('netbird-vpn', 'NETBIRD_MGMT_PORT');
  });

  it('does not let a secondary exposure failure affect the primary result', async () => {
    mockedQuery.mockImplementation(async (text: unknown) => {
      const sql = String(text);
      if (sql.includes('SELECT * FROM service_exposure')) {
        return { rows: [exposureRow({ service_name: 'netbird-vpn', npm_host_id: 5 })] } as never;
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
