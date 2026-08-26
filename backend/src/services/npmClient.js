'use strict';

/**
 * Nginx Proxy Manager API client.
 * Idempotently finds, creates, or updates proxy hosts for exposed services.
 * https://nginxproxymanager.com/api/
 */

const { requestJson } = require('../utils/httpJson');

async function login(npmApiUrl, email, password) {
  const response = await requestJson(`${npmApiUrl}/api/tokens`, {
    method: 'POST',
    body: { identity: email, secret: password },
  });

  if (response.statusCode !== 200 || !response.body?.token) {
    throw new Error(
      `Nginx Proxy Manager login failed: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body.token;
}

async function findProxyHostByDomain(npmApiUrl, token, hostname) {
  const response = await requestJson(`${npmApiUrl}/api/nginx/proxy-hosts`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.statusCode !== 200 || !Array.isArray(response.body)) {
    throw new Error(`Unable to list Nginx Proxy Manager proxy hosts: ${response.statusCode}`);
  }

  return response.body.find((host) => (host.domain_names || []).includes(hostname)) ?? null;
}

function buildProxyHostPayload({ hostname, forwardScheme, forwardHost, forwardPort, websocket }) {
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

async function createProxyHost(npmApiUrl, token, options) {
  const response = await requestJson(`${npmApiUrl}/api/nginx/proxy-hosts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: buildProxyHostPayload(options),
  });

  if (response.statusCode !== 200 && response.statusCode !== 201) {
    throw new Error(
      `Unable to create Nginx Proxy Manager proxy host: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body;
}

async function updateProxyHost(npmApiUrl, token, id, options) {
  const response = await requestJson(`${npmApiUrl}/api/nginx/proxy-hosts/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: buildProxyHostPayload(options),
  });

  if (response.statusCode !== 200) {
    throw new Error(
      `Unable to update Nginx Proxy Manager proxy host: ${response.body?.error?.message || response.statusCode}`
    );
  }

  return response.body;
}

/**
 * Idempotently ensure a proxy host exists for the given hostname, pointing
 * to the given upstream. Creates it if missing, updates it if the upstream
 * has changed, and leaves it untouched otherwise.
 */
async function ensureProxyHost({ npmApiUrl, npmEmail, npmPassword, hostname, forwardScheme, forwardHost, forwardPort, websocket }) {
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

module.exports = { ensureProxyHost };
