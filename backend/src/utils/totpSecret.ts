/**
 * Seal/open a user's TOTP secret for storage in `users.totp_secret`.
 *
 * The base32 secret is what an attacker with a copy of the database would need
 * to mint valid codes, so it is not stored in the clear. It is encrypted with
 * AES-256-GCM under a key derived from `JWT_SECRET` (HKDF-SHA256) — the same
 * secret the app already requires, so there is nothing new to generate or
 * enter (plan.md §0 principle 3, §127.2). Rotating `JWT_SECRET` invalidates
 * every stored secret: users would re-enrol, which is the acceptable cost of a
 * key rotation.
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// Bump the suffix if the derivation or format ever changes, so an old value
// fails closed (openSecret throws) rather than decrypting to garbage.
const HKDF_INFO = 'homelab-totp-secret-v1';
const FORMAT_TAG = 'v1';
const IV_BYTES = 12;

function deriveKey(): Buffer {
  const master = process.env.JWT_SECRET;
  if (!master) {
    throw new Error('JWT_SECRET is not set — cannot seal or open TOTP secrets');
  }
  // Empty salt: the master is already a high-entropy random secret, and a
  // fixed salt keeps the derivation reproducible across restarts without
  // storing anything.
  const derived = crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.alloc(0), Buffer.from(HKDF_INFO, 'utf8'), 32);
  return Buffer.from(derived);
}

/** Encrypt a plaintext TOTP secret to the string stored in the DB. */
export function sealSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_TAG, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join(':');
}

/** Decrypt a value produced by sealSecret. Throws if it is malformed or tampered. */
export function openSecret(sealed: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_TAG) {
    throw new Error('Unrecognised sealed TOTP secret format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}
