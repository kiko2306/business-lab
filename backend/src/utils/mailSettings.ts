/**
 * Global mail settings: one SMTP account for sending, and optionally one IMAP
 * account for receiving, shared by every app that needs email.
 *
 * Deliberately provider-agnostic — host/port/credentials, nothing tied to a
 * particular vendor. Whatever mailbox the user already has (their own server,
 * a hosting provider, Gmail with an app password, a relay like Brevo or
 * SMTP2GO) works the same way, and swapping providers is an edit here rather
 * than a change in every app.
 *
 * Stored per-key in `settings` so it sits alongside the exposure and
 * Cloudflare configuration, and so a partially-filled form is representable —
 * receiving is optional, and most installs will only ever set sending.
 */

import { query } from './database';

export const MAIL_SETTINGS_KEYS = {
  // Sending (SMTP submission)
  smtpHost: 'mail_smtp_host',
  smtpPort: 'mail_smtp_port',
  smtpUser: 'mail_smtp_user',
  smtpPassword: 'mail_smtp_password',
  smtpEncryption: 'mail_smtp_encryption',
  fromAddress: 'mail_from_address',
  fromName: 'mail_from_name',
  // Receiving (IMAP) — optional. Used by apps that turn email into records,
  // e.g. ITFlow's email-to-ticket and Paperless' document intake.
  imapHost: 'mail_imap_host',
  imapPort: 'mail_imap_port',
  imapUser: 'mail_imap_user',
  imapPassword: 'mail_imap_password',
  imapEncryption: 'mail_imap_encryption',
} as const;

/** How the connection is secured. Named as the apps themselves name it. */
export type MailEncryption = 'tls' | 'ssl' | 'none';

export interface MailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpEncryption: MailEncryption;
  fromAddress: string;
  fromName: string;
  imapHost: string;
  imapPort: number | null;
  imapUser: string;
  imapPassword: string;
  imapEncryption: MailEncryption;
}

/**
 * Sensible port for the chosen encryption, so the user rarely has to think
 * about it: 465 is implicit TLS ("SSL"), 587 is submission with STARTTLS,
 * 25 is unencrypted relay. IMAP is 993 vs 143 on the same logic.
 */
export function defaultPort(protocol: 'smtp' | 'imap', encryption: MailEncryption): number {
  if (protocol === 'smtp') {
    return encryption === 'ssl' ? 465 : encryption === 'tls' ? 587 : 25;
  }
  return encryption === 'none' ? 143 : 993;
}

function toEncryption(value: string | undefined, fallback: MailEncryption): MailEncryption {
  return value === 'tls' || value === 'ssl' || value === 'none' ? value : fallback;
}

/**
 * Load the mail configuration.
 *
 * Returns `null` when sending is not configured — host, user and a from
 * address are the minimum that lets an app actually send. Receiving is
 * reported as empty rather than missing, because it is genuinely optional and
 * a caller that only sends should not be blocked by its absence.
 */
export async function getMailConfig(): Promise<MailConfig | null> {
  const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
    Object.values(MAIL_SETTINGS_KEYS),
  ]);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const smtpHost = values[MAIL_SETTINGS_KEYS.smtpHost] ?? '';
  const smtpUser = values[MAIL_SETTINGS_KEYS.smtpUser] ?? '';
  const fromAddress = values[MAIL_SETTINGS_KEYS.fromAddress] ?? '';
  if (!smtpHost || !smtpUser || !fromAddress) {
    return null;
  }

  const smtpEncryption = toEncryption(values[MAIL_SETTINGS_KEYS.smtpEncryption], 'tls');
  const imapEncryption = toEncryption(values[MAIL_SETTINGS_KEYS.imapEncryption], 'ssl');
  const smtpPort = Number.parseInt(values[MAIL_SETTINGS_KEYS.smtpPort] ?? '', 10);
  const imapPort = Number.parseInt(values[MAIL_SETTINGS_KEYS.imapPort] ?? '', 10);
  const imapHost = values[MAIL_SETTINGS_KEYS.imapHost] ?? '';

  return {
    smtpHost,
    smtpPort: Number.isFinite(smtpPort) ? smtpPort : defaultPort('smtp', smtpEncryption),
    smtpUser,
    smtpPassword: values[MAIL_SETTINGS_KEYS.smtpPassword] ?? '',
    smtpEncryption,
    fromAddress,
    fromName: values[MAIL_SETTINGS_KEYS.fromName] ?? '',
    imapHost,
    // Null rather than a default when there is no IMAP host at all — an app
    // must be able to tell "not configured" from "configured on 993".
    imapPort: imapHost ? (Number.isFinite(imapPort) ? imapPort : defaultPort('imap', imapEncryption)) : null,
    imapUser: values[MAIL_SETTINGS_KEYS.imapUser] ?? '',
    imapPassword: values[MAIL_SETTINGS_KEYS.imapPassword] ?? '',
    imapEncryption,
  };
}
