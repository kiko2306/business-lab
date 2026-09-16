/**
 * Create/update an ITFlow technician account for a dashboard user, matching
 * their own email/password rather than a per-app generated secret (§480 —
 * the user's explicit choice, accepting that the credential then also
 * lives, hashed, in ITFlow's own database).
 *
 * ITFlow's own `users` table has no unique constraint on `user_email` and
 * `admin/post/users.php`'s `add_user` handler never checks for a
 * duplicate, so — unlike DocuSeal/NocoDB, which both 422/400 on a repeat
 * email — this has to look an existing account up itself before deciding
 * create vs. update. That lookup is a plain read (`itflowDb.ts`, the same
 * PHP-through-the-container approach `itflowAdminBootstrap.ts` already
 * uses for the admin's own identity/password sync); the write itself has
 * to go through `itflowClient.ts`'s real login + form flow, signed in as
 * the ITFlow admin, because `encryptUserSpecificKey()` (ITFlow's own
 * per-user wrap of its site-wide credential-encryption master key) reads
 * `$_SESSION`/`$_COOKIE` values only a live login sets — the same
 * session-only capability `itflowAdminBootstrap.ts`'s `reconcileAdminPassword`
 * found no cold-script equivalent for.
 *
 * Every fanned-out user gets ITFlow's built-in "Technician" role
 * (role_id 2) — `setup/seed_data.php` seeds Accountant/Technician/
 * Administrator at fixed ids 1/2/3 on every install, so this is stable
 * across installs without a lookup. Not Administrator: that would hand
 * every dashboard user with ITFlow access full admin rights in it, a
 * bigger grant than "give them a working login" calls for.
 */

import logger from '../utils/logger';
import { readAppEnvValue } from './appEnv';
import { getAutheliaAdminUser } from './autheliaUsers';
import { ITFLOW_ADMIN_PASSWORD_KEY, ITFLOW_SERVICE, resolveItflowBaseUrl } from './itflowAdminBootstrap';
import { addUser, signIn, updateUserPassword } from './itflowClient';
import { runItflowDbScript } from './itflowDb';

// setup/seed_data.php - fixed on every install, never re-created.
const TECHNICIAN_ROLE_ID = 2;

export type ProvisionItflowUserResult =
  | 'created'
  | 'updated'
  | 'already-exists'
  | 'failed'
  | 'admin-not-configured'
  | 'admin-sign-in-failed';

export interface ItflowUserInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * `SELECT user_id FROM users WHERE user_email = ? AND user_archived_at IS
 * NULL`, prepared statement, through ITFlow's own container — a plain read,
 * no session/encryption concerns. Returns null on no match or any failure
 * (a failed lookup falls through to `addUser`, which is the safe default:
 * worst case a duplicate row, not a silently skipped grant).
 */
async function findItflowUserId(email: string): Promise<number | null> {
  const script = [
    "$email = getenv('ITFLOW_FANOUT_LOOKUP_EMAIL');",
    '$stmt = $mysqli->prepare("SELECT user_id FROM users WHERE user_email = ? AND user_archived_at IS NULL LIMIT 1");',
    '$stmt->bind_param("s", $email);',
    '$stmt->execute();',
    '$stmt->bind_result($user_id);',
    'if ($stmt->fetch()) { echo "FOUND\\n$user_id"; } else { echo "NOT_FOUND"; }',
  ];
  const result = await runItflowDbScript(script, {
    env: { ...process.env, ITFLOW_FANOUT_LOOKUP_EMAIL: email },
    passEnv: ['ITFLOW_FANOUT_LOOKUP_EMAIL'],
  });
  if (!result.ok) return null;
  const lines = result.output.trim().split('\n');
  if (lines[0] !== 'FOUND') return null;
  const userId = Number.parseInt(lines[1] ?? '', 10);
  return Number.isFinite(userId) ? userId : null;
}

export async function provisionItflowUser(input: ItflowUserInput): Promise<ProvisionItflowUserResult> {
  const adminEmail = getAutheliaAdminUser()?.email?.trim();
  const adminPassword = readAppEnvValue(ITFLOW_SERVICE, ITFLOW_ADMIN_PASSWORD_KEY);
  if (!adminEmail || !adminPassword) {
    logger.warn('ITFlow user provisioning skipped: no admin account tracked yet');
    return 'admin-not-configured';
  }

  const baseUrl = await resolveItflowBaseUrl();
  const signInResult = await signIn(baseUrl, adminEmail, adminPassword);
  if (signInResult.state !== 'signed-in') {
    logger.warn(`ITFlow user provisioning skipped: could not sign in as ${adminEmail}`);
    return 'admin-sign-in-failed';
  }

  const name = input.displayName?.trim() || input.email;
  const existingUserId = await findItflowUserId(input.email);

  if (existingUserId !== null) {
    const result = await updateUserPassword(baseUrl, {
      cookie: signInResult.cookie,
      userId: existingUserId,
      name,
      email: input.email,
      roleId: TECHNICIAN_ROLE_ID,
      newPassword: input.password,
    });
    if (result === 'updated') {
      logger.info(`Updated the existing ITFlow account's password for ${input.email}`);
      return 'updated';
    }
    logger.warn(`ITFlow already has an account for ${input.email} but its password could not be updated`);
    return 'already-exists';
  }

  const result = await addUser(baseUrl, {
    cookie: signInResult.cookie,
    name,
    email: input.email,
    password: input.password,
    roleId: TECHNICIAN_ROLE_ID,
  });
  if (result === 'created') {
    logger.info(`Created an ITFlow account for ${input.email}`);
    return 'created';
  }
  logger.error(`ITFlow user provisioning failed for ${input.email}`);
  return 'failed';
}
