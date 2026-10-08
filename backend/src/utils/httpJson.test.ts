import http from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { requestJson } from './httpJson';

let server: http.Server | undefined;

function serve(handler: http.RequestListener): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/`);
    });
  });
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
});

describe('requestJson', () => {
  it('parses a normal JSON response', async () => {
    const url = await serve((_req, res) => res.end('{"ok":true}'));
    const response = await requestJson<{ ok: boolean }>(url);
    expect(response.body).toEqual({ ok: true });
  });

  // A response body is hostile input; it must not be buffered without limit.
  it('rejects a response larger than the cap', async () => {
    const url = await serve((_req, res) => res.end('x'.repeat(5 * 1024 * 1024)));
    await expect(requestJson(url)).rejects.toThrow(/exceeded/);
  });
});
