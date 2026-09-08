import { describe, it, expect } from 'vitest';
import {
  renderOidcClientsBlock,
  spliceOidcClients,
  pbkdf2ClientSecretDigest,
  ManagedOidcClient,
} from './autheliaOidcClients';

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

describe('pbkdf2ClientSecretDigest', () => {
  // Byte-for-byte fixtures — the sha256(secret)[:16] salt makes these stable.
  // Both verify with `authelia crypto hash validate --password <s> -- <digest>`
  // (plan.md §281).
  it('produces Authelia-format pbkdf2-sha512 digests, deterministic per secret', () => {
    expect(pbkdf2ClientSecretDigest('s3cr3t')).toBe(
      '$pbkdf2-sha512$310000$TnOMpVY8Bs/QAYKZkz1Y2w$kD85nmqd59DGSlVUJ2DP58k/CdFSJCU4sR2/LGSSpUIpoyqgLkUhaCS3tF7XoTuQpo31Jc55mPXC2TZUci.49Q'
    );
    expect(pbkdf2ClientSecretDigest('rotated')).toBe(
      '$pbkdf2-sha512$310000$9CVG1ezdRSUJgIstbQQTtQ$Xiam5YV1FfmAzWODNO6Y4GlqN3KZgbU5qmuLdD8uijF2.asL0/HNJOEl3Fu7txitYuIyfxMoPqeWuIofqsGFIQ'
    );
  });
});

describe('renderOidcClientsBlock', () => {
  it('emits marker-delimited entries at the 6-space list indent', () => {
    const block = renderOidcClientsBlock([VIKUNJA]);
    expect(block).toContain("      - client_id: 'vikunja'");
    // The plaintext secret is never written; only its pbkdf2 digest.
    expect(block).not.toContain("'s3cr3t'");
    expect(block).toContain(`        client_secret: '${pbkdf2ClientSecretDigest('s3cr3t')}'`);
    expect(block).toContain("          - 'https://vikunja.example.com/auth/openid/authelia'");
    expect(block.startsWith('      # >>> managed by the dashboard')).toBe(true);
    expect(block.trimEnd().endsWith('# <<< managed by the dashboard')).toBe(true);
  });

  it('defaults to client_secret_post with no PKCE lines', () => {
    const block = renderOidcClientsBlock([VIKUNJA]);
    expect(block).toContain("        token_endpoint_auth_method: 'client_secret_post'");
    expect(block).not.toContain('require_pkce');
    expect(block).not.toContain('pkce_challenge_method');
  });

  it('sets implicit consent so first-party apps skip the OAuth accept screen', () => {
    const block = renderOidcClientsBlock([VIKUNJA]);
    expect(block).toContain("        consent_mode: 'implicit'");
  });

  it('emits PKCE lines and the chosen auth method for a per-app override (§274)', () => {
    const block = renderOidcClientsBlock([
      { ...VIKUNJA, requirePkce: true, tokenEndpointAuthMethod: 'client_secret_basic' },
    ]);
    expect(block).toContain('        require_pkce: true');
    expect(block).toContain("        pkce_challenge_method: 'S256'");
    expect(block).toContain("        token_endpoint_auth_method: 'client_secret_basic'");
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
    expect(twice).toContain(`client_secret: '${pbkdf2ClientSecretDigest('rotated')}'`);
    expect(twice).not.toContain(pbkdf2ClientSecretDigest('s3cr3t'));
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
