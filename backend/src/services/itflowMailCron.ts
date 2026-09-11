/**
 * Automate ITFlow's two post-wizard, by-hand steps (`app-credentials.md`
 * "ITFlow — two things to do after the wizard", plan.md §62.1): copy the
 * dashboard's global mail settings into ITFlow's own database, and flip its
 * master cron switch on. Both fail *silently* if left undone — outgoing
 * mail just never sends, and email-to-ticket / the mail queue / recurring
 * invoices never run.
 *
 * ITFlow has no environment-variable support for either — they live in its
 * `settings` table (one row, `company_id = 1`), written only by its own PHP
 * (`admin/post/settings_mail.php`, `admin/post/cron.php`). Reconciled here
 * via `itflowDb.ts` — prepared statements over `$mysqli` (config.php's own
 * connection), so there's no hand-rolled SQL escaping.
 *
 * Cron's *individual* jobs (Maintenance -> Cron) default
 * `cron_job_enabled = 1` in ITFlow's own schema — only the master switch
 * (`config_enable_cron`, moved out of Settings -> Notifications as of
 * ITFlow 26.08 into Maintenance -> Cron) needs setting, so that's the only
 * cron write here.
 *
 * Runs after `docker compose up` on every ITFlow start, right after
 * `reconcileItflowFirstAdmin` (§350) — the `settings` row this writes to
 * only exists once that wizard has run; until then `config.php` itself
 * doesn't exist and the script fails with an obvious, self-describing
 * `require(): Failed opening required` rather than a silent no-op, and
 * retries on the next start. No-op for every other service. Never fatal —
 * missing mail/cron config is a missing feature, not a broken ITFlow.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { getMailConfig, MailConfig, MailEncryption } from '../utils/mailSettings';
import { runItflowDbScript } from './itflowDb';

const ITFLOW_SERVICE = 'itflow';

/** ITFlow's SMTP/IMAP encryption dropdowns only offer tls/ssl/(blank) — 'none' maps to blank. */
function toItflowEncryption(value: MailEncryption): string {
  return value === 'none' ? '' : value;
}

/**
 * The PHP lines that run after `config.php` (so `$mysqli` is live). Secret
 * and free-text values travel through `getenv()` — never interpolated into
 * the script text — and land in real bound parameters, not string-built
 * SQL. Exported for the unit test.
 */
export function buildMailCronScript(mail: MailConfig | null): string[] {
  const lines: string[] = [
    '$mysqli->query("UPDATE settings SET config_enable_cron = 1 WHERE company_id = 1");',
    'echo "hlm: cron enabled\\n";',
  ];

  if (!mail) {
    lines.push('echo "hlm: no dashboard mail settings configured yet; skipping SMTP/IMAP\\n";');
    return lines;
  }

  lines.push(
    "$smtp_host = getenv('ITFLOW_SMTP_HOST');",
    "$smtp_port = (int) getenv('ITFLOW_SMTP_PORT');",
    "$smtp_encryption = getenv('ITFLOW_SMTP_ENCRYPTION');",
    "$smtp_user = getenv('ITFLOW_SMTP_USER');",
    "$smtp_password = getenv('ITFLOW_SMTP_PASSWORD');",
    "$from_email = getenv('ITFLOW_FROM_EMAIL');",
    "$from_name = getenv('ITFLOW_FROM_NAME');",
    '$stmt = $mysqli->prepare("UPDATE settings SET config_smtp_provider = \'standard_smtp\', ' +
      'config_smtp_host = ?, config_smtp_port = ?, config_smtp_encryption = ?, ' +
      'config_smtp_username = ?, config_smtp_password = ?, config_mail_from_email = ?, ' +
      'config_mail_from_name = ? WHERE company_id = 1");',
    '$stmt->bind_param("sisssss", $smtp_host, $smtp_port, $smtp_encryption, $smtp_user, $smtp_password, $from_email, $from_name);',
    '$stmt->execute();',
    'echo "hlm: SMTP settings copied from the dashboard\\n";'
  );

  if (mail.imapHost) {
    lines.push(
      "$imap_host = getenv('ITFLOW_IMAP_HOST');",
      "$imap_port = (int) getenv('ITFLOW_IMAP_PORT');",
      "$imap_encryption = getenv('ITFLOW_IMAP_ENCRYPTION');",
      "$imap_user = getenv('ITFLOW_IMAP_USER');",
      "$imap_password = getenv('ITFLOW_IMAP_PASSWORD');",
      '$stmt2 = $mysqli->prepare("UPDATE settings SET config_imap_provider = \'standard_imap\', ' +
        'config_imap_host = ?, config_imap_port = ?, config_imap_encryption = ?, ' +
        'config_imap_username = ?, config_imap_password = ? WHERE company_id = 1");',
      '$stmt2->bind_param("sisss", $imap_host, $imap_port, $imap_encryption, $imap_user, $imap_password);',
      '$stmt2->execute();',
      'echo "hlm: IMAP settings copied from the dashboard\\n";'
    );
  }

  return lines;
}

/** Env vars the script above reads via getenv() — only set when there's mail config to copy. */
function buildEnv(mail: MailConfig): Record<string, string> {
  const env: Record<string, string> = {
    ITFLOW_SMTP_HOST: mail.smtpHost,
    ITFLOW_SMTP_PORT: String(mail.smtpPort),
    ITFLOW_SMTP_ENCRYPTION: toItflowEncryption(mail.smtpEncryption),
    ITFLOW_SMTP_USER: mail.smtpUser,
    ITFLOW_SMTP_PASSWORD: mail.smtpPassword,
    ITFLOW_FROM_EMAIL: mail.fromAddress,
    ITFLOW_FROM_NAME: mail.fromName,
  };
  if (mail.imapHost) {
    env.ITFLOW_IMAP_HOST = mail.imapHost;
    env.ITFLOW_IMAP_PORT = String(mail.imapPort ?? '');
    env.ITFLOW_IMAP_ENCRYPTION = toItflowEncryption(mail.imapEncryption);
    env.ITFLOW_IMAP_USER = mail.imapUser;
    env.ITFLOW_IMAP_PASSWORD = mail.imapPassword;
  }
  return env;
}

/**
 * Reconcile ITFlow's mail + cron settings on an ITFlow start. No-op for
 * every other service. Never throws.
 */
export async function reconcileItflowMailCron(serviceName: string): Promise<void> {
  if (serviceName !== ITFLOW_SERVICE) {
    return;
  }
  if (!resolveComposeFile(ITFLOW_SERVICE)?.composeFile) {
    return;
  }

  try {
    const mail = await getMailConfig();
    const env = mail ? buildEnv(mail) : {};

    const result = await runItflowDbScript(buildMailCronScript(mail), {
      env: { ...process.env, ...env },
      passEnv: Object.keys(env),
    });

    // Belt-and-braces: keep any secret out of the log even if a future PHP
    // error happened to echo one back verbatim.
    const secrets = mail ? [mail.smtpPassword, mail.imapPassword].filter(Boolean) : [];
    const safeOutput = secrets.reduce((out, secret) => out.split(secret).join('***'), result.output);

    logger.info('ITFlow mail/cron settings reconciled', {
      mailConfigured: Boolean(mail),
      ok: result.ok,
      output: safeOutput || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to reconcile ITFlow mail/cron settings', { error: (error as Error).message });
  }
}
