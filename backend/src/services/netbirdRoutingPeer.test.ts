import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getLanCidr } from './networkScan';
import { readAppEnvValue, saveServiceEnv } from './appEnv';
import { aliasCidrFor, ensureNetbirdRoutingPeer, normalizeCidr } from './netbirdRoutingPeer';

vi.mock('../config/services', () => ({ getPublishedUpstreamPort: vi.fn() }));
vi.mock('../utils/network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./networkScan', () => ({ getLanCidr: vi.fn() }));
vi.mock('./appEnv', () => ({ readAppEnvValue: vi.fn(), saveServiceEnv: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedPort = vi.mocked(getPublishedUpstreamPort);
const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedLanCidr = vi.mocked(getLanCidr);
const mockedReadEnv = vi.mocked(readAppEnvValue);
const mockedSave = vi.mocked(saveServiceEnv);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// Routes every GET to "nothing exists yet" and every POST to a freshly
// created object, so the whole ensure-chain takes its create branch.
function fetchEverythingMissing(url: string, init?: { method?: string; body?: string }) {
  const method = init?.method ?? 'GET';
  const path = new URL(url).pathname;
  if (method === 'GET') return Promise.resolve(jsonResponse([]));
  const body = init?.body ? JSON.parse(init.body) : {};
  if (path === '/api/setup-keys') {
    return Promise.resolve(jsonResponse({ id: 'key-id', name: body.name, valid: true, key: 'NEW-SETUP-KEY' }));
  }
  return Promise.resolve(jsonResponse({ id: `${path}-${body.name ?? 'created'}`, name: body.name }));
}

// Routes every GET to "already exists and is valid", so the whole
// ensure-chain is a no-op past the reads.
function fetchEverythingPresent(url: string, init?: { method?: string }) {
  const method = init?.method ?? 'GET';
  const path = new URL(url).pathname;
  if (method !== 'GET') {
    throw new Error(`unexpected write: ${method} ${path}`);
  }
  if (path === '/api/groups') {
    const name = new URL(url).searchParams.get('name');
    return Promise.resolve(jsonResponse([{ id: `${name}-id`, name }]));
  }
  if (path.endsWith('/routers')) {
    return Promise.resolve(jsonResponse([{ id: 'router-1', peer_groups: ['business-lab-netbird-router-id'] }]));
  }
  if (path === '/api/setup-keys') {
    return Promise.resolve(jsonResponse([{ id: 'key-1', name: 'Business Lab routing peer', valid: true, key: 'X****' }]));
  }
  if (path === '/api/networks') {
    return Promise.resolve(jsonResponse([{ id: 'net-1', name: 'Business Lab LAN' }]));
  }
  if (path === '/api/policies') {
    return Promise.resolve(jsonResponse([{ id: 'pol-1', name: 'Business Lab: LAN resource access' }]));
  }
  // resources
  return Promise.resolve(jsonResponse([{ id: 'res-1', name: 'LAN' }]));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPort.mockReturnValue(10250);
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedLanCidr.mockResolvedValue('192.168.1.236/24');
  // Default: a real API token, no secondary address configured. Individual
  // Tests override with mockImplementation when they need a specific .env
  // value (e.g. a hand-set NETBIRD_LAN_ALIAS_CIDR).
  mockedReadEnv.mockImplementation((_service, key) => (key === 'NETBIRD_API_TOKEN' ? 'a-real-token' : null));
  mockedSave.mockResolvedValue({} as Awaited<ReturnType<typeof saveServiceEnv>>);
  vi.stubGlobal('fetch', vi.fn());
});

describe('normalizeCidr', () => {
  it('masks a host address down to its network address', () => {
    expect(normalizeCidr('192.168.1.236/24')).toBe('192.168.1.0/24');
  });

  it('leaves an already-network address unchanged', () => {
    expect(normalizeCidr('10.0.0.0/8')).toBe('10.0.0.0/8');
  });

  it('handles /32 and /0', () => {
    expect(normalizeCidr('192.168.1.5/32')).toBe('192.168.1.5/32');
    expect(normalizeCidr('192.168.1.5/0')).toBe('0.0.0.0/0');
  });

  it('rejects malformed input', () => {
    expect(normalizeCidr('not-an-ip')).toBeNull();
    expect(normalizeCidr('192.168.1.5')).toBeNull();
    expect(normalizeCidr('192.168.1.5/33')).toBeNull();
  });
});

describe('aliasCidrFor', () => {
  it('takes the base address and the LAN\'s own prefix length', () => {
    expect(aliasCidrFor('192.168.1.0/24', '10.177.1.0')).toBe('10.177.1.0/24');
  });

  // NETMAP rewrites only the host part, so a /24 alias over a /23 LAN would
  // map half of it and quietly black-hole the rest.
  it('re-masks the base to the LAN prefix rather than trusting the base\'s own', () => {
    expect(aliasCidrFor('192.168.0.0/23', '10.177.1.0/24')).toBe('10.177.0.0/23');
    expect(aliasCidrFor('10.0.0.0/8', '10.177.1.0/24')).toBe('10.0.0.0/8');
  });

  it('returns null for input it cannot make sense of', () => {
    expect(aliasCidrFor('192.168.1.0', '10.177.1.0')).toBeNull();
    expect(aliasCidrFor('192.168.1.0/24', 'nonsense')).toBeNull();
  });
});

describe('ensureNetbirdRoutingPeer', () => {
  it('is a no-op for any service other than netbird-vpn', async () => {
    await ensureNetbirdRoutingPeer('immich');
    expect(mockedReadEnv).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when no Personal Access Token is set', async () => {
    mockedReadEnv.mockReturnValue(null);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is a no-op when the token is still the change-me placeholder', async () => {
    mockedReadEnv.mockReturnValue('change-me');
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips without throwing when the LAN subnet cannot be determined', async () => {
    mockedLanCidr.mockResolvedValue('not-a-cidr');
    await expect(ensureNetbirdRoutingPeer('netbird-vpn')).resolves.toBe(false);
    // The readiness probe is a GET; what matters is that nothing was created.
    const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => (init as { method?: string })?.method === 'POST');
    expect(posts).toEqual([]);
  });

  it('creates the network/resource/router/policy/setup-key from scratch and stores the new key', async () => {
    vi.mocked(fetch).mockImplementation(fetchEverythingMissing as typeof fetch);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(mockedSave).toHaveBeenCalledWith('netbird-vpn', { NETBIRD_ROUTING_PEER_SETUP_KEY: 'NEW-SETUP-KEY' });
  });

  it('is fully idempotent when everything already exists and the setup key is still valid', async () => {
    vi.mocked(fetch).mockImplementation(fetchEverythingPresent as typeof fetch);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('advertises the host LAN and a same-prefix alias range beside it', async () => {
    const resourcePosts: unknown[] = [];
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (method === 'POST' && new URL(url).pathname.endsWith('/resources')) {
        resourcePosts.push(JSON.parse(init!.body!));
      }
      return fetchEverythingMissing(url, init);
    }) as typeof fetch);

    await ensureNetbirdRoutingPeer('netbird-vpn');

    // Both, not one: NetBird derives its forward-accept and masquerade rules
    // from the advertised CIDR, and the sidecar has already rewritten an
    // aliased packet's destination back to the real LAN before it reaches the
    // forward hook — drop the real resource and every aliased packet is
    // dropped (plan.md §412).
    expect(resourcePosts).toEqual([
      expect.objectContaining({ name: 'LAN', address: '192.168.1.0/24' }),
      expect.objectContaining({ name: 'LAN alias', address: '10.177.1.0/24' }),
    ]);
  });

  it('hands the sidecar the same pair it advertised', async () => {
    vi.mocked(fetch).mockImplementation(fetchEverythingMissing as typeof fetch);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(mockedSave).toHaveBeenCalledWith('netbird-vpn', {
      NETBIRD_LAN_CIDR: '192.168.1.0/24',
      NETBIRD_LAN_ALIAS_CIDR: '10.177.1.0/24',
    });
  });

  it('honours a hand-set alias base but re-masks it to the LAN prefix', async () => {
    mockedReadEnv.mockImplementation((_service, key) => {
      if (key === 'NETBIRD_API_TOKEN') return 'a-real-token';
      if (key === 'NETBIRD_LAN_ALIAS_CIDR') return '10.50.7.0/16'; // deliberately the wrong prefix
      return null;
    });
    const resourcePosts: unknown[] = [];
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'POST' && new URL(url).pathname.endsWith('/resources')) {
        resourcePosts.push(JSON.parse(init!.body!));
      }
      return fetchEverythingMissing(url, init);
    }) as typeof fetch);

    await ensureNetbirdRoutingPeer('netbird-vpn');

    expect(resourcePosts[1]).toEqual(expect.objectContaining({ name: 'LAN alias', address: '10.50.7.0/24' }));
  });

  // Fake timers because the readiness probe now burns its whole 60s budget
  // (20 x 3s) before giving up, rather than failing on the first request.
  it('gives up quietly when management never becomes reachable', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
      const pending = ensureNetbirdRoutingPeer('netbird-vpn');
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe(false);
      expect(mockedSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // The executor recreates netbird-client and the alias sidecar on a true
  // return — their environment is baked in at create time, so without it
  // netbird-client keeps crash-looping on the `change-me` setup key it
  // started with (§414). False when there was nothing new to write, or the
  // recreate (and the peer drop it causes) would happen on every start.
  it('reports an .env change so the executor knows to recreate its consumers', async () => {
    vi.mocked(fetch).mockImplementation(fetchEverythingMissing as typeof fetch);
    await expect(ensureNetbirdRoutingPeer('netbird-vpn')).resolves.toBe(true);
  });

  it('reports no .env change when everything is already provisioned', async () => {
    vi.mocked(fetch).mockImplementation(fetchEverythingPresent as typeof fetch);
    await expect(ensureNetbirdRoutingPeer('netbird-vpn')).resolves.toBe(false);
  });

  // Found live (§405.2): NetBird's GET /api/groups?name=X answers 404, not
  // 200 [], when nothing matches — a real API response shape, not a timing
  // fluke, so it gets its own regression test rather than folding into the
  // "everything missing" fixture above (which never simulated a non-2xx).
  it('treats a 404 GET as "nothing here yet" rather than a hard failure', async () => {
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(jsonResponse({ message: 'not found', code: 404 }, 404));
      return fetchEverythingMissing(url, init);
    }) as typeof fetch);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(mockedSave).toHaveBeenCalledWith('netbird-vpn', { NETBIRD_ROUTING_PEER_SETUP_KEY: 'NEW-SETUP-KEY' });
  });

  // Found live (§405.3): a 200 with a JSON `null` body, not just a 404,
  // also shows up for an empty collection — crashed the first real .some()
  // downstream of it ("Cannot read properties of null").
  it('treats a 200 GET with a null body as "nothing here yet" rather than a hard failure', async () => {
    vi.mocked(fetch).mockImplementation(((url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(jsonResponse(null, 200));
      return fetchEverythingMissing(url, init);
    }) as typeof fetch);
    await ensureNetbirdRoutingPeer('netbird-vpn');
    expect(mockedSave).toHaveBeenCalledWith('netbird-vpn', { NETBIRD_ROUTING_PEER_SETUP_KEY: 'NEW-SETUP-KEY' });
  });
});
