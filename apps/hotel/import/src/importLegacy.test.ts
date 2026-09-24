import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { Pool } from 'pg';
import { importLegacyData } from './importLegacy';

// Two real, ephemeral databases — a MySQL fixture shaped exactly like the
// legacy Laravel schema (sample/hotel/setup/api/database/migrations), and a
// real hotel-core Postgres schema built from its own migration files, so
// this never drifts from what hotel-core actually runs. Skipped unless both
// are configured, the same convention apps/hotel/api/src/api.test.ts uses.
const skip = !process.env.MYSQL_URL || !process.env.DATABASE_URL;

let mysqlConn: mysql.Connection;
let pg: Pool;

before(async () => {
  if (skip) return;
  mysqlConn = await mysql.createConnection({ uri: process.env.MYSQL_URL!, dateStrings: true });
  // Relaxed to match an older/permissive legacy install: MySQL 8's default
  // strict mode refuses to even store the `0000-00-00` sentinel, but a real
  // legacy database may not be running with that default (§658's whole
  // reason to guard against it in code is that it's allowed to exist).
  await mysqlConn.query(`SET SESSION sql_mode = ''`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS units (id INT PRIMARY KEY AUTO_INCREMENT, code VARCHAR(64))`);
  await mysqlConn.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id INT PRIMARY KEY AUTO_INCREMENT, code VARCHAR(64),
      doc SMALLINT NULL, doc_number VARCHAR(64) NULL, doc_number_id_control VARCHAR(64) NULL,
      doc_date DATE NULL, doc_valid DATE NULL, doc_local VARCHAR(255) NULL,
      doc_country VARCHAR(64) NULL, doc_by VARCHAR(255) NULL, birth_local VARCHAR(255) NULL
    )`);
  await mysqlConn.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INT PRIMARY KEY AUTO_INCREMENT, unit_id INT, number INT, line INT,
      checkin_success TINYINT(1) DEFAULT 0, quiz_response TINYINT(1) DEFAULT 0
    )`);
  await mysqlConn.query(`CREATE TABLE IF NOT EXISTS quiz_questions (id INT PRIMARY KEY AUTO_INCREMENT, question VARCHAR(255))`);
  await mysqlConn.query(`
    CREATE TABLE IF NOT EXISTS quiz_responses (
      id INT PRIMARY KEY AUTO_INCREMENT, reservation_id INT, quiz_question_id INT, answer TEXT
    )`);

  pg = new Pool({ connectionString: process.env.DATABASE_URL });
  const migrationsDir = path.join(__dirname, '..', '..', 'api', 'src', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await pg.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
});

after(async () => {
  if (skip) return;
  await mysqlConn.end();
  await pg.end();
});

beforeEach(async () => {
  if (skip) return;
  await mysqlConn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of ['guests', 'reservations', 'units', 'quiz_questions', 'quiz_responses']) {
    await mysqlConn.query(`TRUNCATE TABLE ${table}`);
  }
  await pg.query('DELETE FROM units');
  await pg.query('DELETE FROM guests');
  await pg.query(`DELETE FROM pulse_questions WHERE text NOT IN (
    'How would you rate your overall stay?', 'How would you rate the cleanliness of your room?',
    'How would you rate the helpfulness of our staff?', 'Any comments or suggestions for improvement?')`);
});

/** A unit + guest + reservation already synced into hotel-core, mirroring what the agent's own sync would have created. */
async function seedSynced(opts: { unitCode?: string; guestCode?: string; number?: string; line?: number } = {}) {
  const unitCode = opts.unitCode ?? 'A';
  const guestCode = opts.guestCode ?? 'G1';
  const number = opts.number ?? '100';
  const line = opts.line ?? 1;

  const unit = await pg.query(`INSERT INTO units (code, name) VALUES ($1, 'Alpha') RETURNING id`, [unitCode]);
  const guest = await pg.query(`INSERT INTO guests (code, first_name) VALUES ($1, 'Ana') RETURNING id`, [guestCode]);
  await pg.query(
    `INSERT INTO reservations (unit_id, number, line, guest_id, checkin_on, checkout_on, status)
     VALUES ($1, $2, $3, $4, '2026-01-01', '2026-01-03', 'RESERVED')`,
    [unit.rows[0].id, number, line, guest.rows[0].id]
  );

  const [mysqlUnit] = await mysqlConn.query<mysql.ResultSetHeader>(`INSERT INTO units (code) VALUES (?)`, [unitCode]);
  return { pgUnitId: unit.rows[0].id, mysqlUnitId: mysqlUnit.insertId, guestCode, number, line };
}

test('a guest\'s check-in document details import by their Wintouch code', { skip }, async () => {
  await seedSynced({ guestCode: 'G1' });
  await mysqlConn.query(
    `INSERT INTO guests (code, doc, doc_number, doc_number_id_control, doc_date, doc_valid, doc_local, doc_country, doc_by, birth_local)
     VALUES ('G1', 1, 'X123456', 'PT', '2020-01-01', '2030-01-01', 'Lisboa', 'PT', 'IRN', 'Porto')`
  );
  // A code with no match in hotel-core (never synced, or a typo) is simply skipped.
  await mysqlConn.query(`INSERT INTO guests (code, doc_number) VALUES ('UNKNOWN', 'Y999')`);

  const summary = await importLegacyData(process.env.MYSQL_URL!, pg);
  assert.equal(summary.guestsUpdated, 1);

  const { rows } = await pg.query(`SELECT * FROM guests WHERE code = 'G1'`);
  assert.equal(rows[0].document_type, 1);
  assert.equal(rows[0].document_number, 'X123456');
  assert.equal(rows[0].document_check, 'PT');
  assert.equal(rows[0].document_place, 'Lisboa');
  assert.equal(rows[0].birth_place, 'Porto');
  assert.equal(rows[0].document_issued.toISOString().slice(0, 10), '2020-01-01');
});

test('an unset MySQL date (0000-00-00) imports as null, not a bogus date', { skip }, async () => {
  await seedSynced({ guestCode: 'G1' });
  await mysqlConn.query(`INSERT INTO guests (code, doc_date, doc_valid) VALUES ('G1', '0000-00-00', NULL)`);

  await importLegacyData(process.env.MYSQL_URL!, pg);

  const { rows } = await pg.query(`SELECT document_issued, document_expires FROM guests WHERE code = 'G1'`);
  assert.equal(rows[0].document_issued, null);
  assert.equal(rows[0].document_expires, null);
});

test('checkin_success and checkin_sent import together, from completion alone', { skip }, async () => {
  const done = await seedSynced({ unitCode: 'A', guestCode: 'G1', number: '100', line: 1 });
  const pending = await seedSynced({ unitCode: 'B', guestCode: 'G2', number: '200', line: 1 });

  // Completed under legacy: both flags come in true.
  await mysqlConn.query(`INSERT INTO reservations (unit_id, number, line, checkin_success) VALUES (?, 100, 1, 1)`, [
    done.mysqlUnitId,
  ]);
  // Sent but never completed under legacy: both flags come in FALSE, so
  // hotel-core's own scheduler re-sends a fresh, working link — not a
  // "sent" flag pointing at a dead one.
  await mysqlConn.query(`INSERT INTO reservations (unit_id, number, line, checkin_success) VALUES (?, 200, 1, 0)`, [
    pending.mysqlUnitId,
  ]);

  const summary = await importLegacyData(process.env.MYSQL_URL!, pg);
  assert.equal(summary.reservationsUpdated, 2);

  const doneRow = await pg.query(`SELECT checkin_success, checkin_sent FROM reservations WHERE number = '100'`);
  assert.deepEqual([doneRow.rows[0].checkin_success, doneRow.rows[0].checkin_sent], [true, true]);

  const pendingRow = await pg.query(`SELECT checkin_success, checkin_sent FROM reservations WHERE number = '200'`);
  assert.deepEqual([pendingRow.rows[0].checkin_success, pendingRow.rows[0].checkin_sent], [false, false]);
});

test('feedback responses import when the question text matches exactly, and are counted when it does not', { skip }, async () => {
  const seeded = await seedSynced();
  await mysqlConn.query(`INSERT INTO reservations (unit_id, number, line) VALUES (?, ?, ?)`, [
    seeded.mysqlUnitId,
    seeded.number,
    seeded.line,
  ]);
  const [reservationRow] = await mysqlConn.query<mysql.RowDataPacket[]>(`SELECT id FROM reservations LIMIT 1`);
  const reservationId = reservationRow[0].id;

  const [matching] = await mysqlConn.query<mysql.ResultSetHeader>(
    `INSERT INTO quiz_questions (question) VALUES ('How would you rate your overall stay?')`
  );
  const [unmatched] = await mysqlConn.query<mysql.ResultSetHeader>(
    `INSERT INTO quiz_questions (question) VALUES ('A question this client renamed since cutover')`
  );
  await mysqlConn.query(`INSERT INTO quiz_responses (reservation_id, quiz_question_id, answer) VALUES (?, ?, '5')`, [
    reservationId,
    matching.insertId,
  ]);
  await mysqlConn.query(
    `INSERT INTO quiz_responses (reservation_id, quiz_question_id, answer) VALUES (?, ?, 'some answer')`,
    [reservationId, unmatched.insertId]
  );

  const summary = await importLegacyData(process.env.MYSQL_URL!, pg);
  assert.equal(summary.feedbackImported, 1);
  assert.equal(summary.feedbackSkippedNoQuestionMatch, 1);
  assert.deepEqual(summary.unmatchedQuestionTexts, ['A question this client renamed since cutover']);

  const { rows } = await pg.query(
    `SELECT pr.answer FROM pulse_responses pr
       JOIN pulse_questions pq ON pq.id = pr.question_id
      WHERE pq.text = 'How would you rate your overall stay?'`
  );
  assert.equal(rows[0].answer, '5');
});

test('re-running the import is safe: no duplicate feedback rows', { skip }, async () => {
  const seeded = await seedSynced();
  await mysqlConn.query(`INSERT INTO reservations (unit_id, number, line) VALUES (?, ?, ?)`, [
    seeded.mysqlUnitId,
    seeded.number,
    seeded.line,
  ]);
  const [reservationRow] = await mysqlConn.query<mysql.RowDataPacket[]>(`SELECT id FROM reservations LIMIT 1`);
  const [question] = await mysqlConn.query<mysql.ResultSetHeader>(
    `INSERT INTO quiz_questions (question) VALUES ('How would you rate your overall stay?')`
  );
  await mysqlConn.query(`INSERT INTO quiz_responses (reservation_id, quiz_question_id, answer) VALUES (?, ?, '5')`, [
    reservationRow[0].id,
    question.insertId,
  ]);

  await importLegacyData(process.env.MYSQL_URL!, pg);
  const second = await importLegacyData(process.env.MYSQL_URL!, pg);
  assert.equal(second.feedbackImported, 0); // ON CONFLICT DO NOTHING — already there.

  const { rows } = await pg.query(`SELECT count(*) FROM pulse_responses`);
  assert.equal(rows[0].count, '1');
});
