/**
 * Nginx Proxy Manager API client.
 * Idempotently finds, creates, or updates proxy hosts for exposed services.
 * https://nginxproxymanager.com/api/
 */

import { requestJson } from '../utils/httpJson';

interface NpmProxyHost {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_host: string;
  forward_port: number;
  websocket_upgrade?: boolean;
}

interface EnsureProxyHostOptions {
  npmApiUrl: string;
  npmEmail: string;
  npmPassword: string;
  hostname: string;
  forwardScheme: string;
  forwardHost: string;
  forwardPort: number;
  websocket: boolean;
}

interface EnsureProxyHostResult {
  id: number;
  created: boolean;
  updated: boolean;
}

async function login(npmApiUrl: string, email: string, password: string): Promise<string> {
  const response = await requestJson<{ token?: string; error?: { message?: string } }>(`${npmApiUrl}/api/tokens`, {
    method: 'POST',
    body: { identity: email, secret: password },
  });

  if (response.statusCode !== 200 || !response.body?.token) {
    throw new Error(`Nginx Proxy Manager login failed: ${response.body?.error?.message || response.statusCode}`);
  }

  return response.body.token;
}

async function findProxyHostByDomain(npmApiUrl: string, token: string, hostname: string): Promise<NpmProxyHost | null> {
  const response = await requestJson<NpmProxyHost[]>(`${npmApiUrl}/api/nginx/proxy-hosts`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.statusCode !== 200 || !Array.isArray(response.body)) {
    throw new Error(`Unable to list Nginx Proxy Manager proxy hosts: ${response.statusCode}`);
  }

  return response.body.find((host) => (host.domain_names || []).includes(hostname)) ?? null;
}

function buildProxyHostPayload({
  hostname,
  forwardScheme,
  forwardHost,
  forwardPort,
  websocket,
}: Pick<EnsureProxyHostOptions, 'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket'>) {
  return {
    domain_names: [hostname],
    forward_scheme: forwardScheme,
    forward_host: forwardHost,
    forward_port: forwardPort,
    websocket_upgrade: Boolean(websocket),
    block_exploits: true,
    caching_enabled: false,
    allow_websocket_upgrade: Boolean(websocket),
    access_list_id: '0',
    certificate_id: 0,
    ssl_forced: false,
    http2_support: false,
    hsts_enabled: false,
    hsts_subdomains: false,
  };
}

async function createProxyHost(
  npmApiUrl: string,
  token: string,
  options: Pick<EnsureProxyHostOptions, 'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket'>
): Promise<NpmProxyHost> {
  const response = await requestJson<NpmProxyHost & { error?: { message?: string } }>(`${npmApiUrl}/api/nginx/proxy-hosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: buildProxyHostPayload(options),
  });

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `Unable to create Nginx Proxy Manager proxy host: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body as NpmProxyHost;
}

async function updateProxyHost(
  npmApiUrl: string,
  token: string,
  id: number,
  options: Pick<EnsureProxyHostOptions, 'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket'>
): Promise<NpmProxyHost> {
  const response = await requestJson<NpmProxyHost & { error?: { message?: string } }>(
    `${npmApiUrl}/api/nginx/proxy-hosts/${id}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: buildProxyHostPayload(options),
    }
  );

  if (response.statusCode !== 200) {
    throw new Error(
      `Unable to update Nginx Proxy Manager proxy host: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body as NpmProxyHost;
}

/**
 * Idempotently ensure a proxy host exists for the given hostname, pointing
 * to the given upstream. Creates it if missing, updates it if the upstream
 * has changed, and leaves it untouched otherwise.
 */
export async function ensureProxyHost({
  npmApiUrl,
  npmEmail,
  npmPassword,
  hostname,
  forwardScheme,
  forwardHost,
  forwardPort,
  websocket,
}: EnsureProxyHostOptions): Promise<EnsureProxyHostResult> {
  const baseUrl = npmApiUrl.replace(/\/+$/, '');
  const token = await login(baseUrl, npmEmail, npmPassword);
  const existing = await findProxyHostByDomain(baseUrl, token, hostname);

  const options = { hostname, forwardScheme, forwardHost, forwardPort, websocket };

  if (!existing) {
    const created = await createProxyHost(baseUrl, token, options);
    return { id: created.id, created: true, updated: false };
  }

  const needsUpdate =
    existing.forward_scheme !== forwardScheme ||
    existing.forward_host !== forwardHost ||
    existing.forward_port !== forwardPort ||
    Boolean(existing.websocket_upgrade) !== Boolean(websocket);

  if (needsUpdate) {
    await updateProxyHost(baseUrl, token, existing.id, options);
    return { id: existing.id, created: false, updated: true };
  }

  return { id: existing.id, created: false, updated: false };
}
