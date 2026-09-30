import { describe, expect, it, vi } from 'vitest';
import { resolveCloudflareIds } from './exposureIds';

const ID_A = 'a'.repeat(32);
const ID_Z = 'z'.repeat(32);

// plan.md §785: Settings no longer asks for the account and zone IDs. A value the
// owner did type is an override and wins; a blank one is derived from the token.
describe('resolveCloudflareIds', () => {
  it('derives both IDs from the token and domain when none were given', async () => {
    const lookup = vi.fn().mockResolvedValue({ zoneId: ID_Z, accountId: ID_A });
    await expect(resolveCloudflareIds({ baseDomain: 'example.com', token: 'tok', lookup })).resolves.toEqual({
      cloudflareAccountId: ID_A,
      cloudflareZoneId: ID_Z,
    });
    expect(lookup).toHaveBeenCalledWith('tok', 'example.com');
  });

  it('keeps an override and does not call Cloudflare when both were given', async () => {
    const lookup = vi.fn();
    await expect(
      resolveCloudflareIds({ baseDomain: 'example.com', token: 'tok', cloudflareAccountId: 'b'.repeat(32), cloudflareZoneId: 'y'.repeat(32), lookup })
    ).resolves.toEqual({ cloudflareAccountId: 'b'.repeat(32), cloudflareZoneId: 'y'.repeat(32) });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('fills only the one that is blank', async () => {
    const lookup = vi.fn().mockResolvedValue({ zoneId: ID_Z, accountId: ID_A });
    await expect(
      resolveCloudflareIds({ baseDomain: 'example.com', token: 'tok', cloudflareAccountId: 'b'.repeat(32), lookup })
    ).resolves.toEqual({ cloudflareAccountId: 'b'.repeat(32), cloudflareZoneId: ID_Z });
  });

  it('asks for the token, once, when there is none to derive from', async () => {
    const lookup = vi.fn();
    await expect(resolveCloudflareIds({ baseDomain: 'example.com', token: null, lookup })).rejects.toThrow(/Cloudflare API token/);
    expect(lookup).not.toHaveBeenCalled();
  });
});
