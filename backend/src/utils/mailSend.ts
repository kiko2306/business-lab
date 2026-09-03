/**
 * Sends a message through the dashboard's shared mailbox (plan.md §158).
 *
 * `services/mailTest.ts` only *checks* the connection — dependency-free raw
 * sockets, and it deliberately stops short of a real STARTTLS upgrade. An
 * actual send (invite emails) needs the full client, so this leans on
 * `nodemailer` rather than reimplementing SMTP.
 */

import nodemailer from 'nodemailer';
import { getMailConfig, MailConfig } from './mailSettings';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

function transportFor(config: MailConfig): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    // 465 is implicit TLS; 587/25 start plain and upgrade via STARTTLS.
    secure: config.smtpEncryption === 'ssl',
    requireTLS: config.smtpEncryption === 'tls',
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
  });
}

function fromHeader(config: MailConfig): string {
  return config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;
}

/**
 * Send one plain-text message. Throws if the mailbox isn't configured or the
 * SMTP conversation fails — callers that must not fail on a mail error catch
 * it and surface a warning instead.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const config = await getMailConfig();
  if (!config) {
    throw new Error('The shared mailbox is not configured.');
  }
  const transport = transportFor(config);
  try {
    await transport.sendMail({
      from: fromHeader(config),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  } finally {
    transport.close();
  }
}

/** Whether a message could be sent at all — i.e. the mailbox is set up. */
export async function mailIsConfigured(): Promise<boolean> {
  return (await getMailConfig()) !== null;
}
