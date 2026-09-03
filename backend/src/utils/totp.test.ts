import { describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normaliseRecoveryCode,
  totpKeyUri,
  totpQrSvg,
  verifyTotp,
} from './totp';

describe('generateTotpSecret / totpKeyUri', () => {
  it('makes a base32 secret and an otpauth URI carrying the issuer and account', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const uri = totpKeyUri('alice', secret);
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Homelab%20Management');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('alice');
  });
});

describe('verifyTotp', () => {
  const secret = generateTotpSecret();

  it('accepts the current token for the secret', () => {
    expect(verifyTotp(authenticator.generate(secret), secret)).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(verifyTotp(`  ${authenticator.generate(secret)} `, secret)).toBe(true);
  });

  it('rejects a wrong code, and non-6-digit input, without throwing', () => {
    expect(verifyTotp('000000', secret)).toBe(false);
    expect(verifyTotp('12345', secret)).toBe(false);
    expect(verifyTotp('abcdef', secret)).toBe(false);
    expect(verifyTotp('', secret)).toBe(false);
  });

  it('does not blow up on a malformed secret', () => {
    expect(verifyTotp('123456', 'not-base32!!')).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates ten distinct xxxxx-xxxxx codes by default', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
    }
  });

  it('honours a custom count', () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it('normalises away case and separators before hashing', () => {
    expect(normaliseRecoveryCode('3F9A2-C1D70')).toBe('3f9a2c1d70');
    expect(hashRecoveryCode('3f9a2-c1d70')).toBe(hashRecoveryCode('  3F9A2 C1D70 '));
  });

  it('hashes to 64 hex chars and differs per code', () => {
    const [a, b] = generateRecoveryCodes(2);
    expect(hashRecoveryCode(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(a)).not.toBe(hashRecoveryCode(b));
  });
});

describe('totpQrSvg', () => {
  it('renders the otpauth URI to an inline SVG', async () => {
    const svg = await totpQrSvg(totpKeyUri('alice', generateTotpSecret()));
    expect(svg.trimStart().startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});
