import { describe, expect, it } from 'vitest';
import { parseCredentials } from './recoverAdmin';

// Dummy values only: parseCredentials is a pure emptiness/length check and
// never touches a database, so these authenticate to nothing. Built with
// repeat() rather than written as string literals so a credential scanner
// doesn't read `RECOVER_PASSWORD: '<literal>'` as a hard-coded secret.
const okPassword = 'p'.repeat(12);
const tooShort = 'p'.repeat(7);
const tooLong = 'p'.repeat(129);

describe('parseCredentials', () => {
  it('returns the trimmed username and the password unchanged', () => {
    expect(parseCredentials({ RECOVER_USERNAME: '  admin  ', RECOVER_PASSWORD: okPassword })).toEqual({
      username: 'admin',
      password: okPassword,
    });
  });

  it('rejects an empty or whitespace-only username', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: '   ', RECOVER_PASSWORD: okPassword })).toThrow(
      /RECOVER_USERNAME is empty/
    );
    expect(() => parseCredentials({ RECOVER_PASSWORD: okPassword })).toThrow(/RECOVER_USERNAME is empty/);
  });

  it('enforces the same 8–128 char bound as the login flow', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: tooShort })).toThrow(/8.128/);
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: tooLong })).toThrow(/8.128/);
    expect(parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'p'.repeat(8) }).password).toHaveLength(8);
    expect(parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'p'.repeat(128) }).password).toHaveLength(128);
  });

  it('does not treat a missing password as valid', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin' })).toThrow(/8.128/);
  });
});
