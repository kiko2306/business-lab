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
  await pool.query('DELETE FROM guests');
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
    'pulse_questions',
    'pulse_responses',
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

// ---------------------------------------------------------------------------
// The sync: units, guests and reservations in, completed check-ins back out.
// ---------------------------------------------------------------------------

/** Enrols an agent and returns its token. */
async function enrolAgent(): Promise<string> {
  const issued = await call('POST', '/api/agent/enrolment-code', { headers: ADMIN });
  const enrolled = await call('POST', '/agent/enrol', { body: { code: issued.body.code } });
  return enrolled.body.token;
}

test('the sync is refused without an agent token', { skip }, async () => {
  assert.equal((await call('POST', '/agent/units', { body: [] })).status, 401);
  assert.equal((await call('GET', '/agent/checkins/pending')).status, 401);
});

test('units sync by code, and a sync never resets the flow switches', { skip }, async () => {
  const token = await enrolAgent();
  await call('POST', '/agent/units', { token, body: [{ code: 'A', name: 'Alpha' }] });

  const [unit] = (await call('GET', '/api/units', { headers: ADMIN })).body;
  await call('PATCH', `/api/units/${unit.id}`, { headers: ADMIN, body: { checkinActive: true } });

  // The switches are an admin's decision here, not Wintouch's — a re-sync
  // that reset them would silently stop every check-in email.
  await call('POST', '/agent/units', { token, body: [{ code: 'A', name: 'Alpha renamed' }] });
  const [after] = (await call('GET', '/api/units', { headers: ADMIN })).body;
  assert.equal(after.name, 'Alpha renamed');
  assert.equal(after.checkinActive, true);
});

test('a guest with pending edits is skipped, not overwritten', { skip }, async () => {
  // The legacy bug: its guest sync was a blind updateOrCreate and ran *before*
  // the check-in write-back, so a guest who corrected their details online had
  // them replaced with the stale Wintouch values on the next tick — and the
  // stale values were then written back. Silent data loss.
  const token = await enrolAgent();
  await call('POST', '/agent/guests', { token, body: [{ code: 'G1', firstName: 'Ana', lastName: 'Old' }] });
  await pool.query(`UPDATE guests SET last_name = 'Corrected', has_changes = true WHERE code = 'G1'`);

  const result = await call('POST', '/agent/guests', {
    token,
    body: [{ code: 'G1', firstName: 'Ana', lastName: 'Old' }],
  });
  assert.deepEqual(result.body, { saved: 0, skipped: 1 });
  const { rows } = await pool.query(`SELECT last_name FROM guests WHERE code = 'G1'`);
  assert.equal(rows[0].last_name, 'Corrected');
});

test('reservations sync without resetting what this side owns', { skip }, async () => {
  const token = await enrolAgent();
  await call('POST', '/agent/units', { token, body: [{ code: 'A', name: 'Alpha' }] });
  await call('POST', '/agent/guests', { token, body: [{ code: 'G1', firstName: 'Ana' }] });

  const body = [{
    unitCode: 'A', number: '100', line: 1, guestCode: 'G1',
    roomCode: '12', roomName: 'Twin', adults: 2, children: 1, babies: 0,
    checkin: '2026-03-01', checkout: '2026-03-04', status: 'RESERVED', channel: 'direct',
    extras: [{ code: 'E1', firstName: 'Bruno', ageGroup: 1 }],
  }];
  assert.deepEqual((await call('POST', '/agent/reservations', { token, body })).body,
    { saved: 1, unknownUnits: [] });

  // A check-in email has gone out; the next tick must not un-send it.
  await pool.query(`UPDATE reservations SET checkin_sent = true`);
  await call('POST', '/agent/reservations', { token, body });
  const { rows } = await pool.query(`SELECT checkin_sent, room_name FROM reservations`);
  assert.equal(rows.length, 1, 'the upsert must not duplicate on re-sync');
  assert.equal(rows[0].checkin_sent, true);
  assert.equal(rows[0].room_name, 'Twin');
});

test('a reservation for an unknown unit is reported, not fatal', { skip }, async () => {
  // The units sync runs first, so a brand new property simply arrives on the
  // next tick — failing the whole batch over it would stall every other one.
  const token = await enrolAgent();
  const res = await call('POST', '/agent/reservations', {
    token,
    body: [{ unitCode: 'NOPE', number: '1', line: 1, checkin: '2026-03-01', checkout: '2026-03-02' }],
  });
  assert.deepEqual(res.body, { saved: 0, unknownUnits: ['NOPE'] });
});

test("Wintouch's 1900-01-01 placeholder is stored as unknown", { skip }, async () => {
  const token = await enrolAgent();
  await call('POST', '/agent/guests', { token, body: [{ code: 'G1', birthDate: '1900-01-01' }] });
  const { rows } = await pool.query(`SELECT birth_date FROM guests WHERE code = 'G1'`);
  // Storing it as a real date would claim knowledge the PMS does not have.
  assert.equal(rows[0].birth_date, null);
});

test('a completed check-in goes back once, then reopens the guest to syncing', { skip }, async () => {
  const token = await enrolAgent();
  await call('POST', '/agent/units', { token, body: [{ code: 'A', name: 'Alpha' }] });
  await call('POST', '/agent/guests', { token, body: [{ code: 'G1', firstName: 'Ana' }] });
  await call('POST', '/agent/reservations', {
    token,
    body: [{ unitCode: 'A', number: '100', line: 1, guestCode: 'G1', checkin: '2026-03-01', checkout: '2026-03-04' }],
  });

  // The guest completes check-in online.
  await pool.query(`UPDATE reservations SET checkin_success = true`);
  await pool.query(`UPDATE guests SET has_changes = true, last_name = 'Corrected' WHERE code = 'G1'`);

  const pending = await call('GET', '/agent/checkins/pending', { token });
  assert.equal(pending.body.length, 1);
  assert.equal(pending.body[0].guest.lastName, 'Corrected');

  const ack = await call('POST', `/agent/checkins/${pending.body[0].token}/ack`, { token, body: { ok: true } });
  assert.equal(ack.body.acknowledged, true);

  // Written back, so it stops appearing and the guest resumes syncing.
  assert.equal((await call('GET', '/agent/checkins/pending', { token })).body.length, 0);
  const { rows } = await pool.query(`SELECT has_changes FROM guests WHERE code = 'G1'`);
  assert.equal(rows[0].has_changes, false);
});

test('a failed write-back leaves the check-in to be retried', { skip }, async () => {
  const token = await enrolAgent();
  await call('POST', '/agent/units', { token, body: [{ code: 'A', name: 'Alpha' }] });
  await call('POST', '/agent/reservations', {
    token,
    body: [{ unitCode: 'A', number: '100', line: 1, checkin: '2026-03-01', checkout: '2026-03-04' }],
  });
  await pool.query(`UPDATE reservations SET checkin_success = true`);

  const pending = await call('GET', '/agent/checkins/pending', { token });
  await call('POST', `/agent/checkins/${pending.body[0].token}/ack`, { token, body: { ok: false } });

  // Still pending: a transient Wintouch error must self-heal on the next tick
  // rather than silently dropping a guest's check-in.
  assert.equal((await call('GET', '/agent/checkins/pending', { token })).body.length, 1);
});

test('an oversized batch is refused rather than absorbed', { skip }, async () => {
  const token = await enrolAgent();
  const huge = Array.from({ length: 1001 }, (_, i) => ({ code: `U${i}`, name: 'x' }));
  assert.equal((await call('POST', '/agent/units', { token, body: huge })).status, 400);
  assert.equal((await call('POST', '/agent/units', { token, body: { not: 'an array' } })).status, 400);
});

/** A unit with check-in switched on, a guest, and a reservation for them. */
async function seedCheckinReservation(opts: { checkinActive?: boolean; guest?: boolean } = {}) {
  const unitId = await seedUnit('A', 'Alpha');
  if (opts.checkinActive !== false) {
    await pool.query(`UPDATE units SET checkin_is_active = true WHERE id = $1`, [unitId]);
  }
  let guestId: string | null = null;
  if (opts.guest !== false) {
    const guest = await pool.query(
      `INSERT INTO guests (code, first_name, last_name) VALUES ('G1', 'Ana', 'Old') RETURNING id`
    );
    guestId = guest.rows[0].id;
  }
  const reservation = await pool.query(
    `INSERT INTO reservations (unit_id, number, line, guest_id, adults, children, babies, checkin_on, checkout_on, status)
     VALUES ($1, '1', 1, $2, 2, 1, 0, '2026-01-01', '2026-01-03', 'RESERVED') RETURNING id, token`,
    [unitId, guestId]
  );
  return { reservationId: reservation.rows[0].id, token: reservation.rows[0].token, guestId };
}

test('a check-in link 404s for a bad token, and for a unit with the flow off', { skip }, async () => {
  assert.equal((await call('GET', '/checkin/not-a-token')).status, 404);

  const { token } = await seedCheckinReservation({ checkinActive: false });
  assert.equal((await call('GET', `/checkin/${token}`)).status, 404);
});

test('a check-in link shows the reservation, prefilled with the guest on file', { skip }, async () => {
  const { token } = await seedCheckinReservation();
  const res = await call('GET', `/checkin/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.occupants.adults, 2);
  assert.equal(res.body.guest.firstName, 'Ana');
  assert.equal(res.body.submitted, false);
});

test('submitting a check-in updates the guest, stores occupants, and reopens the write-back', { skip }, async () => {
  const { token, guestId, reservationId } = await seedCheckinReservation();

  const submit = await call('POST', `/checkin/${token}`, {
    body: {
      guest: { firstName: 'Ana', lastName: 'Corrected', documentType: 1, documentNumber: 'X123' },
      extras: [
        { firstName: 'Bruno', lastName: 'Child', ageGroup: 1 },
        { firstName: 'Extra', lastName: 'Ignored', ageGroup: 1 },
      ],
    },
  });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.submitted, true);
  // adults(2) + children(1) + babies(0) - 1 for the primary guest = 2 slots,
  // so the second extra is kept and only a third would be dropped.
  assert.equal(submit.body.extras.length, 2);

  const { rows } = await pool.query(`SELECT last_name, has_changes FROM guests WHERE id = $1`, [guestId]);
  assert.equal(rows[0].last_name, 'Corrected');
  assert.equal(rows[0].has_changes, true);
  const res = await pool.query(
    `SELECT checkin_success, checkin_notified FROM reservations WHERE id = $1`,
    [reservationId]
  );
  assert.deepEqual(res.rows[0], { checkin_success: true, checkin_notified: false });
});

test('a check-in submission is refused when the reservation has no guest yet', { skip }, async () => {
  const { token } = await seedCheckinReservation({ guest: false });
  const res = await call('POST', `/checkin/${token}`, { body: { guest: {}, extras: [] } });
  assert.equal(res.status, 409);
});

test('resubmitting after the agent already wrote back reopens the write-back', { skip }, async () => {
  const { token, reservationId } = await seedCheckinReservation();
  const agentToken = await enrolAgent();

  await call('POST', `/checkin/${token}`, { body: { guest: { firstName: 'Ana' }, extras: [] } });
  const pending = await call('GET', '/agent/checkins/pending', { token: agentToken });
  await call('POST', `/agent/checkins/${pending.body[0].token}/ack`, { token: agentToken, body: { ok: true } });
  assert.equal(
    (await pool.query(`SELECT checkin_notified FROM reservations WHERE id = $1`, [reservationId])).rows[0]
      .checkin_notified,
    true
  );

  await call('POST', `/checkin/${token}`, { body: { guest: { firstName: 'Ana', lastName: 'Fixed' }, extras: [] } });
  assert.equal(
    (await pool.query(`SELECT checkin_notified FROM reservations WHERE id = $1`, [reservationId])).rows[0]
      .checkin_notified,
    false
  );
});

test('a Wintouch re-sync after check-in does not wipe the occupants the guest entered', { skip }, async () => {
  // The bug this closes: /agent/reservations replaced guest_extras wholesale
  // on every tick with no regard for checkin_success, so a completed
  // check-in's occupants were deleted by the agent's own next sync.
  const { token } = await seedCheckinReservation();
  await call('POST', `/checkin/${token}`, {
    body: { guest: { firstName: 'Ana' }, extras: [{ firstName: 'Bruno', ageGroup: 1 }] },
  });

  const agentToken = await enrolAgent();
  await call('POST', '/agent/units', { token: agentToken, body: [{ code: 'A', name: 'Alpha' }] });
  await call('POST', '/agent/reservations', {
    token: agentToken,
    body: [{
      unitCode: 'A', number: '1', line: 1, adults: 2, children: 1, babies: 0,
      checkin: '2026-01-01', checkout: '2026-01-03', status: 'RESERVED',
      extras: [{ code: 'STALE', firstName: 'Wintouch', ageGroup: 0 }],
    }],
  });

  const after = await call('GET', `/checkin/${token}`);
  assert.equal(after.body.extras.length, 1);
  assert.equal(after.body.extras[0].firstName, 'Bruno');
});

/** A unit with feedback switched on and a reservation for a guest. */
async function seedPulseReservation(opts: { quizActive?: boolean } = {}) {
  const unitId = await seedUnit('A', 'Alpha');
  if (opts.quizActive !== false) {
    await pool.query(`UPDATE units SET quiz_is_active = true WHERE id = $1`, [unitId]);
  }
  const reservation = await pool.query(
    `INSERT INTO reservations (unit_id, number, line, checkin_on, checkout_on, status)
     VALUES ($1, '1', 1, '2026-01-01', '2026-01-03', 'RESERVED') RETURNING id, token`,
    [unitId]
  );
  return { reservationId: reservation.rows[0].id, token: reservation.rows[0].token };
}

test('a feedback link 404s for a bad token, and for a unit with the flow off', { skip }, async () => {
  assert.equal((await call('GET', '/pulse/not-a-token')).status, 404);

  const { token } = await seedPulseReservation({ quizActive: false });
  assert.equal((await call('GET', `/pulse/${token}`)).status, 404);
});

test('a feedback link shows the seeded questions, unanswered', { skip }, async () => {
  const { token } = await seedPulseReservation();
  const res = await call('GET', `/pulse/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.submitted, false);
  assert.equal(res.body.questions.length, 4);
  assert.ok(res.body.questions.every((q: { answer: unknown }) => q.answer === null));
});

test('submitting feedback stores valid answers and drops the rest', { skip }, async () => {
  const { token, reservationId } = await seedPulseReservation();
  const questions = (await call('GET', `/pulse/${token}`)).body.questions as { id: string; type: string }[];
  const rating = questions.find((q) => q.type === 'rating')!;
  const freeText = questions.find((q) => q.type === 'text')!;

  const submit = await call('POST', `/pulse/${token}`, {
    body: {
      responses: [
        { questionId: rating.id, answer: 5 },
        { questionId: rating.id, answer: 9 }, // out of range, dropped below
        { questionId: freeText.id, answer: 'Lovely stay' },
        { questionId: 'not-a-real-question', answer: 'ignored' },
      ],
    },
  });
  assert.equal(submit.status, 200);
  assert.equal(submit.body.submitted, true);

  const { rows } = await pool.query(
    `SELECT question_id, answer FROM pulse_responses WHERE reservation_id = $1`,
    [reservationId]
  );
  // Only the last response per question survives — a duplicate questionId in
  // one submission is a client bug, not two answers to store.
  assert.equal(rows.length, 2);
  const byQuestion = new Map(rows.map((r) => [r.question_id, r.answer]));
  assert.equal(byQuestion.get(freeText.id), 'Lovely stay');
});

test('resubmitting feedback overwrites the previous answers', { skip }, async () => {
  const { token, reservationId } = await seedPulseReservation();
  const questions = (await call('GET', `/pulse/${token}`)).body.questions as { id: string; type: string }[];
  const rating = questions.find((q) => q.type === 'rating')!;

  await call('POST', `/pulse/${token}`, { body: { responses: [{ questionId: rating.id, answer: 2 }] } });
  await call('POST', `/pulse/${token}`, { body: { responses: [{ questionId: rating.id, answer: 4 }] } });

  const { rows } = await pool.query(
    `SELECT answer FROM pulse_responses WHERE reservation_id = $1`,
    [reservationId]
  );
  assert.deepEqual(rows.map((r) => r.answer), ['4']);
});
