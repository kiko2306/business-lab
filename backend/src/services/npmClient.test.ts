import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestJson } from '../utils/httpJson';
import { buildProxyHostPayload, ensureProxyHost } from './npmClient';

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
    });
  });

  it('coerces a falsy websocket value to false', () => {
    const payload = buildProxyHostPayload({
      hostname: 'x.example.com',
      forwardScheme: 'http',
      forwardHost: 'h',
      forwardPort: 80,
      websocket: undefined as unknown as boolean,
    });
    expect(payload.allow_websocket_upgrade).toBe(false);
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
