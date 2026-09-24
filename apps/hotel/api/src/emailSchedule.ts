import nodemailer from 'nodemailer';
import type { Pool } from 'pg';
import type { GuestTextLocale } from './guestText';
import { getSmtpConfig } from './smtpSettings';

/**
 * The two per-minute guest-email jobs (plan.md §620, §651) — the rebuild's
 * `checkin:send` / `quiz:send` — plus the agent-down alert the legacy ran on
 * the same cadence (`conn:check`). Runs entirely off what's already built:
 * the SMTP sender (§649), the guest-text template store (§650), and the
 * per-unit offset columns and `alert_email` column §651 itself adds.
 *
 * ponytail: every guest gets the pt-pt templates — there is no per-guest
 * locale column yet, and check-in/pulse's own guest UI is English-only
 * today too (§650's note). Add real guest-level i18n if that's ever wanted;
 * until then this matches the hotels this is actually built for.
 */
const GUEST_LOCALE: GuestTextLocale = 'pt-pt';

const BATCH_LIMIT = 200;

export interface DueReservation {
  id: string;
  token: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  unit_name: string;
}

/**
 * Due for the check-in email: `checkin_on <= today + offset`, not "exactly"
 * — the legacy's exact-day match (§620) means a scheduler outage of even a
 * day would silently skip a guest forever, since `checkin_sent` never flips.
 * `<=` catches up on the next run instead; the flag still stops a repeat.
 */
export async function loadDueCheckins(pool: Pool): Promise<DueReservation[]> {
  const { rows } = await pool.query<DueReservation>(
    `SELECT r.id, r.token::text AS token, g.first_name, g.last_name, g.email, u.name AS unit_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       JOIN guests g ON g.id = r.guest_id
      WHERE r.checkin_sent = false AND r.checkin_success = false
        AND u.is_active AND u.checkin_is_active
        AND r.checkin_on <= (CURRENT_DATE + u.checkin_offset_days)
        AND g.email IS NOT NULL AND g.email <> ''
      ORDER BY r.checkin_on
      LIMIT $1`,
    [BATCH_LIMIT]
  );
  return rows;
}

/** Due for the quiz email: `checkout_on <= today - offset` — "offset days past checkout" (§620). */
export async function loadDueQuiz(pool: Pool): Promise<DueReservation[]> {
  const { rows } = await pool.query<DueReservation>(
    `SELECT r.id, r.token::text AS token, g.first_name, g.last_name, g.email, u.name AS unit_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       JOIN guests g ON g.id = r.guest_id
      WHERE r.quiz_sent = false
        AND u.is_active AND u.quiz_is_active
        AND r.checkout_on <= (CURRENT_DATE - u.quiz_offset_days)
        AND g.email IS NOT NULL AND g.email <> ''
      ORDER BY r.checkout_on
      LIMIT $1`,
    [BATCH_LIMIT]
  );
  return rows;
}

function guestName(r: DueReservation): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || r.email;
}

function guestUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/${token}`;
}

async function loadTemplates(pool: Pool, keys: string[]): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM guest_text_templates WHERE key = ANY($1) AND locale = $2`,
    [keys, GUEST_LOCALE]
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function sendFlowEmails(
  pool: Pool,
  transporter: nodemailer.Transporter,
  from: string,
  flow: 'checkin' | 'quiz',
  linkBase: string,
  due: DueReservation[],
  sentColumn: 'checkin_sent' | 'quiz_sent'
): Promise<number> {
  if (due.length === 0) return 0;
  const prefix = flow.toUpperCase();
  const templates = await loadTemplates(pool, [`${prefix}_MAIL_SUBJECT`, `${prefix}_MAIL_TEXT`, `${prefix}_MAIL_BUTTON`]);
  const subject = templates[`${prefix}_MAIL_SUBJECT`] ?? '';
  const text = templates[`${prefix}_MAIL_TEXT`] ?? '';
  const button = templates[`${prefix}_MAIL_BUTTON`] ?? '';

  let sent = 0;
  for (const r of due) {
    const link = guestUrl(linkBase, r.token);
    const body = text.replace(/\$guest\b/g, guestName(r));
    try {
      await transporter.sendMail({
        from,
        to: r.email,
        subject,
        html: `${body}<p><a href="${link}">${button}</a></p>`,
      });
    } catch (err) {
      console.error(`hotel-core: ${flow} email failed for reservation ${r.id}`, err);
      continue;
    }
    await pool.query(`UPDATE reservations SET ${sentColumn} = true, updated_at = now() WHERE id = $1`, [r.id]);
    sent += 1;
  }
  return sent;
}

async function sendAgentDownAlert(pool: Pool, transporter: nodemailer.Transporter, from: string, alertEmail: string): Promise<void> {
  if (!alertEmail) return;
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE agents SET down_alert_sent_at = now()
      WHERE revoked_at IS NULL AND down_alert_sent_at IS NULL
        AND (last_seen_at IS NULL OR last_seen_at < now() - interval '15 minutes')
      RETURNING id`
  );
  if (rows.length === 0) return;
  try {
    await transporter.sendMail({
      from,
      to: alertEmail,
      subject: 'Hotel property agent is not reporting in',
      text: 'The property agent has not contacted hotel-core in over 15 minutes. Units, guests and reservations will stop syncing until it reconnects.',
    });
  } catch (err) {
    console.error('hotel-core: agent-down alert failed', err);
  }
}

/** One tick: check-in mail, quiz mail, then the agent-down alert. Never throws — a bad send must not take the scheduler down. */
export async function runEmailSchedule(pool: Pool): Promise<void> {
  try {
    const smtp = await getSmtpConfig(pool);
    if (!smtp) return; // Nothing configured yet — same "fail fast, no empty dial" as smtp/test.

    const checkinBase = process.env.HOTEL_CHECKIN_URL ?? '';
    const pulseBase = process.env.HOTEL_PULSE_URL ?? '';
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.encryption === 'ssl',
      requireTLS: smtp.encryption === 'tls',
      auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
      // A stuck or unreachable server must not hold up a minute-cadence
      // scheduler indefinitely — nodemailer's own default is 2 minutes.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    const from = smtp.fromName ? `"${smtp.fromName}" <${smtp.fromAddress}>` : smtp.fromAddress;

    try {
      if (checkinBase) {
        await sendFlowEmails(pool, transporter, from, 'checkin', checkinBase, await loadDueCheckins(pool), 'checkin_sent');
      }
      if (pulseBase) {
        await sendFlowEmails(pool, transporter, from, 'quiz', pulseBase, await loadDueQuiz(pool), 'quiz_sent');
      }
      await sendAgentDownAlert(pool, transporter, from, smtp.alertEmail);
    } finally {
      transporter.close();
    }
  } catch (err) {
    console.error('hotel-core: email schedule tick failed', err);
  }
}

/** Started once from index.ts. Re-entrancy guard: a slow SMTP server must not stack ticks. */
export function startEmailSchedule(pool: Pool): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    runEmailSchedule(pool)
      .catch((err) => console.error('hotel-core: email schedule tick failed', err))
      .finally(() => {
        running = false;
      });
  }, 60_000);
}
