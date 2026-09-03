import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, withTransaction } = vi.hoisted(() => {
  const query = vi.fn();
  return {
    query,
    // Run the callback with a client whose `query` is the same spy, so tests
    // assert on one call log.
    withTransaction: vi.fn(async (fn: (client: { query: typeof query }) => unknown) => fn({ query })),
  };
});
vi.mock('../utils/database', () => ({ query, withTransaction }));

import { acceptInvitation, createInvitation, verifyInvitation, INVITATION_TTL_MS } from './userInvitations';

beforeEach(() => {
  query.mockReset();
  withTransaction.mockClear();
});

describe('createInvitation', () => {
  it('clears prior unaccepted invites and inserts a hashed token with a 72h expiry', async () => {
    query.mockResolvedValue({ rows: [] });
    const before = Date.now();

    const token = await createInvitation(42);

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, no padding
    const del = query.mock.calls[0];
    expect(del[0]).toMatch(/DELETE FROM user_invitations WHERE user_id = \$1 AND accepted_at IS NULL/);
    expect(del[1]).toEqual([42]);

    const ins = query.mock.calls[1];
    expect(ins[0]).toMatch(/INSERT INTO user_invitations/);
    const [userId, tokenHash, expiresAt] = ins[1];
    expect(userId).toBe(42);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(tokenHash).not.toBe(token); // the plaintext is never stored
    const ttl = (expiresAt as Date).getTime() - before;
    expect(ttl).toBeGreaterThan(INVITATION_TTL_MS - 5_000);
    expect(ttl).toBeLessThan(INVITATION_TTL_MS + 5_000);
  });
});

describe('verifyInvitation', () => {
  it('returns the target for a live token', async () => {
    query.mockResolvedValue({ rows: [{ user_id: 7, username: 'ann', email: 'a@x.com' }] });
    const target = await verifyInvitation('tok');
    expect(target).toEqual({ userId: 7, username: 'ann', email: 'a@x.com' });
    // Guards unaccepted + unexpired in SQL, keyed by the hash not the token.
    expect(query.mock.calls[0][0]).toMatch(/accepted_at IS NULL AND i\.expires_at > NOW\(\)/);
    expect(query.mock.calls[0][1][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null when nothing matches (unknown / spent / expired)', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await verifyInvitation('tok')).toBeNull();
  });
});

describe('acceptInvitation', () => {
  it('claims the token, sets the hash, drops sibling invites, returns the account', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 99, user_id: 7 }] }) // claim
      .mockResolvedValueOnce({ rows: [{ username: 'ann' }] }) // set hash
      .mockResolvedValueOnce({ rows: [] }); // delete siblings

    const result = await acceptInvitation('tok', '$2b$hash');

    expect(result).toEqual({ userId: 7, username: 'ann' });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE user_invitations SET accepted_at = NOW\(\)/);
    expect(query.mock.calls[1][0]).toMatch(/UPDATE users SET password_hash = \$2/);
    expect(query.mock.calls[1][1]).toEqual([7, '$2b$hash']);
    expect(query.mock.calls[2][0]).toMatch(/DELETE FROM user_invitations WHERE user_id = \$1 AND id <> \$2/);
    expect(query.mock.calls[2][1]).toEqual([7, 99]);
  });

  it('returns null and touches nothing else when the token no longer claims a row', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await acceptInvitation('tok', '$2b$hash');
    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
