import jwt from 'jsonwebtoken';
import { AuthAccessPayload, AuthRefreshPayload } from '../types';

const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

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

export function signAccessToken(payload: AuthAccessPayload): string {
  return jwt.sign(payload, getAccessSecret(), { expiresIn: ACCESS_EXPIRES as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(payload: AuthRefreshPayload): string {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: REFRESH_EXPIRES as jwt.SignOptions['expiresIn'] });
}

/** Verify and decode an access token. Throws if invalid or expired. */
export function verifyAccessToken(token: string): AuthAccessPayload {
  return jwt.verify(token, getAccessSecret()) as AuthAccessPayload;
}

/** Verify and decode a refresh token. Throws if invalid or expired. */
export function verifyRefreshToken(token: string): AuthRefreshPayload {
  return jwt.verify(token, getRefreshSecret()) as AuthRefreshPayload;
}
