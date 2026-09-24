import mysql from 'mysql2/promise';
import type { Pool } from 'pg';

/**
 * The one-time cutover import (plan.md §629's decision #3, §657, §658):
 * pulls check-in history and feedback responses out of the legacy Laravel/
 * MySQL database and into hotel-core. Everything else (units, guests'
 * ordinary contact details, reservations) re-syncs fresh from Wintouch
 * through the agent instead — this only fills in what the agent's sync can
 * never know: what a guest already submitted, and whether they'd already
 * finished, under the old system.
 *
 * Run once, after the agent's first full sync has populated units, guests
 * and reservations (this import only ever *updates* rows the agent already
 * created — it never inserts a guest or reservation of its own). Safe to
 * re-run: every write here is an idempotent UPDATE or an
 * `ON CONFLICT DO NOTHING` insert.
 */

export interface ImportSummary {
  guestsUpdated: number;
  reservationsUpdated: number;
  feedbackImported: number;
  feedbackSkippedNoQuestionMatch: number;
  feedbackSkippedNoReservation: number;
  unmatchedQuestionTexts: string[];
}

export async function importLegacyData(mysqlUrl: string, pg: Pool): Promise<ImportSummary> {
  const mysqlConn = await mysql.createConnection({ uri: mysqlUrl, dateStrings: true });
  try {
    const summary: ImportSummary = {
      guestsUpdated: 0,
      reservationsUpdated: 0,
      feedbackImported: 0,
      feedbackSkippedNoQuestionMatch: 0,
      feedbackSkippedNoReservation: 0,
      unmatchedQuestionTexts: [],
    };
    await importGuests(mysqlConn, pg, summary);
    await importReservations(mysqlConn, pg, summary);
    await importFeedback(mysqlConn, pg, summary);
    return summary;
  } finally {
    await mysqlConn.end();
  }
}

/**
 * Only the fields the check-in form actually collects (the same subset
 * checkin.ts's own write-back reads, per §656's "collecting more would sit
 * unread" reasoning) — never the ordinary contact fields the agent's own
 * sync already keeps current from Wintouch, which this must not clobber
 * with a possibly-stale legacy copy.
 */
async function importGuests(mysqlConn: mysql.Connection, pg: Pool, summary: ImportSummary): Promise<void> {
  const [rows] = await mysqlConn.query<mysql.RowDataPacket[]>(
    `SELECT code, doc, doc_number, doc_number_id_control, doc_date, doc_valid,
            doc_local, doc_country, doc_by, birth_local
       FROM guests
      WHERE code IS NOT NULL AND code != ''`
  );

  for (const row of rows) {
    const { rowCount } = await pg.query(
      `UPDATE guests SET
         document_type = $2, document_number = $3, document_check = $4,
         document_issued = $5, document_expires = $6, document_place = $7,
         document_country = $8, document_issuer = $9, birth_place = $10,
         updated_at = now()
       WHERE code = $1`,
      [
        row.code,
        row.doc,
        nullify(row.doc_number),
        nullify(row.doc_number_id_control),
        mysqlDate(row.doc_date),
        mysqlDate(row.doc_valid),
        nullify(row.doc_local),
        nullify(row.doc_country),
        nullify(row.doc_by),
        nullify(row.birth_local),
      ]
    );
    summary.guestsUpdated += rowCount ?? 0;
  }
}

/**
 * `checkin_success`/`checkin_sent` and `quiz_response`/`quiz_sent` are set
 * **together**, from the completion flag alone (§657's decision) — a
 * reservation already finished under the legacy system must not be
 * re-asked, and one not yet finished must get a fresh, working link from
 * hotel-core's own scheduler catch-up rather than a copied "sent" flag
 * pointing at a link that no longer exists.
 */
async function importReservations(mysqlConn: mysql.Connection, pg: Pool, summary: ImportSummary): Promise<void> {
  const [rows] = await mysqlConn.query<mysql.RowDataPacket[]>(
    `SELECT u.code AS unit_code, r.number, r.line, r.checkin_success, r.quiz_response
       FROM reservations r
       JOIN units u ON u.id = r.unit_id`
  );

  for (const row of rows) {
    const checkinDone = Boolean(row.checkin_success);
    const quizDone = Boolean(row.quiz_response);
    const { rowCount } = await pg.query(
      `UPDATE reservations r SET
         checkin_success = $4, checkin_sent = $4,
         quiz_answered = $5, quiz_sent = $5,
         updated_at = now()
       FROM units u
      WHERE r.unit_id = u.id AND u.code = $1 AND r.number = $2 AND r.line = $3`,
      [row.unit_code, String(row.number), row.line, checkinDone, quizDone]
    );
    summary.reservationsUpdated += rowCount ?? 0;
  }
}

/**
 * Matched by exact question text (plan.md §657) — the legacy's
 * quizzes → headers → questions hierarchy has no id in common with
 * hotel-core's flat, freshly-seeded `pulse_questions` (§644), and per-client
 * customised wording means there is no other reliable key. Anything that
 * doesn't match is counted and named, not guessed at.
 */
async function importFeedback(mysqlConn: mysql.Connection, pg: Pool, summary: ImportSummary): Promise<void> {
  const [rows] = await mysqlConn.query<mysql.RowDataPacket[]>(
    `SELECT u.code AS unit_code, r.number, r.line, qq.question, qr.answer
       FROM quiz_responses qr
       JOIN quiz_questions qq ON qq.id = qr.quiz_question_id
       JOIN reservations r ON r.id = qr.reservation_id
       JOIN units u ON u.id = r.unit_id`
  );

  const unmatched = new Set<string>();
  for (const row of rows) {
    const reservation = await pg.query(
      `SELECT r.id FROM reservations r JOIN units u ON u.id = r.unit_id
        WHERE u.code = $1 AND r.number = $2 AND r.line = $3`,
      [row.unit_code, String(row.number), row.line]
    );
    if (reservation.rowCount === 0) {
      summary.feedbackSkippedNoReservation++;
      continue;
    }

    const question = await pg.query(`SELECT id FROM pulse_questions WHERE text = $1`, [row.question]);
    if (question.rowCount === 0) {
      summary.feedbackSkippedNoQuestionMatch++;
      unmatched.add(row.question);
      continue;
    }

    const inserted = await pg.query(
      `INSERT INTO pulse_responses (reservation_id, question_id, answer)
       VALUES ($1, $2, $3)
       ON CONFLICT (reservation_id, question_id) DO NOTHING`,
      [reservation.rows[0].id, question.rows[0].id, row.answer]
    );
    summary.feedbackImported += inserted.rowCount ?? 0;
  }
  summary.unmatchedQuestionTexts = [...unmatched];
}

/** MySQL stores an unset date as the `0000-00-00` sentinel, not NULL. */
function mysqlDate(value: unknown): string | null {
  const s = nullify(value);
  return s && s !== '0000-00-00' ? s : null;
}

function nullify(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
