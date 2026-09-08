import { describe, expect, it } from 'vitest';
import { isSameOrigin } from './corsOrigin';

describe('isSameOrigin', () => {
  it('matches a LAN-IP origin against the same LAN-IP host', () => {
    expect(isSameOrigin('http://192.168.1.236:10001', '192.168.1.236:10001')).toBe(true);
  });

  it('matches the public Cloudflare hostname against itself', () => {
    expect(isSameOrigin('https://homelab.tx-home-utils.com', 'homelab.tx-home-utils.com')).toBe(true);
  });

  it('matches localhost against itself', () => {
    expect(isSameOrigin('http://localhost:10001', 'localhost:10001')).toBe(true);
  });

  it('rejects a different host entirely', () => {
    expect(isSameOrigin('https://evil.example.com', 'homelab.tx-home-utils.com')).toBe(false);
  });

  it('rejects a matching hostname on a different port', () => {
    expect(isSameOrigin('http://localhost:9999', 'localhost:10001')).toBe(false);
  });

  it('rejects an unparseable origin rather than throwing', () => {
    expect(isSameOrigin('not-a-url', 'localhost:10001')).toBe(false);
  });

  it('rejects when the request has no Host header', () => {
    expect(isSameOrigin('http://localhost:10001', undefined)).toBe(false);
  });
});
