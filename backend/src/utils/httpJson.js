'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Minimal JSON HTTP client used by external API clients (Nginx Proxy
 * Manager, Cloudflare). Avoids adding a dependency for a handful of calls.
 */
function requestJson(urlString, { method = 'GET', headers = {}, body, timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`Invalid URL: ${urlString}`));
      return;
    }

    const transport = url.protocol === 'http:' ? http : https;
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const requestHeaders = { ...headers };
    if (payload !== null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const request = transport.request(
      url,
      { method, headers: requestHeaders },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          let parsed = null;
          if (raw) {
            try {
              parsed = JSON.parse(raw);
            } catch {
              parsed = null;
            }
          }
          resolve({ statusCode, body: parsed, raw });
        });
      }
    );

    request.on('error', (error) => reject(error));
    request.setTimeout(timeout, () => request.destroy(new Error(`Request to ${urlString} timed out.`)));

    if (payload !== null) {
      request.write(payload);
    }
    request.end();
  });
}

module.exports = { requestJson };
