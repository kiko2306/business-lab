import { describe, expect, it } from 'vitest';
import { stripPkceFlow } from './netbirdAuthFlow';

const withPkce = JSON.stringify(
  {
    DataStoreEncryptionKey: 'keep-me',
    DeviceAuthorizationFlow: { Provider: 'hosted' },
    PKCEAuthorizationFlow: { ProviderConfig: { RedirectURLs: ['http://localhost:53000/'] } },
  },
  null,
  2
);

describe('stripPkceFlow', () => {
  it('removes the PKCE flow and leaves everything else alone', () => {
    const next = stripPkceFlow(withPkce);
    expect(next).not.toBeNull();
    const parsed = JSON.parse(next!);
    expect(parsed).not.toHaveProperty('PKCEAuthorizationFlow');
    // Dropping the store encryption key would orphan every stored peer.
    expect(parsed.DataStoreEncryptionKey).toBe('keep-me');
    expect(parsed.DeviceAuthorizationFlow).toEqual({ Provider: 'hosted' });
  });

  // The caller restarts netbird-management on a change, which drops every
  // connected peer — so "already correct" has to be distinguishable from
  // "rewritten", not just idempotent.
  it('reports no change when the flow is already absent', () => {
    expect(stripPkceFlow(JSON.stringify({ DeviceAuthorizationFlow: {} }))).toBeNull();
    expect(stripPkceFlow(stripPkceFlow(withPkce)!)).toBeNull();
  });
});
