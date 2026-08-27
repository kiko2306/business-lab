import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface JsonResponse<T = unknown> {
  statusCode: number;
  body: T | null;
  raw: string;
}

export interface RequestJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  // Pre-built request body (e.g. a multipart/form-data payload) sent as-is,
  // bypassing JSON.stringify — the caller must set its own Content-Type
  // header. Takes precedence over `body` if both are given.
  rawBody?: Buffer;
  timeout?: number;
}

/**
 * Minimal JSON HTTP client used by external API clients (Nginx Proxy
 * Manager, Cloudflare). Avoids adding a dependency for a handful of calls.
 */
export function requestJson<T = unknown>(
  urlString: string,
  { method = 'GET', headers = {}, body, rawBody, timeout = 10000 }: RequestJsonOptions = {}
): Promise<JsonResponse<T>> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      reject(new Error(`Invalid URL: ${urlString}`));
      return;
    }

    const transport = url.protocol === 'http:' ? http : https;
    const payload = rawBody ?? (body !== undefined ? JSON.stringify(body) : null);
    const requestHeaders: Record<string, string> = { ...headers };
    if (rawBody) {
      requestHeaders['Content-Length'] = String(rawBody.length);
    } else if (payload !== null) {
      requestHeaders['Content-Type'] = 'application/json';
      requestHeaders['Content-Length'] = String(Buffer.byteLength(payload as string));
    }

    const request = transport.request(url, { method, headers: requestHeaders }, (response) => {
      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        const statusCode = response.statusCode ?? 0;
        let parsed: T | null = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw) as T;
          } catch {
            parsed = null;
          }
        }
        resolve({ statusCode, body: parsed, raw });
      });
    });

    request.on('error', (error) => reject(error));
    request.setTimeout(timeout, () => request.destroy(new Error(`Request to ${urlString} timed out.`)));

    if (payload !== null) {
      request.write(payload);
    }
    request.end();
  });
}
