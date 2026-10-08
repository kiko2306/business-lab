/**
 * The one way an email address is written into the database.
 *
 * Email is the identity key for a no-SSO app account:
 * `fanOutNoSsoCredentials` and `deprovisionNoSsoCredentials(apps, email)`
 * address that account by the address alone. So two dashboard accounts that
 * resolve to one address share one app login — revoking B's access deletes A's,
 * and resetting B's password rewrites A's (plan.md §879 item 3). `/setup`
 * already lowercased; the other write paths only trimmed, which left
 * `Ana@b.pt` and `ana@b.pt` as two accounts pointing at one app login.
 *
 * Case and surrounding space are the only things normalised. Dots and `+` tags
 * in the local part are the receiving server's business — collapsing them would
 * merge addresses a mail server treats as different, and refuse a second person
 * at the same domain.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
