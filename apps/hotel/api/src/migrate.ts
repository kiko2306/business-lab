import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

/**
 * Applies every `.sql` file in `migrations/`, in filename order.
 *
 * Each file is written to be idempotent (`CREATE TABLE IF NOT EXISTS` and
 * friends), so re-running them on every boot is a no-op once the schema is
 * current. Each file runs inside a transaction, so a half-applied file cannot
 * leave the schema in a state the next boot has to reason about.
 *
 * ponytail: no schema_migrations table — with one file, tracking which have
 * run is bookkeeping for a question that cannot yet be asked. Add one when the
 * second migration lands, since a destructive change (a DROP, a column
 * rename, a backfill) cannot be written idempotently and does need to run
 * exactly once.
 */
export function migrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export async function migrate(pool: Pool, dir: string): Promise<string[]> {
  const files = migrationFiles(dir);
  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return files;
}
