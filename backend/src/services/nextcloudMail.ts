/**
 * Copy the dashboard's global mail settings into Nextcloud's own SMTP config
 * (§402 — one of Nextcloud's own admin-panel warnings: an error log entry for
 * "Connection refused" against 127.0.0.1:25, because Nextcloud had zero
 * `mail_smtp*` config and fell back to a local sendmail that doesn't exist in
 * this stack). Same shape as itflowMailCron.ts — the values travel through
 * `getenv()`-backed shell variables, never interpolated into the script text,
 * mirroring how the OnlyOffice/SAML wiring keeps their own secrets off the
 * command line.
 *
 * Runs after `docker compose up` on every Nextcloud start (occ needs the
 * database). No-op when no dashboard mail account is configured yet — that's
 * a missing feature, not a broken Nextcloud (the app still runs fine with no
 * outgoing mail).
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getMailConfig, MailConfig, MailEncryption } from '../utils/mailSettings';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';

/** Nextcloud's mail_smtpsecure only accepts '', 'ssl' or 'tls' — 'none' maps to empty. */
function toNextcloudSecure(value: MailEncryption): string {
  return value === 'none' ? '' : value;
}

/**
 * Nextcloud stores the from-address as `mail_from_address` (local part only)
 * + `mail_domain`, joined back together at send time — unlike the dashboard's
 * single full-address field every other app here takes as-is.
 */
function splitFromAddress(address: string): { local: string; domain: string } {
  const at = address.indexOf('@');
  return at === -1 ? { local: address, domain: '' } : { local: address.slice(0, at), domain: address.slice(at + 1) };
}

/** Exported for the unit test. */
export function buildMailScript(mail: MailConfig | null): string[] {
  if (!mail) {
    return ['echo "hlm: no dashboard mail settings configured yet; skipping SMTP"'];
  }
  return [
    'php occ config:system:set mail_smtpmode --value="smtp"',
    'php occ config:system:set mail_smtpsecure --value="$MAIL_SMTP_SECURE"',
    'php occ config:system:set mail_smtphost --value="$MAIL_SMTP_HOST"',
    'php occ config:system:set mail_smtpport --value="$MAIL_SMTP_PORT"',
    'php occ config:system:set mail_smtpauth --type boolean --value="$MAIL_SMTP_AUTH"',
    'php occ config:system:set mail_smtpname --value="$MAIL_SMTP_USER"',
    'php occ config:system:set mail_smtppassword --value="$MAIL_SMTP_PASSWORD"',
    'php occ config:system:set mail_from_address --value="$MAIL_FROM_LOCAL"',
    'php occ config:system:set mail_domain --value="$MAIL_FROM_DOMAIN"',
    'echo "hlm: mail settings copied from the dashboard"',
  ];
}

/** Env vars the script above reads via shell expansion — only set when there's mail config to copy. */
function buildEnv(mail: MailConfig): Record<string, string> {
  const { local, domain } = splitFromAddress(mail.fromAddress);
  return {
    MAIL_SMTP_HOST: mail.smtpHost,
    MAIL_SMTP_PORT: String(mail.smtpPort),
    MAIL_SMTP_SECURE: toNextcloudSecure(mail.smtpEncryption),
    MAIL_SMTP_AUTH: mail.smtpUser ? 'true' : 'false',
    MAIL_SMTP_USER: mail.smtpUser,
    MAIL_SMTP_PASSWORD: mail.smtpPassword,
    MAIL_FROM_LOCAL: local,
    MAIL_FROM_DOMAIN: domain,
  };
}

/**
 * Reconcile Nextcloud's SMTP config on a Nextcloud start. No-op for every
 * other service. Never throws.
 */
export async function reconcileNextcloudMail(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }
  if (!resolveComposeFile(NEXTCLOUD_SERVICE)?.composeFile) {
    return;
  }

  try {
    const mail = await getMailConfig();
    const env = mail ? buildEnv(mail) : {};

    const result = await runNextcloudOccScript(buildMailScript(mail), {
      env: { ...process.env, ...env },
      passEnv: Object.keys(env),
    });

    // Belt-and-braces: keep the secret out of the log even if a future PHP
    // error happened to echo it back verbatim.
    const secrets = mail ? [mail.smtpPassword].filter(Boolean) : [];
    const safeOutput = secrets.reduce((out, secret) => out.split(secret).join('***'), result.output);

    logger.info('Nextcloud mail settings reconciled', {
      mailConfigured: Boolean(mail),
      ok: result.ok,
      output: safeOutput || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to reconcile Nextcloud mail settings', { error: (error as Error).message });
  }
}
