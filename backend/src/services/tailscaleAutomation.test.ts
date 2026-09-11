import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppEnvValue, saveServiceEnv } from './appEnv';
import { ensureTailscaleAutomation } from './tailscaleAutomation';

vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn(), saveServiceEnv: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedSave = vi.mocked(saveServiceEnv);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const ENV = {
  TAILSCALE_OAUTH_CLIENT_ID: 'client-id',
  TAILSCALE_OAUTH_CLIENT_SECRET: 'client-secret',
  TAILSCALE_AUTH_KEY_ID: '',
} as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  ENV.TAILSCALE_OAUTH_CLIENT_ID = 'client-id';
  ENV.TAILSCALE_OAUTH_CLIENT_SECRET = 'client-secret';
  ENV.TAILSCALE_AUTH_KEY_ID = '';
  mockedReadEnv.mockImplementation((_service, key) => ENV[key] ?? null);
  mockedSave.mockResolvedValue({} as Awaited<ReturnType<typeof saveServiceEnv>>);
  vi.stubGlobal('fetch', vi.fn());
});

// Routes every call by URL suffix — token exchange, key GET/POST, ACL
// GET/POST — as a fresh setup: no existing key, ACL doesn't grant Funnel yet.
function freshSetupFetch(url: string, init?: { method?: string }) {
  const method = init?.method ?? 'GET';
  if (url.endsWith('/oauth/token')) return Promise.resolve(jsonResponse({ access_token: 'tok' }));
  if (url.endsWith('/tailnet/-/keys') && method === 'POST') {
    return Promise.resolve(jsonResponse({ id: 'k1', key: 'tskey-auth-new' }));
  }
  if (url.endsWith('/tailnet/-/acl') && method === 'GET') {
    return Promise.resolve(jsonResponse({ acls: [] }, 200, { etag: '"abc"' }));
  }
  if (url.endsWith('/tailnet/-/acl') && method === 'POST') {
    return Promise.resolve(jsonResponse({ acls: [] }));
  }
  throw new Error(`unexpected fetch: ${method} ${url}`);
}

describe('ensureTailscaleAutomation', () => {
  it('is a no-op for any service other than tailscale', async () => {
    await ensureTailscaleAutomation('immich');
    expect(mockedReadEnv).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when no OAuth client is set', async () => {
    ENV.TAILSCALE_OAUTH_CLIENT_ID = '';
    await ensureTailscaleAutomation('tailscale');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when the OAuth client is still change-me', async () => {
    ENV.TAILSCALE_OAUTH_CLIENT_ID = 'change-me';
    await ensureTailscaleAutomation('tailscale');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('mints a fresh key and enables Funnel from a clean setup', async () => {
    vi.mocked(fetch).mockImplementation(freshSetupFetch as typeof fetch);
    await ensureTailscaleAutomation('tailscale');
    expect(mockedSave).toHaveBeenCalledWith('tailscale', {
      TAILSCALE_AUTH_KEY: 'tskey-auth-new',
      TAILSCALE_AUTH_KEY_ID: 'k1',
    });
  });

  it('sends If-Match with the GET ACL response ETag when enabling Funnel', async () => {
    vi.mocked(fetch).mockImplementation(freshSetupFetch as typeof fetch);
    await ensureTailscaleAutomation('tailscale');
    const aclPost = vi
      .mocked(fetch)
      .mock.calls.find(([url, init]) => (url as string).endsWith('/tailnet/-/acl') && (init as { method?: string })?.method === 'POST');
    expect(aclPost?.[1]).toMatchObject({ headers: expect.objectContaining({ 'If-Match': '"abc"' }) });
  });

  it('is idempotent when the stored key is still valid and Funnel is already granted', async () => {
    ENV.TAILSCALE_AUTH_KEY_ID = 'existing-key';
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      if (url.endsWith('/oauth/token')) return Promise.resolve(jsonResponse({ access_token: 'tok' }));
      if (url.endsWith('/tailnet/-/keys/existing-key')) return Promise.resolve(jsonResponse({ id: 'existing-key' }));
      if (url.endsWith('/tailnet/-/acl') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({ nodeAttrs: [{ target: ['tag:businesslab'], attr: ['funnel'] }] }, 200, { etag: '"e"' })
        );
      }
      throw new Error(`unexpected write: ${method} ${url}`);
    }) as typeof fetch);
    await ensureTailscaleAutomation('tailscale');
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('re-mints when the stored key comes back invalid (expired or revoked)', async () => {
    ENV.TAILSCALE_AUTH_KEY_ID = 'dead-key';
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string }) => {
      if (url.endsWith('/oauth/token')) return Promise.resolve(jsonResponse({ access_token: 'tok' }));
      if (url.endsWith('/tailnet/-/keys/dead-key')) return Promise.resolve(jsonResponse({ id: 'dead-key', invalid: true }));
      return freshSetupFetch(url, init);
    }) as typeof fetch);
    await ensureTailscaleAutomation('tailscale');
    expect(mockedSave).toHaveBeenCalledWith('tailscale', {
      TAILSCALE_AUTH_KEY: 'tskey-auth-new',
      TAILSCALE_AUTH_KEY_ID: 'k1',
    });
  });

  it('never throws when the Tailscale API is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ENOTFOUND'));
    await expect(ensureTailscaleAutomation('tailscale')).resolves.toBeUndefined();
    expect(mockedSave).not.toHaveBeenCalled();
  });
});
