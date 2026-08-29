/**
 * Nginx Proxy Manager API client.
 * Idempotently finds, creates, or updates proxy hosts for exposed services.
 * https://nginxproxymanager.com/api/
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { requestJson } from '../utils/httpJson';

const execFileAsync = promisify(execFile);

interface NpmProxyHost {
  id: number;
  domain_names: string[];
  forward_scheme: string;
  forward_host: string;
  forward_port: number;
  allow_websocket_upgrade?: boolean;
  http2_support?: boolean;
  certificate_id?: number;
  ssl_forced?: boolean;
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
  grpc: boolean;
}

// Gates a proxy host behind Authelia's forward-auth — see the snippet files
// this references (mounted into the NPM container, apps/nginx-proxy-manager/
// snippets/) and apps/authelia/config/configuration.yml for the other half.
// This location block replaces NPM's own auto-generated one entirely, which
// is otherwise what adds WebSocket upgrade support when a host has
// allow_websocket_upgrade on (true for every app here) — so it has to be
// re-added here too, or apps that depend on it (e.g. code-server's
// workbench) break with a WebSocket close code 1006.
const AUTHELIA_ADVANCED_CONFIG = [
  'include /snippets/authelia-location.conf;',
  '',
  'location / {',
  // proxy.conf already sets proxy_http_version 1.1 — do not redeclare it
  // here, nginx treats a second copy in the same location as a fatal
  // "duplicate directive" and refuses to reload the whole host.
  '    include /snippets/proxy.conf;',
  '    include /snippets/authelia-authrequest.conf;',
  '    proxy_set_header Upgrade $http_upgrade;',
  '    proxy_set_header Connection "upgrade";',
  '    proxy_pass $forward_scheme://$server:$port;',
  '}',
].join('\n');

// Native gRPC (mobile/desktop/CLI clients) requires HTTP/2 all the way to
// the upstream — proxy_pass never speaks HTTP/2 to the backend regardless of
// http2_support on the listener, so it needs grpc_pass instead. But the
// browser dashboard's calls (REST `/api/*` plus grpc-web, which encodes
// trailers into the response body specifically so it *doesn't* need real
// HTTP/2 trailers) must NOT go through grpc_pass unconditionally — routing
// them through it broke the dashboard (peers/login calls hang forever)
// because it forces genuine end-to-end HTTP/2 gRPC semantics, which hits the
// same upstream cloudflared trailers-stripping bug that blocks native
// clients (see plan.md §20.9/§23 netbird session log). So: only requests
// whose Content-Type is exactly "application/grpc" (native gRPC — grpc-web
// sends "application/grpc-web+proto") take the grpc_pass path; everything
// else (REST, grpc-web) falls through to a plain HTTP/1.1 proxy_pass, same
// as every other proxied app. This fully replaces NPM's own auto-generated
// location /, same reasoning as the Authelia block above. http2_support must
// also be turned on at the host level (see buildProxyHostPayload) for the
// front-end side, since native gRPC still needs it.
function buildGrpcAdvancedConfig(forwardHost: string, forwardPort: number): string {
  return [
    'location / {',
    '    if ($http_content_type = "application/grpc") {',
    `        grpc_pass grpc://${forwardHost}:${forwardPort};`,
    '    }',
    '    include /snippets/proxy.conf;',
    `    proxy_pass http://${forwardHost}:${forwardPort};`,
    '}',
  ].join('\n');
}

interface EnsureProxyHostResult {
  id: number;
  created: boolean;
  updated: boolean;
}

interface NpmCertificate {
  id: number;
  provider: string;
  domain_names: string[];
}

async function findCertificateByDomain(npmApiUrl: string, token: string, hostname: string): Promise<NpmCertificate | null> {
  const response = await requestJson<NpmCertificate[]>(`${npmApiUrl}/api/nginx/certificates`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.statusCode !== 200 || !Array.isArray(response.body)) {
    throw new Error(`Unable to list Nginx Proxy Manager certificates: ${response.statusCode}`);
  }

  return response.body.find((cert) => cert.provider === 'other' && (cert.domain_names || []).includes(hostname)) ?? null;
}

async function createCertificateRecord(npmApiUrl: string, token: string, hostname: string): Promise<number> {
  const response = await requestJson<{ id?: number; error?: { message?: string } }>(
    `${npmApiUrl}/api/nginx/certificates`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { provider: 'other', nice_name: hostname, domain_names: [hostname] },
    }
  );

  if ((response.statusCode !== 200 && response.statusCode !== 201) || !response.body?.id) {
    throw new Error(
      `Unable to create Nginx Proxy Manager certificate record: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body.id;
}

// gRPC needs a real TLS+HTTP2/ALPN hop from cloudflared to NPM — Cloudflare
// requires this for its own edge gRPC support (see the `originServerName`/
// `noTLSVerify` handling in cloudflareTunnelClient.ts). Only cloudflared
// ever connects to this host over TLS, via `noTLSVerify` on the tunnel
// side, so a publicly-trusted certificate buys nothing — a self-signed one
// generated here is sufficient and avoids depending on ACME/DNS-01 working
// through the tunnel topology.
async function generateSelfSignedCertificate(hostname: string): Promise<{ certificate: string; certificateKey: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'npm-cert-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');

  try {
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '825',
      '-subj',
      `/CN=${hostname}`,
    ]);

    const [certificate, certificateKey] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
    return { certificate, certificateKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function uploadCertificateFiles(
  npmApiUrl: string,
  token: string,
  certificateId: number,
  certificate: string,
  certificateKey: string
): Promise<void> {
  const boundary = `npmCertUpload${Date.now()}${Math.random().toString(16).slice(2)}`;
  const part = (field: string, filename: string, content: string) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      Buffer.from(content),
      Buffer.from('\r\n'),
    ]);
  const rawBody = Buffer.concat([
    part('certificate', 'cert.pem', certificate),
    part('certificate_key', 'key.pem', certificateKey),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  const response = await requestJson<{ error?: { message?: string } }>(
    `${npmApiUrl}/api/nginx/certificates/${certificateId}/upload`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      rawBody,
    }
  );

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Unable to upload Nginx Proxy Manager certificate files: ${response.body?.error?.message || response.statusCode}`
    );
  }
}

/**
 * Idempotently ensure a self-signed "other"-provider certificate exists in
 * NPM for `hostname`, returning its id. Only called for gRPC exposures.
 */
async function ensureGrpcCertificate(npmApiUrl: string, token: string, hostname: string): Promise<number> {
  const existing = await findCertificateByDomain(npmApiUrl, token, hostname);
  if (existing) {
    return existing.id;
  }

  const id = await createCertificateRecord(npmApiUrl, token, hostname);
  const { certificate, certificateKey } = await generateSelfSignedCertificate(hostname);
  await uploadCertificateFiles(npmApiUrl, token, id, certificate, certificateKey);
  return id;
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

type ProxyHostWriteOptions = Pick<
  EnsureProxyHostOptions,
  'hostname' | 'forwardScheme' | 'forwardHost' | 'forwardPort' | 'websocket' | 'autheliaProtected' | 'grpc'
> & {
  // Only set (non-zero) for grpc hosts — see ensureGrpcCertificate. Cloudflare
  // requires the origin to terminate real TLS+HTTP2/ALPN for gRPC to work at
  // all, which NPM only does once a certificate is attached to the host.
  certificateId: number;
};

export function buildProxyHostPayload({
  hostname,
  forwardScheme,
  forwardHost,
  forwardPort,
  websocket,
  autheliaProtected,
  grpc,
  certificateId,
}: ProxyHostWriteOptions) {
  return {
    domain_names: [hostname],
    forward_scheme: forwardScheme,
    forward_host: forwardHost,
    forward_port: forwardPort,
    block_exploits: true,
    caching_enabled: false,
    // NPM auto-injects proxy_http_version/Upgrade/Connection itself when
    // this is on, regardless of a custom advanced_config — the Authelia and
    // gRPC blocks below set their own directives (since both fully replace
    // NPM's own location /), so leaving this also on means both add the
    // same directive and nginx fails to reload at all.
    allow_websocket_upgrade: autheliaProtected || grpc ? false : Boolean(websocket),
    access_list_id: '0',
    certificate_id: grpc ? certificateId : 0,
    ssl_forced: grpc,
    http2_support: grpc ? true : false,
    hsts_enabled: false,
    hsts_subdomains: false,
    advanced_config: grpc
      ? buildGrpcAdvancedConfig(forwardHost, forwardPort)
      : autheliaProtected
        ? AUTHELIA_ADVANCED_CONFIG
        : '',
  };
}

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
 * Idempotently delete a proxy host by id — used to tear down exposure when a
 * service's exposure is disabled. A 404 (already gone, e.g. hand-deleted in
 * NPM) is treated as success rather than an error.
 */
export async function deleteProxyHost(npmApiUrl: string, npmEmail: string, npmPassword: string, id: number): Promise<void> {
  const baseUrl = npmApiUrl.replace(/\/+$/, '');
  const token = await login(baseUrl, npmEmail, npmPassword);

  const response = await requestJson<{ error?: { message?: string } }>(`${baseUrl}/api/nginx/proxy-hosts/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.statusCode !== 200 && response.statusCode !== 404) {
    throw new Error(
      `Unable to delete Nginx Proxy Manager proxy host: ${response.body?.error?.message || response.statusCode}`
    );
  }
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
  grpc,
}: EnsureProxyHostOptions): Promise<EnsureProxyHostResult> {
  const baseUrl = npmApiUrl.replace(/\/+$/, '');
  const token = await login(baseUrl, npmEmail, npmPassword);
  const certificateId = grpc ? await ensureGrpcCertificate(baseUrl, token, hostname) : 0;
  const existing = await findProxyHostByDomain(baseUrl, token, hostname);

  const options = { hostname, forwardScheme, forwardHost, forwardPort, websocket, autheliaProtected, grpc, certificateId };

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

  const expectedAdvancedConfig = grpc
    ? buildGrpcAdvancedConfig(forwardHost, forwardPort)
    : autheliaProtected
      ? AUTHELIA_ADVANCED_CONFIG
      : '';
  const expectedWebsocketUpgrade = autheliaProtected || grpc ? false : Boolean(websocket);
  const needsUpdate =
    existing.forward_scheme !== forwardScheme ||
    existing.forward_host !== forwardHost ||
    existing.forward_port !== forwardPort ||
    Boolean(existing.allow_websocket_upgrade) !== expectedWebsocketUpgrade ||
    Boolean(existing.http2_support) !== grpc ||
    Boolean(existing.ssl_forced) !== grpc ||
    (grpc && existing.certificate_id !== certificateId) ||
    (existing.advanced_config ?? '') !== expectedAdvancedConfig;

  if (needsUpdate) {
    await updateProxyHost(baseUrl, token, existing.id, options);
    return { id: existing.id, created: false, updated: true };
  }

  return { id: existing.id, created: false, updated: false };
}
