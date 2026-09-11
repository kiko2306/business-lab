/**
 * Auto-provisions Tailscale via its own API once an OAuth client is set
 * (plan.md §408): mints/refreshes TAILSCALE_AUTH_KEY itself instead of a
 * human generating one by hand, and enables Funnel on the tailnet's ACL
 * policy instead of the manual one-click step in first-run.md. Same
 * "no-op until a token is set, best-effort after that" shape as
 * netbirdRoutingPeer.ts (§405) — this file exists because that one proved
 * the pattern out first.
 *
 * Motivated directly by a real outage, not a hypothetical: plan.md §367 — a
 * reusable auth key expired (Tailscale's 90-day default), the node
 * deauthed, and NetBird's signal server (published through Tailscale
 * Funnel, since Cloudflare can't carry it — §52) went down with it, because
 * nothing was watching the key's expiry. This is that watch.
 *
 * Verified API shapes against Tailscale's own OpenAPI spec
 * (https://api.tailscale.com/api/v2?openapi=1) before writing this, not
 * guessed — §405.2/§405.3 already paid once for trusting NetBird's docs
 * over its actual responses.
 */

import logger from '../utils/logger';
import { readAppEnvValue, saveServiceEnv } from './appEnv';

const SERVICE = 'tailscale';
const CLIENT_ID_ENV = 'TAILSCALE_OAUTH_CLIENT_ID';
const CLIENT_SECRET_ENV = 'TAILSCALE_OAUTH_CLIENT_SECRET';
const AUTH_KEY_ENV = 'TAILSCALE_AUTH_KEY';
const AUTH_KEY_ID_ENV = 'TAILSCALE_AUTH_KEY_ID';
// Must match docker-compose.yml's TS_EXTRA_ARGS --advertise-tags — an
// OAuth-issued key is tag-bound at issuance, and containerboot's `tailscale
// up` refuses to authenticate with a tag the node doesn't also advertise
// (found live, plan.md §387).
const TAG = 'tag:businesslab';
const API_BASE = 'https://api.tailscale.com/api/v2';
const REQUEST_TIMEOUT_MS = 10_000;
// Tailscale's own max for auth keys (its API defaults to 90 days and the
// KB places the same cap on OAuth-issued ones) — there is no longer-lived
// or non-expiring option, unlike Cloudflare's token. Re-checked every
// tailscale start instead, same self-heal shape as NetBird's setup key.
const AUTH_KEY_EXPIRY_SECONDS = 90 * 24 * 60 * 60;

interface TsKey {
  id: string;
  key?: string;
  invalid?: boolean;
}

interface TsPolicy {
  nodeAttrs?: Array<{ target?: string[]; attr?: string[] }>;
  [key: string]: unknown;
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Tailscale OAuth token exchange -> ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

async function tsRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ data: T; etag: string | null }> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Tailscale API ${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  }
  const etag = response.headers.get('etag');
  if (response.status === 204) return { data: undefined as T, etag };
  return { data: (await response.json()) as T, etag };
}

/**
 * Only re-mints when the currently-stored key is missing or actually
 * invalid (Tailscale marks a revoked/expired key `invalid: true` on GET,
 * never removes it from the list) — never on a bare lookup failure, so a
 * transient network hiccup against Tailscale's API can't spuriously churn
 * out a fresh key on every start.
 */
async function ensureAuthKey(token: string): Promise<void> {
  const currentId = (readAppEnvValue(SERVICE, AUTH_KEY_ID_ENV) ?? '').trim();
  if (currentId) {
    try {
      const { data } = await tsRequest<TsKey>(token, 'GET', `/tailnet/-/keys/${encodeURIComponent(currentId)}`);
      if (!data.invalid) return;
    } catch {
      return; // ambiguous (network blip, 404, ...) — don't churn a key over it
    }
  }

  const { data: created } = await tsRequest<TsKey>(token, 'POST', '/tailnet/-/keys', {
    // Found live (§408.1): Tailscale's key description only allows
    // alphanumeric, spaces and hyphens — "Business Lab (auto)" 400'd on the
    // parentheses.
    description: 'Business Lab auto-mint',
    expirySeconds: AUTH_KEY_EXPIRY_SECONDS,
    capabilities: {
      devices: {
        create: {
          reusable: true,
          ephemeral: false,
          preauthorized: true,
          tags: [TAG],
        },
      },
    },
  });

  await saveServiceEnv(SERVICE, { [AUTH_KEY_ENV]: created.key ?? '', [AUTH_KEY_ID_ENV]: created.id });
  logger.info(currentId ? 'Tailscale: previous auth key expired or was revoked — minted a fresh one' : 'Tailscale: minted an auth key');
}

/**
 * Read-merge-write: fetches the tailnet's real ACL policy, adds exactly one
 * `nodeAttrs` entry if `tag:businesslab` doesn't already have Funnel
 * (plan.md §367/§387 already put one there for this deployment by hand —
 * this is meant to find that and no-op, not fight it), and writes the whole
 * policy back with `If-Match` so a concurrent edit in Tailscale's own admin
 * console is refused rather than silently clobbered.
 */
async function ensureFunnelEnabled(token: string): Promise<void> {
  const { data: policy, etag } = await tsRequest<TsPolicy>(token, 'GET', '/tailnet/-/acl');

  const nodeAttrs = policy.nodeAttrs ?? [];
  const alreadyGranted = nodeAttrs.some(
    (entry) => (entry.target ?? []).includes(TAG) && (entry.attr ?? []).includes('funnel')
  );
  if (alreadyGranted) return;

  const updated: TsPolicy = { ...policy, nodeAttrs: [...nodeAttrs, { target: [TAG], attr: ['funnel'] }] };
  await tsRequest(token, 'POST', '/tailnet/-/acl', updated, etag ? { 'If-Match': etag } : {});
  logger.info(`Tailscale: enabled Funnel for ${TAG} in the tailnet ACL policy`);
}

export async function ensureTailscaleAutomation(serviceName: string): Promise<void> {
  if (serviceName !== SERVICE) return;

  const clientId = (readAppEnvValue(SERVICE, CLIENT_ID_ENV) ?? '').trim();
  const clientSecret = (readAppEnvValue(SERVICE, CLIENT_SECRET_ENV) ?? '').trim();
  if (!clientId || clientId.toLowerCase() === 'change-me' || !clientSecret || clientSecret.toLowerCase() === 'change-me') {
    return; // nothing to automate until an OAuth client is entered
  }

  try {
    const token = await getAccessToken(clientId, clientSecret);
    await ensureAuthKey(token);
    await ensureFunnelEnabled(token);
  } catch (error) {
    // Best-effort, same reasoning as netbirdRoutingPeer.ts: Tailscale's API
    // being unreachable must never block this app's own start, and the
    // existing auth key (if any) keeps working until it actually expires.
    logger.warn('Tailscale automation: failed, leaving existing config untouched', {
      error: (error as Error).message,
    });
  }
}
