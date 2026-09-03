import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | undefined;

function getConnectionString(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.POSTGRES_HOST || 'database';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'homelab';
  const password = process.env.POSTGRES_PASSWORD || '';
  const dbName = process.env.POSTGRES_DB || 'homelab';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getConnectionString(),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Run a parameterised query and return the pg Result object.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside a single transaction on one pooled client: BEGIN, then
 * COMMIT if it resolves, ROLLBACK if it throws. Use when a handful of writes
 * have to land together — e.g. enabling TOTP and inserting its recovery codes.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Bring the `user_roles` join table into being (plan.md §149) and make sure
 * every existing account has a role. Roles were removed once (`51387f0`) and
 * are back, wired to capability gates this time.
 *
 * - Creates `user_roles` if absent.
 * - Drops the long-dead `users.role` text column if a very old database still
 *   carries it (its values were never enforced; the join table replaces it).
 * - Backfills `webmaster` for any account with no roles yet — that is every
 *   account on an upgrading database (they were all admins, `51387f0`), and
 *   also the first admin created by `/setup` before this migration ran on a
 *   subsequent boot. `webmaster` is the §152 superuser role.
 */
export async function ensureUserRolesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role    VARCHAR(20) NOT NULL,
        PRIMARY KEY (user_id, role)
    )
  `);
  await query('ALTER TABLE users DROP COLUMN IF EXISTS role');
  await query(`
    INSERT INTO user_roles (user_id, role)
    SELECT u.id, 'webmaster'
    FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id)
  `);
}

/**
 * Reshape the role model to webmaster / admin / user (plan.md §152). Runs
 * after `ensureUserRolesTable()`.
 *
 * `owner` was the superuser and becomes `webmaster` (every capability, always,
 * never narrowed per account). `it_admin` becomes `admin`, whose dashboard
 * features are per-account grant rows in the new `user_capabilities` table —
 * so before the rename, every `it_admin` account is seeded with exactly the
 * six capabilities that role used to grant, rather than being widened to the
 * "no rows = all-on" default an admin otherwise gets.
 *
 * Idempotent: the rename matches nothing on a second run, and the seed is
 * guarded by `ON CONFLICT DO NOTHING`.
 */
export async function ensureRoleModelReshape(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS user_capabilities (
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        capability VARCHAR(40) NOT NULL,
        PRIMARY KEY (user_id, capability)
    )
  `);

  // Freeze each legacy it_admin's reach before the rename widens the role.
  await query(`
    INSERT INTO user_capabilities (user_id, capability)
    SELECT r.user_id, c.capability
    FROM user_roles r
    CROSS JOIN (VALUES
      ('apps:control'), ('apps:config'), ('apps:expose'),
      ('backups:manage'), ('settings:manage'), ('audit:view')
    ) AS c(capability)
    WHERE r.role = 'it_admin'
    ON CONFLICT DO NOTHING
  `);

  // Rename: insert the new-name row (absorbed if a user already holds it),
  // then drop the old-name rows. Avoids a PK collision an UPDATE would hit for
  // a user holding both an old and a new name.
  await query(`
    INSERT INTO user_roles (user_id, role)
    SELECT user_id, 'webmaster' FROM user_roles WHERE role = 'owner'
    ON CONFLICT DO NOTHING
  `);
  await query(`
    INSERT INTO user_roles (user_id, role)
    SELECT user_id, 'admin' FROM user_roles WHERE role = 'it_admin'
    ON CONFLICT DO NOTHING
  `);
  await query(`DELETE FROM user_roles WHERE role IN ('owner', 'it_admin')`);
}

/**
 * Add `users.email` and the `user_app_access` allowlist table (plan.md §151).
 * `email` is nullable — existing accounts keep NULL until edited; the users
 * API requires it on create. `user_app_access` holds which managed apps an
 * account may reach through Authelia SSO; a row per (user, service). No rows
 * means no SSO app access (an explicit allowlist). No-op on a fresh install —
 * init.sql already has both.
 */
export async function ensureUserAppAccessSchema(): Promise<void> {
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)');
  await query(`
    CREATE TABLE IF NOT EXISTS user_app_access (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service_name VARCHAR(100) NOT NULL,
        PRIMARY KEY (user_id, service_name)
    )
  `);
}

/**
 * Invite-based user creation (plan.md §158): a dashboard-created account has
 * no password until the invitee follows an emailed link, so `password_hash`
 * becomes nullable, and `user_invitations` holds the single-use, expiring
 * token (SHA-256 hash only, like `totp_recovery_codes`). No-op on a fresh
 * install — init.sql already matches.
 */
export async function ensureUserInvitationsSchema(): Promise<void> {
  await query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  await query(`
    CREATE TABLE IF NOT EXISTS user_invitations (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    'CREATE INDEX IF NOT EXISTS user_invitations_token_hash_idx ON user_invitations (token_hash)'
  );
}

/**
 * Add the TOTP columns to `users` and create `totp_recovery_codes` on
 * databases that predate the second-factor feature (plan.md §127). No-op on
 * fresh installs — init.sql already has both.
 */
export async function ensureTotpSchema(): Promise<void> {
  await query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS totp_secret TEXT,
      ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS totp_enrolled_at TIMESTAMPTZ
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS totp_recovery_codes (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT NOT NULL,
        used_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query('CREATE INDEX IF NOT EXISTS totp_recovery_codes_user_id_idx ON totp_recovery_codes (user_id)');
}

/**
 * Create the `service_exposure` table on databases created before first-start
 * exposure provisioning was added. No-op on fresh installs, since init.sql
 * already creates it.
 */
export async function ensureServiceExposureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS service_exposure (
        service_name    VARCHAR(100) PRIMARY KEY,
        enabled         BOOLEAN NOT NULL DEFAULT FALSE,
        hostname        VARCHAR(255),
        upstream_scheme VARCHAR(10) NOT NULL DEFAULT 'http',
        upstream_host   VARCHAR(255),
        upstream_port   INTEGER,
        websocket       BOOLEAN NOT NULL DEFAULT FALSE,
        npm_host_id     INTEGER,
        cf_hostname_id  TEXT,
        status          VARCHAR(50) NOT NULL DEFAULT 'not_provisioned',
        last_error      TEXT,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Add the `authelia_protected` column to `service_exposure` on databases
 * created before Authelia forward-auth support was added. No-op on fresh
 * installs, since init.sql already creates it.
 */
export async function ensureServiceExposureAutheliaColumn(): Promise<void> {
  await query(`
    ALTER TABLE service_exposure
    ADD COLUMN IF NOT EXISTS authelia_protected BOOLEAN NOT NULL DEFAULT FALSE
  `);
}
