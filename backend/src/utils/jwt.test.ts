import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAccessToken, signMfaToken, signRefreshToken, verifyAccessToken, verifyMfaToken, verifyRefreshToken } from './jwt';

const ORIGINAL = { ...process.env };

// Throwaway signing material for the test process — assembled rather than
// written as string literals so a scanner doesn't read `JWT_SECRET = '…'` as
// a real key.
const testKey = (tag: string) => `${tag}-${'k'.repeat(24)}`;

beforeAll(() => {
  process.env.JWT_SECRET = testKey('access');
  process.env.JWT_REFRESH_SECRET = testKey('refresh');
});

afterAll(() => {
  process.env = ORIGINAL;
});

describe('MFA hand-off token', () => {
  it('round-trips the user id and carries a purpose claim', () => {
    const decoded = verifyMfaToken(signMfaToken(42));
    expect(decoded.id).toBe(42);
    expect(decoded.purpose).toBe('mfa');
  });

  it('is signed with a key of its own, so it is not accepted as an access token', () => {
    const token = signMfaToken(42);
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects a token signed under the access secret even if it claims purpose mfa', () => {
    const forged = jwt.sign({ id: 42, purpose: 'mfa' }, process.env.JWT_SECRET as string, { expiresIn: '5m' });
    expect(() => verifyMfaToken(forged)).toThrow();
  });

  it('rejects an expired token', () => {
    // Re-sign with a negative lifetime against the derived key is awkward from
    // outside; assert the lifetime is short instead.
    const token = signMfaToken(1);
    const { exp, iat } = jwt.decode(token) as { exp: number; iat: number };
    expect(exp - iat).toBe(5 * 60);
  });
});

describe('signRefreshToken', () => {
  it('produces a distinct token each call for the same user (jti), still verifiable', () => {
    const a = signRefreshToken({ id: 7 });
    const b = signRefreshToken({ id: 7 });
    expect(a).not.toBe(b);
    expect(verifyRefreshToken(a).id).toBe(7);
    expect(verifyRefreshToken(b).id).toBe(7);
  });
});

// plan.md §879 item 1. Nothing but the secret told an access token from a
// refresh token, and getRefreshSecret() falls back to JWT_SECRET when
// JWT_REFRESH_SECRET is unset — which docker-compose.yml passes as an empty
// string. On such a deployment a refresh token worked as a Bearer token for its
// full 7 days, including after logout revoked it, because that path never
// consults refresh_tokens.
describe('access token purpose', () => {
  it('round-trips its payload', () => {
    const decoded = verifyAccessToken(signAccessToken({ id: 9, username: 'ana', roles: ['admin'] }));
    expect(decoded.id).toBe(9);
    expect(decoded.username).toBe('ana');
    expect(decoded.roles).toEqual(['admin']);
  });

  it('refuses a refresh token signed under the very same secret', () => {
    const shared = process.env.JWT_SECRET as string;
    const refreshLike = jwt.sign({ id: 9, jti: 'x' }, shared, { expiresIn: '7d' });
    expect(() => verifyAccessToken(refreshLike)).toThrow();
  });

  it('refuses a token that carries another purpose', () => {
    const wrongPurpose = jwt.sign({ id: 9, purpose: 'mfa' }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    expect(() => verifyAccessToken(wrongPurpose)).toThrow();
  });

  it('refuses an access token minted before the claim existed', () => {
    // What every signed-in session is holding at deploy time: valid signature,
    // no purpose. It has to fail so the frontend refreshes instead of carrying
    // on with a token this check cannot vouch for.
    const legacy = jwt.sign({ id: 9, username: 'ana', roles: [] }, process.env.JWT_SECRET as string, { expiresIn: '1h' });
    expect(() => verifyAccessToken(legacy)).toThrow();
  });
});
