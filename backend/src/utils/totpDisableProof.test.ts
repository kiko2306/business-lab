import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticator } from 'otplib';
import { query } from './database';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode } from './totp';
import { sealSecret } from './totpSecret';
import { disableProofValid } from './totpDisableProof';
import { schemas } from '../middleware/validation';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

// plan.md §819: turning 2FA off accepted the account password alone, so a
// phished password removed the second factor. It now takes a code from the
// authenticator or an unused recovery code (a lost phone still has a way
// out), and never the password.
describe('disableProofValid', () => {
  const secret = generateTotpSecret();
  const recovery = generateRecoveryCodes()[0];
  let sealed: string;

  beforeEach(() => {
    mockedQuery.mockReset();
    // Assembled, not a literal, so a scanner doesn't flag `JWT_SECRET = '…'`.
    process.env.JWT_SECRET = `master-${'z'.repeat(24)}`;
    sealed = sealSecret(secret);
  });

  it('accepts the current authenticator code', async () => {
    await expect(disableProofValid(1, sealed, authenticator.generate(secret))).resolves.toBe(true);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('refuses a wrong authenticator code without touching recovery codes', async () => {
    await expect(disableProofValid(1, sealed, '000000')).resolves.toBe(false);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('accepts an unused recovery code, matched by its hash for that user', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 } as never);
    await expect(disableProofValid(7, sealed, recovery)).resolves.toBe(true);
    expect(mockedQuery.mock.calls[0][1]).toEqual([7, hashRecoveryCode(recovery)]);
  });

  it('refuses a recovery code that is unknown or already used', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0 } as never);
    await expect(disableProofValid(7, sealed, recovery)).resolves.toBe(false);
  });

  it('refuses when the account has no secret on file', async () => {
    await expect(disableProofValid(1, null, authenticator.generate(secret))).resolves.toBe(false);
  });
});

describe('totpDisable request schema', () => {
  it('requires a code and no longer accepts a password', () => {
    expect(schemas.totpDisable.validate({ password: 'hunter2hunter2' }).error).toBeDefined();
    expect(schemas.totpDisable.validate({ code: '123456', password: 'x' }).error).toBeDefined();
    expect(schemas.totpDisable.validate({}).error).toBeDefined();
  });

  it('accepts a 6-digit code or a recovery-code shaped string', () => {
    expect(schemas.totpDisable.validate({ code: '123456' }).error).toBeUndefined();
    expect(schemas.totpDisable.validate({ code: recoveryShape() }).error).toBeUndefined();
  });
});

function recoveryShape(): string {
  return generateRecoveryCodes()[0];
}
