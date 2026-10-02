import { query } from './database';
import { hashRecoveryCode, verifyTotp } from './totp';
import { openSecret } from './totpSecret';

/**
 * Proof needed to turn 2FA off: a current authenticator code, or an unused
 * recovery code so a lost phone still has a way out. Never the account
 * password — that is the first factor, and a phished one would remove the
 * second (plan.md §819). The recovery code is only checked, not spent: the
 * caller deletes every recovery code in the same breath.
 */
export async function disableProofValid(userId: number, totpSecret: string | null, code: string): Promise<boolean> {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    return Boolean(totpSecret && verifyTotp(trimmed, openSecret(totpSecret)));
  }
  const found = await query(
    'SELECT 1 FROM totp_recovery_codes WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
    [userId, hashRecoveryCode(trimmed)]
  );
  return (found.rowCount ?? 0) === 1;
}
