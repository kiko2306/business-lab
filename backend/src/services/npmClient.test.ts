import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestJson } from '../utils/httpJson';
import { buildProxyHostPayload, ensureProxyHost, testNpmConnection } from './npmClient';

vi.mock('../utils/httpJson', () => ({
  requestJson: vi.fn(),
}));

const mockedRequestJson = vi.mocked(requestJson);

const baseOptions = {
  npmApiUrl: 'http://npm:81',
  npmEmail: 'admin@example.com',
  npmPassword: 'secret',
  hostname: 'paperless.example.com',
  forwardScheme: 'http',
  forwardHost: '172.17.0.1',
  forwardPort: 8000,
  websocket: true,
  autheliaProtected: false,
  grpc: false,
};

function mockLogin() {
  mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { token: 'jwt' }, raw: '' });
}

beforeEach(() => {
  mockedRequestJson.mockReset();
});

describe('buildProxyHostPayload', () => {
  it('maps options onto the NPM proxy-host shape, with SSL/caching disabled', () => {
    const payload = buildProxyHostPayload({
      hostname: 'paperless.example.com',
      forwardScheme: 'http',
      forwardHost: '172.17.0.1',
      forwardPort: 8000,
      websocket: true,
      autheliaProtected: false,
      grpc: false,
      certificateId: 0,
    });

    expect(payload).toMatchObject({
      domain_names: ['paperless.example.com'],
      forward_scheme: 'http',
      forward_host: '172.17.0.1',
      forward_port: 8000,
      allow_websocket_upgrade: true,
      block_exploits: true,
      caching_enabled: false,
      ssl_forced: false,
      http2_support: false,
      advanced_config: '',
    });
  });

  it('coerces a falsy websocket value to false', () => {
    const payload = buildProxyHostPayload({
      hostname: 'x.example.com',
      forwardScheme: 'http',
      forwardHost: 'h',
      forwardPort: 80,
      websocket: undefined as unknown as boolean,
      autheliaProtected: false,
      grpc: false,
      certificateId: 0,
    });
    expect(payload.allow_websocket_upgrade).toBe(false);
  });

  it('includes the Authelia forward-auth snippet includes when protected', () => {
    const payload = buildProxyHostPayload({
      hostname: 'paperless.example.com',
      forwardScheme: 'http',
      forwardHost: '172.17.0.1',
      forwardPort: 8000,
      websocket: true,
      autheliaProtected: true,
      grpc: false,
      certificateId: 0,
    });

    expect(payload.advanced_config).toContain('include /snippets/authelia-location.conf;');
    expect(payload.advanced_config).toContain('include /snippets/authelia-authrequest.conf;');
  });

  it('forces allow_websocket_upgrade off when protected, even if requested on', () => {
    // The Authelia block sets Upgrade/Connection itself — NPM's own
    // auto-injection for the same headers would otherwise duplicate them
    // and fail nginx's config reload entirely.
    const payload = buildProxyHostPayload({
      hostname: 'paperless.example.com',
      forwardScheme: 'http',
      forwardHost: '172.17.0.1',
      forwardPort: 8000,
      websocket: true,
      autheliaProtected: true,
      grpc: false,
      certificateId: 0,
    });

    expect(payload.allow_websocket_upgrade).toBe(false);
  });

  it('uses grpc_pass with http2_support and a real cert/SSL on for a grpc upstream', () => {
    const payload = buildProxyHostPayload({
      hostname: 'netbird-vpn-api.example.com',
      forwardScheme: 'http',
      forwardHost: '172.17.0.1',
      forwardPort: 8080,
      websocket: true,
      autheliaProtected: false,
      grpc: true,
      certificateId: 42,
    });

    expect(payload.http2_support).toBe(true);
    expect(payload.allow_websocket_upgrade).toBe(false);
    expect(payload.advanced_config).toContain('grpc_pass grpc://172.17.0.1:8080;');
    // Long-lived NetBird streams (signal ConnectStream) must survive past the
    // default 60s grpc_read_timeout or peer setup never completes.
    expect(payload.advanced_config).toContain('grpc_read_timeout 3600s;');
    // Cloudflare requires a real TLS+HTTP2/ALPN hop to the origin for gRPC
    // to negotiate at all — see exposure.ts getNpmGrpcOriginUrl.
    expect(payload.certificate_id).toBe(42);
    expect(payload.ssl_forced).toBe(true);
  });

  it('never attaches a certificate for a non-grpc upstream, even if one is passed', () => {
    const payload = buildProxyHostPayload({
      hostname: 'paperless.example.com',
      forwardScheme: 'http',
      forwardHost: '172.17.0.1',
      forwardPort: 8000,
      websocket: true,
      autheliaProtected: false,
      grpc: false,
      certificateId: 42,
    });

    expect(payload.certificate_id).toBe(0);
    expect(payload.ssl_forced).toBe(false);
  });
});

describe('ensureProxyHost', () => {
  it('creates a new host when none exists for the hostname', async () => {
    mockLogin();
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: [], raw: '' }); // list
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 201, body: { id: 5 }, raw: '' }); // create

    const result = await ensureProxyHost(baseOptions);

    expect(result).toEqual({ id: 5, created: true, updated: false });
    expect(mockedRequestJson).toHaveBeenCalledTimes(3);
  });

  it('refuses to touch a host with the same domain it does not already own', async () => {
    mockLogin();
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [{ id: 9, domain_names: ['paperless.example.com'], forward_scheme: 'http', forward_host: 'x', forward_port: 1 }],
      raw: '',
    });

    await expect(ensureProxyHost({ ...baseOptions, expectedHostId: null })).rejects.toThrow(/already exists and is not managed/);
  });

  it('updates an owned host whose upstream has drifted', async () => {
    mockLogin();
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [
        {
          id: 9,
          domain_names: ['paperless.example.com'],
          forward_scheme: 'http',
          forward_host: 'old-host',
          forward_port: 9999,
          allow_websocket_upgrade: true,
        },
      ],
      raw: '',
    });
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { id: 9 }, raw: '' }); // update

    const result = await ensureProxyHost({ ...baseOptions, expectedHostId: 9 });

    expect(result).toEqual({ id: 9, created: false, updated: true });
  });

  it('updates an owned host when Authelia protection was turned on', async () => {
    mockLogin();
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [
        {
          id: 9,
          domain_names: ['paperless.example.com'],
          forward_scheme: 'http',
          forward_host: '172.17.0.1',
          forward_port: 8000,
          allow_websocket_upgrade: true,
          advanced_config: '',
        },
      ],
      raw: '',
    });
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { id: 9 }, raw: '' }); // update

    const result = await ensureProxyHost({ ...baseOptions, expectedHostId: 9, autheliaProtected: true });

    expect(result).toEqual({ id: 9, created: false, updated: true });
  });

  it('updates an owned host when grpc support was turned on, reusing an existing cert', async () => {
    mockLogin();
    // findCertificateByDomain — a cert for this hostname already exists,
    // so ensureGrpcCertificate skips generating/uploading a new one.
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [{ id: 42, provider: 'other', domain_names: ['paperless.example.com'] }],
      raw: '',
    });
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [
        {
          id: 9,
          domain_names: ['paperless.example.com'],
          forward_scheme: 'http',
          forward_host: '172.17.0.1',
          forward_port: 8000,
          allow_websocket_upgrade: true,
          http2_support: false,
          ssl_forced: false,
          certificate_id: 0,
          advanced_config: '',
        },
      ],
      raw: '',
    });
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { id: 9 }, raw: '' }); // update

    const result = await ensureProxyHost({ ...baseOptions, expectedHostId: 9, grpc: true });

    expect(result).toEqual({ id: 9, created: false, updated: true });
    expect(mockedRequestJson).toHaveBeenCalledTimes(4); // login + cert list + host list + update
  });

  it('leaves an owned host untouched when the upstream already matches', async () => {
    mockLogin();
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: [
        {
          id: 9,
          domain_names: ['paperless.example.com'],
          forward_scheme: 'http',
          forward_host: '172.17.0.1',
          forward_port: 8000,
          allow_websocket_upgrade: true,
        },
      ],
      raw: '',
    });

    const result = await ensureProxyHost({ ...baseOptions, expectedHostId: 9 });

    expect(result).toEqual({ id: 9, created: false, updated: false });
    expect(mockedRequestJson).toHaveBeenCalledTimes(2); // login + list only, no write
  });

  it('throws when login fails', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 401, body: { error: { message: 'bad creds' } }, raw: '' });

    await expect(ensureProxyHost(baseOptions)).rejects.toThrow(/login failed/);
  });
});

describe('testNpmConnection', () => {
  it('resolves when login succeeds, without listing or writing anything', async () => {
    mockLogin();

    await expect(testNpmConnection('http://npm:81', 'admin@example.com', 'secret')).resolves.toBeUndefined();
    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
  });

  it('throws when login fails', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 401, body: { error: { message: 'bad creds' } }, raw: '' });

    await expect(testNpmConnection('http://npm:81', 'admin@example.com', 'wrong')).rejects.toThrow(/login failed/);
  });
});
