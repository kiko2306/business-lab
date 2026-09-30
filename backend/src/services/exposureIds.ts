import { lookupZone } from './cloudflareTunnelClient';

interface ResolveOptions {
  baseDomain: string;
  /** The stored Cloudflare API token, or null when none has been saved. */
  token: string | null;
  /** An ID the owner typed under Advanced; it wins over anything derived. */
  cloudflareAccountId?: string;
  cloudflareZoneId?: string;
  lookup?: typeof lookupZone;
}

/**
 * The account and zone IDs Settings would otherwise ask the owner to paste
 * (plan.md §785): both follow from the token and the domain, so only a blank
 * one is looked up. Throws with a plain message when there is nothing to
 * derive from or Cloudflare cannot answer.
 */
export async function resolveCloudflareIds({
  baseDomain,
  token,
  cloudflareAccountId,
  cloudflareZoneId,
  lookup = lookupZone,
}: ResolveOptions): Promise<{ cloudflareAccountId: string; cloudflareZoneId: string }> {
  if (cloudflareAccountId && cloudflareZoneId) {
    return { cloudflareAccountId, cloudflareZoneId };
  }
  if (!token) {
    throw new Error('Save the Cloudflare API token first: the account and zone are looked up from it.');
  }
  const found = await lookup(token, baseDomain);
  return {
    cloudflareAccountId: cloudflareAccountId || found.accountId,
    cloudflareZoneId: cloudflareZoneId || found.zoneId,
  };
}
