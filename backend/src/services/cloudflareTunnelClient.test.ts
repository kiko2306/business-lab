import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestJson } from '../utils/httpJson';
import { ensureIngressRoute } from './cloudflareTunnelClient';

vi.mock('../utils/httpJson', () => ({
  requestJson: vi.fn(),
}));

const mockedRequestJson = vi.mocked(requestJson);

const baseOptions = {
  apiToken: 'token',
  accountId: 'account',
  zoneId: 'zone',
  tunnelId: 'tunnel-1',
  hostname: 'paperless.example.com',
  originUrl: 'http://172.17.0.1:8000',
};

function mockConfig(ingress: Array<{ hostname?: string; service: string }>) {
  mockedRequestJson.mockResolvedValueOnce({
    statusCode: 200,
    body: { success: true, result: { config: { ingress } } },
    raw: '',
  });
}

function mockDnsRecords(records: Array<{ id: string; type: string; name: string; content: string }>) {
  mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { success: true, result: records }, raw: '' });
}

beforeEach(() => {
  mockedRequestJson.mockReset();
});

describe('ensureIngressRoute', () => {
  it('inserts a new hostname rule ahead of the catch-all and creates a DNS record', async () => {
    mockConfig([{ service: 'http_status:404' }]);
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { success: true, result: {} }, raw: '' }); // put config
    mockDnsRecords([]);
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: { success: true, result: { id: 'dns-1' } },
      raw: '',
    }); // create dns record

    const result = await ensureIngressRoute(baseOptions);

    expect(result).toEqual({ updated: true, dnsRecordId: 'dns-1' });

    const putCall = mockedRequestJson.mock.calls[1];
    const putBody = (putCall[1] as { body: { config: { ingress: Array<{ hostname?: string }> } } }).body;
    expect(putBody.config.ingress[0]).toEqual({ hostname: 'paperless.example.com', service: baseOptions.originUrl });
    expect(putBody.config.ingress[1]).toEqual({ service: 'http_status:404' });
  });

  it('is a no-op against Cloudflare when the rule and DNS record already match', async () => {
    mockConfig([
      { hostname: 'paperless.example.com', service: baseOptions.originUrl },
      { service: 'http_status:404' },
    ]);
    mockDnsRecords([
      { id: 'dns-1', type: 'CNAME', name: 'paperless.example.com', content: 'tunnel-1.cfargotunnel.com' },
    ]);

    const result = await ensureIngressRoute(baseOptions);

    expect(result).toEqual({ updated: false, dnsRecordId: 'dns-1' });
    expect(mockedRequestJson).toHaveBeenCalledTimes(2); // get config + get dns records, no writes
  });

  it('updates the ingress rule when the hostname exists but points elsewhere', async () => {
    mockConfig([
      { hostname: 'paperless.example.com', service: 'http://old-upstream:9999' },
      { service: 'http_status:404' },
    ]);
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { success: true, result: {} }, raw: '' }); // put config
    mockDnsRecords([
      { id: 'dns-1', type: 'CNAME', name: 'paperless.example.com', content: 'tunnel-1.cfargotunnel.com' },
    ]);

    const result = await ensureIngressRoute(baseOptions);

    expect(result).toEqual({ updated: true, dnsRecordId: 'dns-1' });
  });

  it('refuses to touch a DNS record it does not own', async () => {
    mockConfig([{ service: 'http_status:404' }]);
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { success: true, result: {} }, raw: '' }); // put config
    mockDnsRecords([
      { id: 'dns-1', type: 'A', name: 'paperless.example.com', content: '203.0.113.5' },
    ]);

    await expect(ensureIngressRoute(baseOptions)).rejects.toThrow(/already exists and is not managed/);
  });

  it('throws when reading the tunnel configuration fails', async () => {
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 403,
      body: { success: false, errors: [{ message: 'forbidden' }] },
      raw: '',
    });

    await expect(ensureIngressRoute(baseOptions)).rejects.toThrow(/Unable to read Cloudflare Tunnel configuration/);
  });
});
