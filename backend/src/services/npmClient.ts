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
  allow_websocket_upgrade?: boolean;
  advanced_config?: string;
}

interface EnsureProxyHostOptions {
  npmApiUrl: string;
  npmEmail: string;
  npmPassword: string;
  hostname: string;
  expectedHostId?: number | null;
  forwardScheme: string;
  forwardHost: string;
  forwardPort: number;
  websocket: boolean;
  autheliaProtected: boolean;
}

// Gates a proxy host behind Authelia's forward-auth — see the snippet files
// this references (mounted into the NPM container, apps/nginx-proxy-manager/
// snippets/) and apps/authelia/config/configuration.yml for the other half.
const AUTHELIA_ADVANCED_CONFIG = [
  'include /snippets/authelia-location.conf;',
  '',
  'location / {',
  '    include /snippets/proxy.conf;',
  '    include /snippets/authelia-authrequest.conf;',
  '    proxy_pass $forward_scheme://$server:$port;',
  '}',
].join('\n');

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

/**
 * Verify that the given credentials can log in to Nginx Proxy Manager,
 * without creating or changing anything. Throws with a descriptive message
 * on failure.
 */
export async function testNpmConnection(npmApiUrl: string, npmEmail: string, npmPassword: string): Promise<void> {
  await login(npmApiUrl.replace(/\/+$/, ''), npmEmail, npmPassword);
}

export function buildProxyHostPayload({
  hostname,
  forwardScheme,
  forwardHost,
  forwardPort,
  websocket,
  autheliaProtected,
}: Pick<
  EnsureProxyHostOptions,
  'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket' | 'autheliaProtected'
>) {
  return {
    domain_names: [hostname],
    forward_scheme: forwardScheme,
    forward_host: forwardHost,
    forward_port: forwardPort,
    block_exploits: true,
    caching_enabled: false,
    allow_websocket_upgrade: Boolean(websocket),
    access_list_id: '0',
    certificate_id: 0,
    ssl_forced: false,
    http2_support: false,
    hsts_enabled: false,
    hsts_subdomains: false,
    advanced_config: autheliaProtected ? AUTHELIA_ADVANCED_CONFIG : '',
  };
}

type ProxyHostWriteOptions = Pick<
  EnsureProxyHostOptions,
  'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket' | 'autheliaProtected'
>;

async function createProxyHost(npmApiUrl: string, token: string, options: ProxyHostWriteOptions): Promise<NpmProxyHost> {
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
  options: ProxyHostWriteOptions
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
  expectedHostId,
  forwardScheme,
  forwardHost,
  forwardPort,
  websocket,
  autheliaProtected,
}: EnsureProxyHostOptions): Promise<EnsureProxyHostResult> {
  const baseUrl = npmApiUrl.replace(/\/+$/, '');
  const token = await login(baseUrl, npmEmail, npmPassword);
  const existing = await findProxyHostByDomain(baseUrl, token, hostname);

  const options = { hostname, forwardScheme, forwardHost, forwardPort, websocket, autheliaProtected };

  if (!existing) {
    const created = await createProxyHost(baseUrl, token, options);
    return { id: created.id, created: true, updated: false };
  }

  // Existing hosts must have been created by a previous provisioning run.
  // This prevents a service setting from silently overwriting an administrator's
  // manually maintained NPM host that uses the same domain.
  if (!expectedHostId || existing.id !== expectedHostId) {
    throw new Error(`Nginx Proxy Manager host for ${hostname} already exists and is not managed by this service.`);
  }

  const expectedAdvancedConfig = autheliaProtected ? AUTHELIA_ADVANCED_CONFIG : '';
  const needsUpdate =
    existing.forward_scheme !== forwardScheme ||
    existing.forward_host !== forwardHost ||
    existing.forward_port !== forwardPort ||
    Boolean(existing.allow_websocket_upgrade) !== Boolean(websocket) ||
    (existing.advanced_config ?? '') !== expectedAdvancedConfig;

  if (needsUpdate) {
    await updateProxyHost(baseUrl, token, existing.id, options);
    return { id: existing.id, created: false, updated: true };
  }

  return { id: existing.id, created: false, updated: false };
}
