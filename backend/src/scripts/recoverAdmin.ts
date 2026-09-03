/**
 * Offline admin recovery — run *inside* the backend container by
 * `./start.sh recover` (plan.md §105, §126).
 *
 * The HTTP `/api/recovery/*` endpoints gate on `req.ip` being loopback, an
 * address the backend never sees from inside its container (a host `curl`
 * arrives from the Docker bridge gateway), so on a real headless deployment
 * they always 403. This script is the sanctioned path instead: `start.sh`
 * runs it in the container as the tool, so there is no `docker exec` runbook
 * step for a human to type.
 *
 * It is never imported by the HTTP server. It reuses the same `DATABASE_URL`
 * the app runs with.
 *
 *   node dist/scripts/recoverAdmin.js list
 *   RECOVER_USERNAME=admin RECOVER_PASSWORD=… node dist/scripts/recoverAdmin.js reset-password
 *   RECOVER_USERNAME=admin RECOVER_PASSWORD=… node dist/scripts/recoverAdmin.js create-admin
 *
 * The password is read from the environment, never argv, so it does not land
 * in the container's process list. `./start.sh recover` prompts for it
 * (hidden, with confirmation) and passes it through.
 */
import { getPool, query } from '../utils/database';
import { hashPassword } from '../utils/password';
import { writeAuditLog } from '../utils/audit';
import { syncAutheliaUsers } from '../services/autheliaSync';

/** Best-effort: keep Authelia's copy of the account in step after a recovery write. */
async function syncAutheliaQuietly(trigger: string): Promise<void> {
  try {
    const result = await syncAutheliaUsers(trigger);
    if (result.synced) {
      console.log(`Authelia users_database.yml updated (${result.count} user(s)).`);
    }
  } catch (err) {
    console.warn(`Could not update Authelia (${(err as Error).message}); fix it from the dashboard once you're in.`);
  }
}

// Mirrors passwordSchema in middleware/validation.ts — kept in step by hand so
// a recovery reset can't set a password the normal login flow would reject.
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;

interface Credentials {
  username: string;
  password: string;
}

/**
 * Pull and validate the username/password for a write command from the
 * environment. Pure and exported so the rules have a test without a database.
 */
export function parseCredentials(env: NodeJS.ProcessEnv): Credentials {
  const username = parseUsername(env);
  const password = env.RECOVER_PASSWORD ?? '';

  if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
    throw new Error(`Password must be ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} characters.`);
  }
  return { username, password };
}

/** Just the username, for commands that take no password (e.g. disable-2fa). */
export function parseUsername(env: NodeJS.ProcessEnv): string {
  const username = (env.RECOVER_USERNAME ?? '').trim();
  if (!username) {
    throw new Error('RECOVER_USERNAME is empty — run this through `./start.sh recover`, which prompts for it.');
  }
  return username;
}

interface UserRow {
  id: number;
  username: string;
  is_setup_complete: boolean;
  created_at: Date;
}

async function listUsers(): Promise<void> {
  const { rows } = await query<UserRow>(
    'SELECT id, username, is_setup_complete, created_at FROM users ORDER BY id'
  );
  if (rows.length === 0) {
    console.log('No users exist yet. Use "create-admin", or open /setup in the dashboard.');
    return;
  }
  console.log('id   setup   created (UTC)         username');
  for (const u of rows) {
    const id = String(u.id).padEnd(4);
    const setup = (u.is_setup_complete ? 'yes' : 'no').padEnd(7);
    const created = new Date(u.created_at).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`${id} ${setup} ${created}  ${u.username}`);
  }
}

async function resetPassword(): Promise<void> {
  const { username, password } = parseCredentials(process.env);
  const passwordHash = await hashPassword(password);

  const { rows } = await query<{ id: number }>(
    'UPDATE users SET password_hash = $2 WHERE username = $1 RETURNING id',
    [username, passwordHash]
  );
  if (rows.length === 0) {
    throw new Error(`No user named "${username}". Run "list" to see which usernames exist.`);
  }
  const userId = rows[0].id;

  // Recovery has to restore *control*, not just access: make sure the account
  // is a webmaster so a role mistake (demoting the last webmaster) is fixable
  // the same way as a lost password (plan.md §149, §152).
  await query(
    "INSERT INTO user_roles (user_id, role) VALUES ($1, 'webmaster') ON CONFLICT DO NOTHING",
    [userId]
  );

  // A password reset is also the answer to a suspected compromise, so drop
  // every outstanding session for the account rather than leaving stolen
  // refresh tokens live.
  const revoked = await query(
    'UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
    [userId]
  );

  await writeAuditLog({
    userId,
    action: 'recovery_reset_password',
    resource: 'users',
    metadata: { username, via: 'start.sh recover', refreshTokensRevoked: revoked.rowCount ?? 0 },
  });

  await syncAutheliaQuietly('recovery_reset_password');

  console.log(`Reset the password for "${username}" (id ${userId}); revoked ${revoked.rowCount ?? 0} active session(s).`);
  console.log('Log in at the dashboard with the new password now.');
}

async function createAdmin(): Promise<void> {
  const { username, password } = parseCredentials(process.env);

  const existing = await query<{ id: number }>('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length > 0) {
    throw new Error(`User "${username}" already exists — use "reset-password" instead.`);
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query<{ id: number }>(
    'INSERT INTO users (username, password_hash, is_setup_complete) VALUES ($1, $2, TRUE) RETURNING id',
    [username, passwordHash]
  );
  await query("INSERT INTO user_roles (user_id, role) VALUES ($1, 'webmaster') ON CONFLICT DO NOTHING", [
    rows[0].id,
  ]);

  await writeAuditLog({
    userId: rows[0].id,
    action: 'recovery_create_admin',
    resource: 'users',
    metadata: { username, via: 'start.sh recover' },
  });

  await syncAutheliaQuietly('recovery_create_admin');

  console.log(`Created admin "${username}" (id ${rows[0].id}). Log in at the dashboard.`);
}

async function disableTotp(): Promise<void> {
  const username = parseUsername(process.env);

  const { rows } = await query<{ id: number; totp_enabled: boolean }>(
    'SELECT id, totp_enabled FROM users WHERE username = $1',
    [username]
  );
  if (rows.length === 0) {
    throw new Error(`No user named "${username}". Run "list" to see which usernames exist.`);
  }
  const { id: userId, totp_enabled } = rows[0];

  await query(
    'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_enrolled_at = NULL WHERE id = $1',
    [userId]
  );
  await query('DELETE FROM totp_recovery_codes WHERE user_id = $1', [userId]);

  await writeAuditLog({
    userId,
    action: 'recovery_disable_2fa',
    resource: 'users',
    metadata: { username, via: 'start.sh recover', wasEnabled: totp_enabled },
  });

  console.log(
    totp_enabled
      ? `Disabled two-factor authentication for "${username}" (id ${userId}). They can log in with just their password now.`
      : `Two-factor was not enabled for "${username}"; cleared any leftover enrolment state anyway.`
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'list':
      await listUsers();
      break;
    case 'reset-password':
      await resetPassword();
      break;
    case 'create-admin':
      await createAdmin();
      break;
    case 'disable-2fa':
      await disableTotp();
      break;
    default:
      console.error('Usage: recoverAdmin.js <list | reset-password | create-admin | disable-2fa>');
      console.error('  reset-password / create-admin take RECOVER_USERNAME and RECOVER_PASSWORD from the environment.');
      console.error('  disable-2fa takes RECOVER_USERNAME only.');
      process.exitCode = 1;
  }
}

// `require`d only by the test, which stubs argv/env and calls the helpers
// directly; running the file executes main().
if (require.main === module) {
  main()
    .catch((err: unknown) => {
      console.error(`recover: ${(err as Error).message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      void getPool().end();
    });
}
