/**
 * Auto-provisions the NetBird routing peer (§404): the `netbird-client`
 * container in apps/netbird-vpn/docker-compose.yml advertises this host's
 * LAN as a NetBird "Remote Network Access" resource, so a peer enrolled
 * from anywhere reaches the whole LAN, not just this box. Doing that by
 * hand means clicking through NetBird's own dashboard wizard (create a
 * network, a resource, a router, a policy, a setup key) on every fresh
 * deployment — this runs the same steps against NetBird's own management
 * API instead, idempotently, before every start/restart of the app.
 *
 * The one thing that can't be derived is a NetBird Personal Access Token
 * (Settings → Personal Access Tokens in the NetBird dashboard) — minted by
 * NetBird's own UI, not this stack's to generate. Entered once via this
 * app's config in the Business Lab dashboard (NETBIRD_API_TOKEN); until
 * then this is a no-op and NETBIRD_ROUTING_PEER_SETUP_KEY stays whatever
 * was pasted in by hand (see apps/netbird-vpn/.env.example).
 *
 * Reached over the host's published management port (same
 * getHostGatewayIp() pattern docusealAdminBootstrap.ts/immichAdminBootstrap.ts
 * use), not the public https://netbird-vpn-api.<domain> hostname — no
 * dependency on Cloudflare/NPM being healthy, and it works before NetBird
 * is even exposed.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getLanCidr } from './networkScan';
import { readAppEnvValue, saveServiceEnv } from './appEnv';

const SERVICE = 'netbird-vpn';
const API_TOKEN_ENV = 'NETBIRD_API_TOKEN';
const SETUP_KEY_ENV = 'NETBIRD_ROUTING_PEER_SETUP_KEY';
const MGMT_PORT_ENV = 'NETBIRD_MGMT_PORT';
const DEFAULT_MGMT_PORT = 10250;

const ROUTER_GROUP_NAME = 'business-lab-netbird-router';
const RESOURCE_GROUP_NAME = 'business-lab-lan';
const ALL_PEERS_GROUP_NAME = 'All'; // NetBird's own built-in group
const NETWORK_NAME = 'Business Lab LAN';
const RESOURCE_NAME = 'LAN';
const POLICY_NAME = 'Business Lab: LAN resource access';
const SETUP_KEY_NAME = 'Business Lab routing peer';
const SETUP_KEY_EXPIRES_IN = 31536000; // 365 days — NetBird's own max

const REQUEST_TIMEOUT_MS = 10_000;

interface NbGroup {
  id: string;
  name: string;
}
interface NbNetwork {
  id: string;
  name: string;
}
interface NbResource {
  id: string;
  name: string;
}
interface NbRouter {
  id: string;
  peer_groups?: string[];
}
interface NbPolicy {
  id: string;
  name: string;
}
interface NbSetupKey {
  id: string;
  name: string;
  valid: boolean;
  key: string;
}

/**
 * "a.b.c.d/nn" as reported by `ip addr` (a host address, not a network
 * address) into the actual network CIDR NetBird's Resource `address`
 * expects. Pure function — the one part of this feature worth unit testing,
 * same reasoning as parseNmapOutput in networkScan.ts.
 */
export function normalizeCidr(hostCidr: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(hostCidr.trim());
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  const prefix = Number(match[5]);
  if (octets.some((o) => o > 255) || prefix > 32) return null;

  const ipInt = octets.reduce((acc, o) => (acc << 8) + o, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const netInt = (ipInt & mask) >>> 0;
  const netOctets = [24, 16, 8, 0].map((shift) => (netInt >>> shift) & 0xff);
  return `${netOctets.join('.')}/${prefix}`;
}

async function nbRequest<T>(baseUrl: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Found live (§405.2): GET /api/groups?name=X (and, going by that,
  // presumably any other filtered/scoped lookup here) answers 404 when
  // nothing matches rather than 200 with an empty list — despite every GET
  // in this file otherwise expecting an array. Every ensure* below only
  // ever reads the result to check "does X already exist", so treating a
  // 404 on a GET as "nothing here yet" is correct everywhere it's used and
  // avoids a second wrong guess about which specific endpoints do this.
  if (method === 'GET' && response.status === 404) {
    return [] as unknown as T;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`NetBird API ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  const parsed = await response.json();
  // Found live (§405.3): a 200 with a JSON `null` body shows up too (not
  // just the 404-for-empty case §405.2 already handles) — every GET here
  // expects an array, so normalize either empty shape the same way.
  return (method === 'GET' && parsed === null ? [] : parsed) as T;
}

async function ensureGroup(baseUrl: string, token: string, name: string): Promise<string> {
  const existing = await nbRequest<NbGroup[]>(baseUrl, token, 'GET', `/api/groups?name=${encodeURIComponent(name)}`);
  const match = existing.find((g) => g.name === name);
  if (match) return match.id;
  const created = await nbRequest<NbGroup>(baseUrl, token, 'POST', '/api/groups', { name });
  return created.id;
}

async function ensureNetwork(baseUrl: string, token: string, name: string): Promise<string> {
  const all = await nbRequest<NbNetwork[]>(baseUrl, token, 'GET', '/api/networks');
  const match = all.find((n) => n.name === name);
  if (match) return match.id;
  const created = await nbRequest<NbNetwork>(baseUrl, token, 'POST', '/api/networks', {
    name,
    description: 'Managed by the Business Lab dashboard — see plan.md §404/§405.',
  });
  return created.id;
}

// Only creates — deliberately does not update an existing resource's
// `address` if the host's LAN subnet later changes. That's a rare host
// reconfig; fixing it via NetBird's own UI is one click, and guessing at an
// untested PATCH payload here is not worth it for that edge.
async function ensureResource(
  baseUrl: string,
  token: string,
  networkId: string,
  name: string,
  address: string,
  groupIds: string[]
): Promise<void> {
  const all = await nbRequest<NbResource[]>(baseUrl, token, 'GET', `/api/networks/${networkId}/resources`);
  if (all.some((r) => r.name === name)) return;
  await nbRequest(baseUrl, token, 'POST', `/api/networks/${networkId}/resources`, {
    name,
    address,
    enabled: true,
    groups: groupIds,
  });
}

async function ensureRouter(baseUrl: string, token: string, networkId: string, peerGroupId: string): Promise<void> {
  const all = await nbRequest<NbRouter[]>(baseUrl, token, 'GET', `/api/networks/${networkId}/routers`);
  if (all.some((r) => (r.peer_groups ?? []).includes(peerGroupId))) return;
  await nbRequest(baseUrl, token, 'POST', `/api/networks/${networkId}/routers`, {
    peer_groups: [peerGroupId],
    metric: 9999,
    masquerade: true,
    enabled: true,
  });
}

async function ensurePolicy(baseUrl: string, token: string, sourceGroupId: string, destGroupId: string): Promise<void> {
  const all = await nbRequest<NbPolicy[]>(baseUrl, token, 'GET', '/api/policies');
  if (all.some((p) => p.name === POLICY_NAME)) return;
  await nbRequest(baseUrl, token, 'POST', '/api/policies', {
    name: POLICY_NAME,
    enabled: true,
    rules: [
      {
        name: POLICY_NAME,
        enabled: true,
        action: 'accept',
        bidirectional: true,
        protocol: 'all',
        sources: [sourceGroupId],
        destinations: [destGroupId],
      },
    ],
  });
}

// Setup keys are shown in plaintext only once (creation response) — a
// masked value comes back from every later GET, so this checks the key's
// live `valid` flag rather than anything stored locally. A missing or
// expired/revoked key is regenerated and overwrites whatever's in .env
// (including a key pasted in by hand before a PAT existed); a still-valid
// one is left alone, whatever .env currently holds for it.
async function ensureSetupKey(baseUrl: string, token: string, routerGroupId: string): Promise<void> {
  const keys = await nbRequest<NbSetupKey[]>(baseUrl, token, 'GET', '/api/setup-keys');
  const existing = keys.find((k) => k.name === SETUP_KEY_NAME);
  if (existing?.valid) return;

  const created = await nbRequest<NbSetupKey>(baseUrl, token, 'POST', '/api/setup-keys', {
    name: SETUP_KEY_NAME,
    type: 'reusable',
    expires_in: SETUP_KEY_EXPIRES_IN,
    auto_groups: [routerGroupId],
    usage_limit: 0,
  });
  await saveServiceEnv(SERVICE, { [SETUP_KEY_ENV]: created.key });
  logger.info(
    existing
      ? 'NetBird: routing-peer setup key had expired or was revoked — generated a fresh one'
      : 'NetBird: generated the routing-peer setup key'
  );
}

export async function ensureNetbirdRoutingPeer(serviceName: string): Promise<void> {
  if (serviceName !== SERVICE) return;

  const token = (readAppEnvValue(SERVICE, API_TOKEN_ENV) ?? '').trim();
  if (!token || token.toLowerCase() === 'change-me') {
    return; // nothing to automate until a Personal Access Token is entered
  }

  try {
    const port = getPublishedUpstreamPort(SERVICE, MGMT_PORT_ENV) ?? DEFAULT_MGMT_PORT;
    const baseUrl = `http://${await getHostGatewayIp()}:${port}`;

    const cidr = normalizeCidr(await getLanCidr());
    if (!cidr) {
      logger.warn('NetBird routing peer: could not determine the host LAN subnet — skipping');
      return;
    }

    const allGroupId = await ensureGroup(baseUrl, token, ALL_PEERS_GROUP_NAME);
    const routerGroupId = await ensureGroup(baseUrl, token, ROUTER_GROUP_NAME);
    const resourceGroupId = await ensureGroup(baseUrl, token, RESOURCE_GROUP_NAME);
    const networkId = await ensureNetwork(baseUrl, token, NETWORK_NAME);
    await ensureResource(baseUrl, token, networkId, RESOURCE_NAME, cidr, [resourceGroupId]);
    await ensureRouter(baseUrl, token, networkId, routerGroupId);
    await ensurePolicy(baseUrl, token, allGroupId, resourceGroupId);
    await ensureSetupKey(baseUrl, token, routerGroupId);
  } catch (error) {
    // Best-effort: the management API isn't reachable yet on a cold first
    // start (netbird-client itself is part of this same `docker compose up`
    // and hasn't run yet either), and NetBird's API can be flaky mid-restart.
    // Self-heals on the next start/restart — never blocks this one.
    logger.warn('NetBird routing peer: auto-provisioning failed, leaving existing config untouched', {
      error: (error as Error).message,
    });
  }
}
