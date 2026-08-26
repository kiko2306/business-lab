import { Pool, QueryResult, QueryResultRow } from 'pg';

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
 * Drop the legacy `role` column from `users` on databases created before
 * roles were removed from the project. No-op on fresh installs, since
 * init.sql no longer creates that column.
 */
export async function dropLegacyRoleColumn(): Promise<void> {
  await query('ALTER TABLE users DROP COLUMN IF EXISTS role');
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
