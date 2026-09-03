import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTotpSecret } from './totp';
import { openSecret, sealSecret } from './totpSecret';

const ORIGINAL = process.env.JWT_SECRET;

// A throwaway base32 value — not a credential for anything; sealSecret treats
// its input as opaque bytes.
const sample = generateTotpSecret();

beforeEach(() => {
  process.env.JWT_SECRET = 'test-master-value-for-totp-sealing';
});

afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL;
});

describe('sealSecret / openSecret', () => {
  it('round-trips a base32 secret', () => {
    expect(openSecret(sealSecret(sample))).toBe(sample);
  });

  it('produces a versioned iv:tag:ciphertext string and a fresh IV each call', () => {
    const a = sealSecret(sample);
    const b = sealSecret(sample);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a.split(':')).toHaveLength(4);
    expect(a).not.toBe(b); // random IV
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const parts = sealSecret(sample).split(':');
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 0xff;
    parts[3] = bytes.toString('base64url');
    expect(() => openSecret(parts.join(':'))).toThrow();
  });

  it('cannot be opened under a different JWT_SECRET', () => {
    const sealed = sealSecret(sample);
    process.env.JWT_SECRET = 'a-different-master-value';
    expect(() => openSecret(sealed)).toThrow();
  });

  it('rejects an unrecognised format', () => {
    expect(() => openSecret('v2:aaa:bbb:ccc')).toThrow(/Unrecognised/);
    expect(() => openSecret('not-a-sealed-value')).toThrow(/Unrecognised/);
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => sealSecret(sample)).toThrow(/JWT_SECRET/);
  });
});
