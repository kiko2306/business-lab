/**
 * Create/update a Kimai account for a dashboard user, matching their own
 * email/password rather than a per-app generated secret (§480 fan-out).
 *
 * Kimai's own REST API can create a user (`POST /api/users`, plaintext
 * password accepted) but its edit endpoint (`PATCH /api/users/{id}`) can
 * never change a password — `UserApiEditForm` (Kimai's own
 * `src/Form/API/UserApiEditForm.php`) never re-adds a `plainPassword`
 * field the way the create form does. The only place that can change an
 * existing user's password is the web `/profile/{username}/password`
 * form, which needs a live signed-in session and a scraped CSRF token —
 * the same shape ITFlow's whole write path needed. Rather than build two
 * auth mechanisms side by side (a stored API token for create/disable, a
 * scraped session for password-set), this writes Kimai's `kimai2_users`
 * table directly through a cold PHP script (`kimaiDb.ts`, no live
 * session): `security:hash-password` (checked live against the running
 * container, Kimai 2.66) confirmed the password column is a plain
 * `password_hash()`/`password_verify()` bcrypt string with no per-session
 * wrapping — unlike ITFlow's `encryptUserSpecificKey()`, nothing here needs
 * a live login to write correctly. `INSERT ... ON DUPLICATE KEY UPDATE` on
 * the unique `email` column makes create and password-refresh-on-regrant
 * the same single statement, so there's no separate lookup step either.
 *
 * Every fanned-out user gets Kimai's `ROLE_USER` (`User::DEFAULT_ROLE`) —
 * not `ROLE_SUPER_ADMIN` — same reasoning as ITFlow's Technician role
 * (§480): a working login, not a bigger grant than that. `username` is set
 * to the email address: Kimai's own login accepts either
 * (`UserRepository::loadUserByIdentifier` matches `username` OR `email`),
 * so there's no separate username to pick or collide on.
 *
 * `disableKimaiUser` (matching §493's disable-not-delete shape for the
 * other no-SSO apps) flips `enabled = 0` — Kimai's `UserChecker` rejects a
 * disabled account at login, and re-granting access flips it back via the
 * same upsert.
 */

import logger from '../utils/logger';
import { runKimaiDbScript } from './kimaiDb';

// User::DEFAULT_ROLE / User::ROLE_USER — stable across installs, not looked up.
const KIMAI_ROLE = 'ROLE_USER';

export interface KimaiUserInput {
  email: string;
  password: string;
  displayName?: string;
}

export type ProvisionKimaiUserResult = 'created' | 'updated' | 'failed';

// Types::ARRAY (kimai2_users.roles) is Doctrine's legacy PHP-serialize column
// type, confirmed live against the running admin row — not JSON, not CSV.
const CREATE_OR_UPDATE_SCRIPT = [
  "$email = getenv('KIMAI_FANOUT_EMAIL');",
  "$password = getenv('KIMAI_FANOUT_PASSWORD');",
  "$alias = getenv('KIMAI_FANOUT_DISPLAY_NAME') ?: null;",
  "$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 13]);",
  `$roles = serialize(['${KIMAI_ROLE}']);`,
  '$stmt = $pdo->prepare(' +
    "'INSERT INTO kimai2_users (username, email, password, alias, roles, enabled, auth, registration_date) " +
    "VALUES (:username, :email, :hash, :alias, :roles, 1, :auth, NOW()) " +
    "ON DUPLICATE KEY UPDATE password = :hash2, alias = :alias2, enabled = 1'" +
    ');',
  '$stmt->execute([',
  "  ':username' => $email,",
  "  ':email' => $email,",
  "  ':hash' => $hash,",
  "  ':alias' => $alias,",
  "  ':roles' => $roles,",
  "  ':auth' => 'kimai',",
  "  ':hash2' => $hash,",
  "  ':alias2' => $alias,",
  ']);',
  "echo $stmt->rowCount() === 1 ? 'CREATED' : 'UPDATED';",
];

export async function provisionKimaiUser(input: KimaiUserInput): Promise<ProvisionKimaiUserResult> {
  const result = await runKimaiDbScript(CREATE_OR_UPDATE_SCRIPT, {
    env: {
      ...process.env,
      KIMAI_FANOUT_EMAIL: input.email,
      KIMAI_FANOUT_PASSWORD: input.password,
      KIMAI_FANOUT_DISPLAY_NAME: input.displayName ?? '',
    },
    passEnv: ['KIMAI_FANOUT_EMAIL', 'KIMAI_FANOUT_PASSWORD', 'KIMAI_FANOUT_DISPLAY_NAME'],
  });
  if (result.ok && result.output.includes('CREATED')) {
    logger.info(`Created a Kimai account for ${input.email}`);
    return 'created';
  }
  if (result.ok && result.output.includes('UPDATED')) {
    logger.info(`Updated the existing Kimai account's password for ${input.email}`);
    return 'updated';
  }
  logger.error(`Kimai user provisioning failed for ${input.email}`, { error: result.output });
  return 'failed';
}

export type DisableKimaiUserResult = 'disabled' | 'not-found' | 'failed';

const DISABLE_SCRIPT = [
  "$email = getenv('KIMAI_FANOUT_EMAIL');",
  "$stmt = $pdo->prepare('UPDATE kimai2_users SET enabled = 0 WHERE email = :email');",
  "$stmt->execute([':email' => $email]);",
  "$check = $pdo->prepare('SELECT id FROM kimai2_users WHERE email = :email');",
  "$check->execute([':email' => $email]);",
  "echo $check->fetch() ? 'DISABLED' : 'NOT_FOUND';",
];

export async function disableKimaiUser(email: string): Promise<DisableKimaiUserResult> {
  const result = await runKimaiDbScript(DISABLE_SCRIPT, {
    env: { ...process.env, KIMAI_FANOUT_EMAIL: email },
    passEnv: ['KIMAI_FANOUT_EMAIL'],
  });
  if (result.ok && result.output.includes('DISABLED')) {
    logger.info(`Disabled the Kimai account for ${email}`);
    return 'disabled';
  }
  if (result.ok && result.output.includes('NOT_FOUND')) {
    logger.warn(`No Kimai account found for ${email} to disable`);
    return 'not-found';
  }
  logger.error(`Kimai user disable failed for ${email}`, { error: result.output });
  return 'failed';
}
