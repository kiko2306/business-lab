import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import path from 'path';
import { Pool } from 'pg';
import { createApp } from './app';
import { migrate } from './migrate';

// NOTE: shares one database with any sibling suite and truncates between
// tests, so package.json runs the files serially (--test-concurrency=1).
// In parallel they delete each other's rows and fail like logic bugs.
const skip = !process.env.DATABASE_URL;

let pool: Pool;
let server: Server;
let base: string;

const ADMIN = { 'Remote-User': 'alice', 'Remote-Groups': 'admins' };
const VIEWER = { 'Remote-User': 'bob', 'Remote-Groups': 'app-hotel' };

async function call(
  method: string,
  p: string,
  opts: { headers?: Record<string, string>; body?: unknown; token?: string } = {}
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${p}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Units come from Wintouch, so tests seed them the way the sync will. */
async function seedUnit(code: string, name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO units (code, name) VALUES ($1, $2) RETURNING id`,
    [code, name]
  );
  return rows[0].id;
}

before(async () => {
  if (skip) return;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool, path.join(__dirname, 'migrations'));
  server = createApp(pool).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (skip) return;
  await new Promise((r) => server.close(r));
  await pool.end();
});

beforeEach(async () => {
  if (skip) return;
  await pool.query('DELETE FROM units');
  await pool.query('DELETE FROM agents');
  await pool.query('DELETE FROM enrolment_codes');
});

test('the schema applies, twice, and creates what is expected', { skip }, async () => {
  // Every boot re-runs every file, so a non-idempotent statement breaks the
  // second start rather than the first.
  await migrate(pool, path.join(__dirname, 'migrations'));
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`
  );
  assert.deepEqual(tables.rows.map((r) => r.table_name), [
    'agents',
    'enrolment_codes',
    'guest_extras',
    'guests',
    'reservations',
    'unit_access',
    'units',
  ]);
});

test('the scheduler indexes exist and are partial (§626)', { skip }, async () => {
  // Both schedulers run every minute and the legacy had no index for either.
  const { rows } = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'reservations' AND indexname LIKE '%_due_idx' ORDER BY indexname`
  );
  assert.deepEqual(rows.map((r) => r.indexname), [
    'reservations_checkin_due_idx',
    'reservations_quiz_due_idx',
  ]);
  // Partial, or they would index the whole table as a season accumulates.
  for (const row of rows) assert.match(row.indexdef, /WHERE /);
});

test('a reservation token is a random v4, not a guessable id (§628)', { skip }, async () => {
  const unitId = await seedUnit('A', 'Alpha');
  const { rows } = await pool.query(
    `INSERT INTO reservations (unit_id, number, line, checkin_on, checkout_on, status)
     VALUES ($1, '1', 1, '2026-01-01', '2026-01-03', 'RESERVED') RETURNING token`,
    [unitId]
  );
  assert.match(rows[0].token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('one reservation row carries both flows, which is why they share a database', { skip }, async () => {
  // §628 found this in the legacy schema and it is the reason hotel-core exists.
  const unitId = await seedUnit('A', 'Alpha');
  const { rows } = await pool.query(
    `INSERT INTO reservations (unit_id, number, line, checkin_on, checkout_on, status)
     VALUES ($1, '1', 1, '2026-01-01', '2026-01-03', 'RESERVED')
     RETURNING checkin_sent, checkin_success, quiz_sent, quiz_answered`,
    [unitId]
  );
  assert.deepEqual(rows[0], {
    checkin_sent: false,
    checkin_success: false,
    quiz_sent: false,
    quiz_answered: false,
  });
  // (unit, number, line) is how Wintouch identifies a reservation.
  await assert.rejects(
    pool.query(
      `INSERT INTO reservations (unit_id, number, line, checkin_on, checkout_on, status)
       VALUES ($1, '1', 1, '2026-02-01', '2026-02-03', 'RESERVED')`,
      [unitId]
    ),
    /duplicate key/
  );
});

test('unauthenticated callers get nothing, and viewers cannot administer', { skip }, async () => {
  const unitId = await seedUnit('A', 'Alpha');
  assert.equal((await call('GET', '/api/units')).status, 401);
  assert.equal((await call('PATCH', `/api/units/${unitId}`, { headers: VIEWER, body: { checkinActive: true } })).status, 403);
  // A viewer who could mint a code could enrol an agent of their own.
  assert.equal((await call('POST', '/api/agent/enrolment-code', { headers: VIEWER })).status, 403);
});

test('/api/me distinguishes admin from viewer', { skip }, async () => {
  assert.deepEqual((await call('GET', '/api/me', { headers: ADMIN })).body, { user: 'alice', isAdmin: true });
  assert.deepEqual((await call('GET', '/api/me', { headers: VIEWER })).body, { user: 'bob', isAdmin: false });
});

test('a viewer sees only granted, active units', { skip }, async () => {
  const granted = await seedUnit('A', 'Granted');
  await seedUnit('B', 'Not granted');
  const hidden = await seedUnit('C', 'Granted but off');
  await call('PUT', `/api/units/${granted}/access/bob`, { headers: ADMIN });
  await call('PUT', `/api/units/${hidden}/access/bob`, { headers: ADMIN });
  await call('PATCH', `/api/units/${hidden}`, { headers: ADMIN, body: { isActive: false } });

  const mine = await call('GET', '/api/units', { headers: VIEWER });
  assert.deepEqual(mine.body.map((u: { name: string }) => u.name), ['Granted']);
  // An admin still sees the inactive one, or it could never be turned back on.
  assert.equal((await call('GET', '/api/units', { headers: ADMIN })).body.length, 3);
});

test('each of the four guest flows switches independently', { skip }, async () => {
  // Four, not two: birthday and promo are in scope (§629).
  const unitId = await seedUnit('A', 'Alpha');
  const updated = await call('PATCH', `/api/units/${unitId}`, {
    headers: ADMIN,
    body: { checkinActive: true, promoActive: true },
  });
  assert.equal(updated.body.checkinActive, true);
  assert.equal(updated.body.promoActive, true);
  // Untouched flags stay put rather than being nulled by a partial update.
  assert.equal(updated.body.quizActive, false);
  assert.equal(updated.body.birthdayActive, false);
  assert.equal(updated.body.isActive, true);
});

test('an agent enrols, learns its units, and is revoked', { skip }, async () => {
  await seedUnit('A', 'Alpha');
  const inactive = await seedUnit('B', 'Beta');
  await call('PATCH', `/api/units/${inactive}`, { headers: ADMIN, body: { isActive: false } });

  const issued = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  assert.equal(issued.status, 201);
  const enrolled = await call('POST', '/agent/enrol', { body: { code: issued.body.code } });
  assert.equal(enrolled.status, 201);

  // The agent is told which properties exist rather than configured with them.
  const units = await call('GET', '/agent/units', { token: enrolled.body.token });
  assert.deepEqual(units.body.map((u: { code: string }) => u.code), ['A']);

  assert.equal((await call('DELETE', '/api/agent', { headers: ADMIN })).status, 204);
  assert.equal((await call('GET', '/agent/units', { token: enrolled.body.token })).status, 401);
  assert.equal((await call('DELETE', '/api/agent', { headers: ADMIN })).status, 404);
});

test('a code works once, and re-enrolling replaces the previous agent', { skip }, async () => {
  const first = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  const a1 = await call('POST', '/agent/enrol', { body: { code: first.body.code } });
  assert.equal((await call('POST', '/agent/enrol', { body: { code: first.body.code } })).status, 401);

  const second = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  const a2 = await call('POST', '/agent/enrol', { body: { code: second.body.code } });
  // The rebuilt-machine case: the old token must stop working at that moment.
  assert.equal((await call('GET', '/agent/units', { token: a2.body.token })).status, 200);
  assert.equal((await call('GET', '/agent/units', { token: a1.body.token })).status, 401);
});

test('issuing a code supersedes the outstanding one', { skip }, async () => {
  const first = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  const second = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  // Otherwise a re-issue after a mistype leaves a live code adrift.
  assert.equal((await call('POST', '/agent/enrol', { body: { code: first.body.code } })).status, 401);
  assert.equal((await call('POST', '/agent/enrol', { body: { code: second.body.code } })).status, 201);
});

test('an expired code is refused', { skip }, async () => {
  const issued = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  await pool.query(`UPDATE enrolment_codes SET expires_at = now() - interval '1 minute'`);
  assert.equal((await call('POST', '/agent/enrol', { body: { code: issued.body.code } })).status, 401);
});

test('only one agent is active at a time', { skip }, async () => {
  // The hotel agent iterates every unit itself, so there is one per
  // deployment — unlike tally, where an agent is per shop (§620).
  const issued = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  await call('POST', '/agent/enrol', { body: { code: issued.body.code } });
  await assert.rejects(
    pool.query(`INSERT INTO agents (token_hash) VALUES ('another')`),
    /duplicate key/
  );
});
