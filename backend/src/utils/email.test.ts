import { describe, expect, it } from 'vitest';
import { normaliseEmail } from './email';

// plan.md §879 item 3. `fanOutNoSsoCredentials` and
// `deprovisionNoSsoCredentials(apps, email)` address an app account by email
// alone, so two dashboard accounts that resolve to one address share that app
// account. `/setup` already lowercased; `POST /users` and `PUT /:id/access`
// only trimmed, which let `Ana@b.pt` and `ana@b.pt` both exist.
describe('normaliseEmail', () => {
  it('trims and lowercases, so one address is one string', () => {
    expect(normaliseEmail('  Ana@B.PT  ')).toBe('ana@b.pt');
    expect(normaliseEmail('ana@b.pt')).toBe('ana@b.pt');
    expect(normaliseEmail('ANA@B.PT')).toBe('ana@b.pt');
  });

  it('leaves the characters of the local part alone', () => {
    // Only case and surrounding space are ours to change — dots and plus tags
    // are the receiving server's business, and collapsing them would merge two
    // addresses that a mail server treats as different.
    expect(normaliseEmail('a.n.a+invoices@b.pt')).toBe('a.n.a+invoices@b.pt');
  });

  it('is idempotent', () => {
    const once = normaliseEmail(' Ana@B.pt ');
    expect(normaliseEmail(once)).toBe(once);
  });
});
