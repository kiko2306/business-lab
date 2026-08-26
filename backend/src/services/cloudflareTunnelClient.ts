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

function dnsRecordsUrl(zoneId: string, hostname?: string): string {
  const url = new URL(`${API_BASE}/zones/${zoneId}/dns_records`);
  if (hostname) {
    url.searchParams.set('name', hostname);
  }
  return url.toString();
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
  zoneId: string;
  tunnelId: string;
  hostname: string;
  originUrl: string;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

async function ensureTunnelDnsRecord(
  apiToken: string,
  zoneId: string,
  tunnelId: string,
  hostname: string
): Promise<string> {
  const desiredContent = `${tunnelId}.cfargotunnel.com`;
  const response = await requestJson<CloudflareApiEnvelope<DnsRecord[]>>(dnsRecordsUrl(zoneId, hostname), {
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (response.statusCode !== 200 || !response.body?.success || !response.body.result) {
    throw new Error(`Unable to read Cloudflare DNS records: ${response.body?.errors?.[0]?.message || response.statusCode}`);
  }

  const existing = response.body.result.find((record) => record.name.toLowerCase() === hostname.toLowerCase());
  if (existing) {
    if (existing.type === 'CNAME' && existing.content.toLowerCase() === desiredContent) {
      return existing.id;
    }
    throw new Error(`Cloudflare DNS record for ${hostname} already exists and is not managed by this tunnel.`);
  }

  const createResponse = await requestJson<CloudflareApiEnvelope<DnsRecord>>(dnsRecordsUrl(zoneId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: {
      type: 'CNAME',
      name: hostname,
      content: desiredContent,
      proxied: true,
      ttl: 1,
    },
  });

  if (createResponse.statusCode !== 200 || !createResponse.body?.success || !createResponse.body.result?.id) {
    throw new Error(
      `Unable to create Cloudflare DNS record: ${createResponse.body?.errors?.[0]?.message || createResponse.statusCode}`
    );
  }

  return createResponse.body.result.id;
}

/**
 * Idempotently ensure the tunnel's ingress rules route `hostname` to
 * `originUrl`. The catch-all rule (a rule with no hostname) is always kept
 * last, as Cloudflare requires.
 */
export async function ensureIngressRoute({
  apiToken,
  accountId,
  zoneId,
  tunnelId,
  hostname,
  originUrl,
}: EnsureIngressRouteOptions): Promise<{ updated: boolean; dnsRecordId: string }> {
  const config = await getTunnelConfiguration(apiToken, accountId, tunnelId);
  const ingress = Array.isArray(config.ingress) ? [...config.ingress] : [];

  const existingIndex = ingress.findIndex((rule) => rule.hostname === hostname);
  const desiredRule: IngressRule = { hostname, service: originUrl };

  let updated = false;
  if (existingIndex >= 0) {
    if (ingress[existingIndex].service === originUrl) {
      // The ingress route is already correct; still verify the DNS record.
    } else {
      ingress[existingIndex] = { ...ingress[existingIndex], ...desiredRule };
      updated = true;
    }
  } else {
    const catchAllIndex = ingress.findIndex((rule) => !rule.hostname);
    if (catchAllIndex >= 0) {
      ingress.splice(catchAllIndex, 0, desiredRule);
    } else {
      ingress.push(desiredRule, { service: 'http_status:404' });
    }
    updated = true;
  }

  if (updated) {
    await putTunnelConfiguration(apiToken, accountId, tunnelId, { ...config, ingress });
  }

  const dnsRecordId = await ensureTunnelDnsRecord(apiToken, zoneId, tunnelId, hostname);
  return { updated, dnsRecordId };
}
