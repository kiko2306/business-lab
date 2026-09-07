import { describe, it, expect } from 'vitest';
import { renderOidcClientsBlock, spliceOidcClients, ManagedOidcClient } from './autheliaOidcClients';

const VIKUNJA: ManagedOidcClient = {
  id: 'vikunja',
  name: 'Vikunja',
  secret: 's3cr3t',
  redirectUris: ['https://vikunja.example.com/auth/openid/authelia'],
  scopes: ['openid', 'profile', 'email'],
};

// A minimal stand-in for the real configuration.yml: the `oidc.clients` list
// with one static (hand-maintained) entry, the shape start.sh's template ships.
const CONFIG = `identity_providers:
  oidc:
    cors:
      endpoints:
        - 'token'
    clients:
      - client_id: 'netbird-dashboard'
        client_name: 'NetBird Dashboard'
        public: true
access_control:
  default_policy: deny
`;

describe('renderOidcClientsBlock', () => {
  it('emits marker-delimited entries at the 6-space list indent', () => {
    const block = renderOidcClientsBlock([VIKUNJA]);
    expect(block).toContain("      - client_id: 'vikunja'");
    expect(block).toContain("        client_secret: 's3cr3t'");
    expect(block).toContain("          - 'https://vikunja.example.com/auth/openid/authelia'");
    expect(block.startsWith('      # >>> managed by the dashboard')).toBe(true);
    expect(block.trimEnd().endsWith('# <<< managed by the dashboard')).toBe(true);
  });

  it('is just the marker pair when there are no managed clients', () => {
    const block = renderOidcClientsBlock([]);
    expect(block.split('\n').filter((l) => l.includes('client_id'))).toHaveLength(0);
    expect(block).toContain('# >>> managed by the dashboard');
    expect(block).toContain('# <<< managed by the dashboard');
  });
});

describe('spliceOidcClients', () => {
  it('inserts the block under clients: above the static entry, keeping it', () => {
    const out = spliceOidcClients(CONFIG, renderOidcClientsBlock([VIKUNJA]));
    expect(out).toContain("      - client_id: 'vikunja'");
    expect(out).toContain("      - client_id: 'netbird-dashboard'"); // static entry untouched
    // managed block sits before the static client
    expect(out.indexOf("client_id: 'vikunja'")).toBeLessThan(out.indexOf("client_id: 'netbird-dashboard'"));
    expect(out).toContain('access_control:'); // rest of the file untouched
  });

  it('replaces a previous managed block rather than stacking', () => {
    const once = spliceOidcClients(CONFIG, renderOidcClientsBlock([VIKUNJA]));
    const twice = spliceOidcClients(once, renderOidcClientsBlock([{ ...VIKUNJA, secret: 'rotated' }]));
    expect(twice.match(/client_id: 'vikunja'/g)).toHaveLength(1);
    expect(twice).toContain("client_secret: 'rotated'");
    expect(twice).not.toContain("client_secret: 's3cr3t'");
  });

  it('is idempotent for an unchanged client set', () => {
    const once = spliceOidcClients(CONFIG, renderOidcClientsBlock([VIKUNJA]));
    const twice = spliceOidcClients(once, renderOidcClientsBlock([VIKUNJA]));
    expect(twice).toBe(once);
  });

  it('clears back to an empty managed block when the last client goes away', () => {
    const withClient = spliceOidcClients(CONFIG, renderOidcClientsBlock([VIKUNJA]));
    const cleared = spliceOidcClients(withClient, renderOidcClientsBlock([]));
    expect(cleared).not.toContain('vikunja');
    expect(cleared).toContain("      - client_id: 'netbird-dashboard'");
  });

  it('leaves a config with no oidc.clients list untouched', () => {
    const noOidc = 'access_control:\n  default_policy: deny\n';
    expect(spliceOidcClients(noOidc, renderOidcClientsBlock([VIKUNJA]))).toBe(noOidc);
  });
});
