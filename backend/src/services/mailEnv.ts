/**
 * Feeds the global mail settings into each app's environment at start time.
 *
 * Same shape as exposureEnv: a service declares which of *its* env var names
 * mean "SMTP host", "IMAP password" and so on, and the values are injected as
 * process env for `docker compose up`. The app's own `.env` keeps whatever
 * default it shipped with, so turning mail settings off reverts cleanly and
 * nothing is written to disk that would later go stale.
 *
 * The point is that credentials live in exactly one place. Without this, every
 * app that sends email needs the same host/user/password pasted into its own
 * config, and rotating the mailbox password means editing all of them.
 */

import { getService } from '../config/services';
import { getMailConfig, MailEncryption } from '../utils/mailSettings';
import logger from '../utils/logger';

function assign(
  overrides: Record<string, string>,
  keys: string[] | undefined,
  value: string | number | null
): void {
  if (!keys || value === null || value === '') return;
  for (const key of keys) {
    overrides[key] = String(value);
  }
}

/**
 * Build the mail-related env overrides for a service.
 *
 * Returns `{}` — never throws — when the service declares no mail keys or
 * mail isn't configured. Mail being unset must not stop an app starting; it
 * just starts without email, which is exactly what happens today.
 */
export async function buildMailEnvOverrides(serviceName: string): Promise<Record<string, string>> {
  const keys = getService(serviceName)?.mailEnvKeys;
  if (!keys) return {};

  let config;
  try {
    config = await getMailConfig();
  } catch (error) {
    logger.warn(`Unable to read mail settings for ${serviceName}`, { error: (error as Error).message });
    return {};
  }
  if (!config) return {};

  const overrides: Record<string, string> = {};

  assign(overrides, keys.smtpHost, config.smtpHost);
  assign(overrides, keys.smtpPort, config.smtpPort);
  assign(overrides, keys.smtpUser, config.smtpUser);
  assign(overrides, keys.smtpPassword, config.smtpPassword);
  assign(overrides, keys.smtpEncryption, keys.smtpEncryptionMap?.[config.smtpEncryption] ?? config.smtpEncryption);
  assign(overrides, keys.smtpTlsBoolean, encryptionToBoolean(config.smtpEncryption));
  assign(overrides, keys.fromAddress, config.fromAddress);
  assign(overrides, keys.fromName, config.fromName);

  // Receiving is optional and independent: an install may send mail without
  // ever fetching it, so these are only set when an IMAP host actually exists.
  if (config.imapHost) {
    assign(overrides, keys.imapHost, config.imapHost);
    assign(overrides, keys.imapPort, config.imapPort);
    assign(overrides, keys.imapUser, config.imapUser);
    assign(overrides, keys.imapPassword, config.imapPassword);
    assign(overrides, keys.imapEncryption, config.imapEncryption);
  }

  for (const [key, value] of Object.entries(keys.staticWhenConfigured ?? {})) {
    overrides[key] = String(value);
  }

  return overrides;
}

/** 'none' is the only case that isn't encrypted; both tls and ssl are. */
function encryptionToBoolean(encryption: MailEncryption): string {
  return encryption === 'none' ? 'false' : 'true';
}
