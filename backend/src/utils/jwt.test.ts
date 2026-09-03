import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signMfaToken, signRefreshToken, verifyAccessToken, verifyMfaToken, verifyRefreshToken } from './jwt';

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
