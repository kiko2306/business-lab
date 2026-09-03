/**
 * TOTP (RFC 6238) primitives for the dashboard's own second factor, plus the
 * single-use recovery codes that go with it. Thin wrappers over `otplib` and
 * `qrcode` so the routes and tests have one place to reach for.
 */
import crypto from 'crypto';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// Shown in the authenticator app's account list.
const ISSUER = 'Homelab Management';

// Accept the current 30s step plus one on each side: a phone clock that is a
// little off, or a code typed just as it rolls over, still validates. Wider
// than this starts to matter for replay.
authenticator.options = { window: 1 };

const RECOVERY_CODE_COUNT = 10;

/** A fresh base32 TOTP secret. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** The `otpauth://` URI an authenticator app imports (also what the QR encodes). */
export function totpKeyUri(accountName: string, secret: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

/** Render an `otpauth://` URI to an inline SVG for the enrolment screen. */
export function totpQrSvg(otpauthUri: string): Promise<string> {
  return QRCode.toString(otpauthUri, { type: 'svg', margin: 1 });
}

/** True if `code` is a valid 6-digit token for `secret` right now (±1 step). */
export function verifyTotp(code: string, secret: string): boolean {
  const trimmed = String(code ?? '').trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return false;
  }
  try {
    return authenticator.check(trimmed, secret);
  } catch {
    // otplib throws on a malformed secret rather than returning false.
    return false;
  }
}

/**
 * Ten human-transcribable recovery codes, e.g. `3f9a2-c1d70`. Returned once,
 * at enrolment; only their hashes are stored.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex'); // 40 bits
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Strip formatting so `3f9a2-c1d70`, `3F9A2C1D70` and `3f9a2 c1d70` all match. */
export function normaliseRecoveryCode(code: string): string {
  return String(code ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Hash for `totp_recovery_codes.code_hash`. The code is a high-entropy random
 * value, so a plain SHA-256 is sufficient — a slow KDF would only add latency
 * to checking up to ten of them per attempt.
 */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}
