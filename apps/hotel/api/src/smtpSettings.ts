import type { Pool } from 'pg';

/**
 * The hotel's own SMTP sender (plan.md §629 decision #5, §648). Deliberately
 * provider-agnostic, the same shape as the dashboard's shared-mailbox
 * settings (`backend/src/utils/mailSettings.ts`) — just scoped to this app's
 * own database instead of the dashboard's `settings` table, since guest mail
 * must come from the hotel's own address.
 */

export type SmtpEncryption = 'tls' | 'ssl' | 'none';

export interface SmtpConfig {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

interface SmtpRow {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password: string;
  from_address: string;
  from_name: string;
}

/** Sensible default port for the chosen encryption, same reasoning as the dashboard's. */
export function defaultPort(encryption: SmtpEncryption): number {
  return encryption === 'ssl' ? 465 : encryption === 'none' ? 25 : 587;
}

async function loadRow(pool: Pool): Promise<SmtpRow | null> {
  const { rows } = await pool.query<SmtpRow>('SELECT * FROM smtp_settings WHERE id = 1');
  return rows[0] ?? null;
}

/** Whether there is enough here to actually send — host, user and a from address. */
function isConfigured(row: SmtpRow): boolean {
  return Boolean(row.host && row.username && row.from_address);
}

/** Null when not (yet) configured, so a sender can fail fast rather than dial an empty host. */
export async function getSmtpConfig(pool: Pool): Promise<SmtpConfig | null> {
  const row = await loadRow(pool);
  if (!row || !isConfigured(row)) return null;
  return {
    host: row.host,
    port: row.port,
    encryption: row.encryption,
    username: row.username,
    password: row.password,
    fromAddress: row.from_address,
    fromName: row.from_name,
  };
}

export { loadRow as loadSmtpRow, isConfigured as smtpConfigured };
export type { SmtpRow };
