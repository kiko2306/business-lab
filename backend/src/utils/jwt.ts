import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthAccessPayload, AuthRefreshPayload } from '../types';

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';
// The MFA hand-off token (issued by /auth/login when a second factor is due,
// spent at /auth/login/totp) lives only as long as it takes to type a code.
const MFA_EXPIRES = '5m';

/** Parse a duration string like "7d", "1h", "30m" into milliseconds. */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
  const value = parseInt(match[1], 10);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers: Record<'s' | 'm' | 'h' | 'd', number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}

/** Milliseconds until the refresh token expires. */
export function refreshTokenExpiryMs(): number {
  return parseDurationMs(REFRESH_EXPIRES);
}

function getAccessSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is not set');
  return secret;
}

function getRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET (or fallback JWT_SECRET) environment variable is not set');
  return secret;
}

// A key of its own, derived from JWT_SECRET, so an MFA hand-off token can
// never be presented as an access token even on a deployment where
// JWT_REFRESH_SECRET is unset (and the access/refresh secrets coincide).
function getMfaSecret(): Buffer {
  const master = process.env.JWT_SECRET;
  if (!master) throw new Error('JWT_SECRET environment variable is not set');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.alloc(0), Buffer.from('homelab-mfa-token-v1', 'utf8'), 32));
}

export interface MfaTokenPayload {
  id: number;
  purpose: 'mfa';
}

export function signAccessToken(payload: AuthAccessPayload): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: ACCESS_EXPIRES as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(payload: AuthRefreshPayload): string {
  // jti makes each token unique even when two are minted for the same user in
  // the same second (iat resolution) — otherwise the JWT string is identical
  // and the INSERT hits refresh_tokens.token's UNIQUE constraint. Reachable
  // now that a 2FA login issues a second token for the same user moments
  // after /auth/login handed back the mfa challenge.
  return jwt.sign({ ...payload, jti: crypto.randomUUID() }, getRefreshSecret(), {
    expiresIn: REFRESH_EXPIRES as jwt.SignOptions['expiresIn'],
  });
}

/** Verify and decode an access token. Throws if invalid or expired. */
export function verifyAccessToken(token: string): AuthAccessPayload {
  return jwt.verify(token, getAccessSecret()) as AuthAccessPayload;
}

/**
 * Short-lived token that says "this user's password checked out; they still
 * owe a second factor". Carries no API authority — it is only accepted by
 * /auth/login/totp.
 */
export function signMfaToken(userId: number): string {
  return jwt.sign({ id: userId, purpose: 'mfa' } satisfies MfaTokenPayload, getMfaSecret(), {
    expiresIn: MFA_EXPIRES,
  });
}

/** Verify an MFA hand-off token. Throws if invalid, expired or the wrong kind. */
export function verifyMfaToken(token: string): MfaTokenPayload {
  const decoded = jwt.verify(token, getMfaSecret()) as MfaTokenPayload;
  if (decoded.purpose !== 'mfa' || typeof decoded.id !== 'number') {
    throw new Error('Not an MFA token');
  }
  return decoded;
}

/** Verify and decode a refresh token. Throws if invalid or expired. */
export function verifyRefreshToken(token: string): AuthRefreshPayload {
  return jwt.verify(token, getRefreshSecret()) as AuthRefreshPayload;
}
