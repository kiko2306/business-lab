/**
 * Cloudflare Tunnel API client.
 * Idempotently ensures a public hostname route exists on the configured
 * tunnel, pointing at the Nginx Proxy Manager origin.
 * https://developers.cloudflare.com/api/operations/cloudflare-tunnel-configuration-properties
 */

import { requestJson } from '../utils/httpJson';

interface IngressRule {
  hostname?: string;
  service: string;
  [key: string]: unknown;
}

interface TunnelConfig {
  ingress: IngressRule[];
  [key: string]: unknown;
}

interface CloudflareApiEnvelope<T> {
  success: boolean;
  errors?: { message?: string }[];
  result?: T;
}

const API_BASE = 'https://api.cloudflare.com/client/v4';

function configUrl(accountId: string, tunnelId: string): string {
  return `${API_BASE}/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`;
}

async function getTunnelConfiguration(apiToken: string, accountId: string, tunnelId: string): Promise<TunnelConfig> {
  const response = await requestJson<CloudflareApiEnvelope<{ config?: TunnelConfig }>>(configUrl(accountId, tunnelId), {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (response.statusCode !== 200 || !response.body?.success) {
    throw new Error(
      `Unable to read Cloudflare Tunnel configuration: ${response.body?.errors?.[0]?.message || response.statusCode}`
    );
  }

  return response.body.result?.config ?? { ingress: [] };
}

async function putTunnelConfiguration(
  apiToken: string,
  accountId: string,
  tunnelId: string,
  config: TunnelConfig
): Promise<unknown> {
  const response = await requestJson<CloudflareApiEnvelope<unknown>>(configUrl(accountId, tunnelId), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: { config },
  });

  if (response.statusCode !== 200 || !response.body?.success) {
    throw new Error(
      `Unable to update Cloudflare Tunnel configuration: ${response.body?.errors?.[0]?.message || response.statusCode}`
    );
  }

  return response.body.result;
}

interface EnsureIngressRouteOptions {
  apiToken: string;
  accountId: string;
  tunnelId: string;
  hostname: string;
  originUrl: string;
}

/**
 * Idempotently ensure the tunnel's ingress rules route `hostname` to
 * `originUrl`. The catch-all rule (a rule with no hostname) is always kept
 * last, as Cloudflare requires.
 */
export async function ensureIngressRoute({
  apiToken,
  accountId,
  tunnelId,
  hostname,
  originUrl,
}: EnsureIngressRouteOptions): Promise<{ updated: boolean }> {
  const config = await getTunnelConfiguration(apiToken, accountId, tunnelId);
  const ingress = Array.isArray(config.ingress) ? [...config.ingress] : [];

  const existingIndex = ingress.findIndex((rule) => rule.hostname === hostname);
  const desiredRule: IngressRule = { hostname, service: originUrl };

  if (existingIndex >= 0) {
    if (ingress[existingIndex].service === originUrl) {
      return { updated: false };
    }
    ingress[existingIndex] = { ...ingress[existingIndex], ...desiredRule };
  } else {
    const catchAllIndex = ingress.findIndex((rule) => !rule.hostname);
    if (catchAllIndex >= 0) {
      ingress.splice(catchAllIndex, 0, desiredRule);
    } else {
      ingress.push(desiredRule, { service: 'http_status:404' });
    }
  }

  await putTunnelConfiguration(apiToken, accountId, tunnelId, { ...config, ingress });
  return { updated: true };
}
