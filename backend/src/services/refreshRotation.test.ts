import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => db);

import { claimRefreshToken } from './refreshRotation';

describe('claimRefreshToken', () => {
  it('claims a live token by marking it spent in one statement', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: 7, username: 'ana' }], rowCount: 1 });

    expect(await claimRefreshToken('tok')).toEqual({ ok: true, userId: 7, username: 'ana' });

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET rotated_at = NOW\(\)/);
    expect(sql).toMatch(/rotated_at IS NULL/);
    expect(sql).toMatch(/NOT rt\.revoked/);
  });

  it('refuses a token that is unknown, revoked or expired, without touching other sessions', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await claimRefreshToken('nope')).toEqual({ ok: false, reason: 'invalid' });
    expect(db.query).toHaveBeenCalledTimes(2);

    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 7, revoked: true, rotated_at: null, expired: false, age_ms: null }],
    });
    expect(await claimRefreshToken('logged-out')).toEqual({ ok: false, reason: 'invalid' });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  // Two tabs (or a retry) racing the same token must not sign the user out.
  it('refuses a just-spent token without revoking anything', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 7, revoked: false, rotated_at: new Date(), expired: false, age_ms: 2000 }],
    });
    expect(await claimRefreshToken('raced')).toEqual({ ok: false, reason: 'reuse-grace', userId: 7 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('treats a spent token replayed after the grace window as theft and revokes the whole user', async () => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 7, revoked: false, rotated_at: new Date(), expired: false, age_ms: 600_000 }],
    });
    db.query.mockResolvedValueOnce({ rowCount: 3 });

    expect(await claimRefreshToken('stolen')).toEqual({ ok: false, reason: 'reuse-compromise', userId: 7 });

    const [sql, params] = db.query.mock.calls[2];
    expect(sql).toMatch(/UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = \$1/);
    expect(params).toEqual([7]);
  });
});
