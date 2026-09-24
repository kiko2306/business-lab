import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Pool } from 'pg';
import { migrate, migrationFiles } from './migrate';

test('migrationFiles takes .sql only, in filename order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-mig-'));
  for (const f of ['010_b.sql', '002_a.sql', 'notes.md', '001_init.sql']) {
    fs.writeFileSync(path.join(dir, f), '');
  }
  // Zero-padded prefixes are what make lexical order the intended order — an
  // unpadded "10_" would sort before "2_".
  assert.deepEqual(migrationFiles(dir), ['001_init.sql', '002_a.sql', '010_b.sql']);
});

// The schema is this slice's actual deliverable, so the check that matters is
// that it applies to a real Postgres — not that the file exists. Skipped when
// no database is wired up, so `npm test` still runs standalone.
test('001_init.sql applies and creates the expected schema', { skip: !process.env.DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(pool, path.join(__dirname, 'migrations'));
    // Applied twice on purpose: every boot re-runs every file, so a statement
    // that is not idempotent breaks the second start, not the first.
    await migrate(pool, path.join(__dirname, 'migrations'));

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`
    );
    assert.deepEqual(
      tables.rows.map((r) => r.table_name),
      ['agents', 'enrolment_codes', 'smtp_settings', 'store_access', 'stores']
    );

    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'enrolment_codes' AND indexname = 'enrolment_codes_unused_expiry_idx'`
    );
    assert.equal(idx.rowCount, 1, 'partial index on unused enrolment codes is missing');

    // A store's id must be unguessable: it is the identifier an agent and the
    // UI address a shop by, and §628 makes random ids a correctness
    // requirement after the legacy used uuid v1 (timestamp + MAC).
    const { rows } = await pool.query(
      `INSERT INTO stores (name) VALUES ('probe') RETURNING id`
    );
    assert.match(rows[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // One agent per store.
    await pool.query(`INSERT INTO agents (store_id, token_hash) VALUES ($1, 'h1')`, [rows[0].id]);
    await assert.rejects(
      pool.query(`INSERT INTO agents (store_id, token_hash) VALUES ($1, 'h2')`, [rows[0].id]),
      /duplicate key/
    );

    // Removing a store takes its access grants and agent with it.
    await pool.query(`DELETE FROM stores WHERE id = $1`, [rows[0].id]);
    const orphans = await pool.query(`SELECT count(*)::int AS n FROM agents WHERE store_id = $1`, [rows[0].id]);
    assert.equal(orphans.rows[0].n, 0);
  } finally {
    await pool.end();
  }
});
