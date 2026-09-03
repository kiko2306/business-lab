import { describe, expect, it } from 'vitest';
import { parseCredentials } from './recoverAdmin';

describe('parseCredentials', () => {
  it('returns the trimmed username and the raw password', () => {
    expect(parseCredentials({ RECOVER_USERNAME: '  admin  ', RECOVER_PASSWORD: 'hunter2hunter2' })).toEqual({
      username: 'admin',
      password: 'hunter2hunter2',
    });
  });

  it('rejects an empty or whitespace-only username', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: '   ', RECOVER_PASSWORD: 'longenough' })).toThrow(
      /RECOVER_USERNAME is empty/
    );
    expect(() => parseCredentials({ RECOVER_PASSWORD: 'longenough' })).toThrow(/RECOVER_USERNAME is empty/);
  });

  it('enforces the same 8–128 char bound as the login flow', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'short' })).toThrow(/8.128/);
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'a'.repeat(129) })).toThrow(/8.128/);
    expect(parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'a'.repeat(8) }).password).toHaveLength(8);
    expect(parseCredentials({ RECOVER_USERNAME: 'admin', RECOVER_PASSWORD: 'a'.repeat(128) }).password).toHaveLength(128);
  });

  it('does not treat a missing password as valid', () => {
    expect(() => parseCredentials({ RECOVER_USERNAME: 'admin' })).toThrow(/8.128/);
  });
});
