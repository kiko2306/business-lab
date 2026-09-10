/**
 * P9a (plan.md §357) — the per-client provisioning checklist.
 *
 * Everything a turnkey box needs set is already configurable (start.sh
 * prompts, the Settings page, /setup) — what was missing is one read-only
 * view telling an operator provisioning box #5 *what is still blank*. This
 * derives that list from the same settings/config the individual Settings
 * sections read; it never writes anything and never calls a third party
 * (the per-section "Test" buttons stay the way to prove a value live).
 */

import { query } from '../utils/database';
import { EXPOSURE_SETTINGS_KEYS } from '../utils/exposureSettings';
import { getMailConfig } from '../utils/mailSettings';
import { getBackupTarget } from '../utils/backupTarget';
import { getAutheliaAdminUser, listAutheliaUsernames } from './autheliaUsers';

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';

export interface DeploymentCheck {
  id: string;
  label: string;
  /** true = configured, false = still needs an operator step. */
  done: boolean;
  /** One line: the current value/state, safe to show (no secrets). */
  detail: string;
  /** Where in Settings to set it. */
  fixIn: string;
}

export interface DeploymentStatus {
  checks: DeploymentCheck[];
  /** Convenience for the header: how many are still outstanding. */
  outstanding: number;
}

export async function getDeploymentStatus(): Promise<DeploymentStatus> {
  const keys = [...Object.values(EXPOSURE_SETTINGS_KEYS), CLOUDFLARE_TOKEN_KEY];
  const rows = await query<{ key: string; value: string }>(
    'SELECT key, value FROM settings WHERE key = ANY($1)',
    [keys]
  );
  const s = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
  const has = (k: string) => Boolean(s[k] && s[k].trim());

  const [mail, backup] = await Promise.all([getMailConfig(), getBackupTarget()]);
  const admin = getAutheliaAdminUser();
  const userCount = listAutheliaUsernames().length;

  const checks: DeploymentCheck[] = [
    {
      id: 'domain',
      label: 'Base domain',
      done: has(EXPOSURE_SETTINGS_KEYS.baseDomain),
      detail: has(EXPOSURE_SETTINGS_KEYS.baseDomain)
        ? s[EXPOSURE_SETTINGS_KEYS.baseDomain]
        : 'Not set',
      fixIn: 'Networking',
    },
    {
      id: 'cloudflare-token',
      label: 'Cloudflare API token',
      done: has(CLOUDFLARE_TOKEN_KEY),
      detail: has(CLOUDFLARE_TOKEN_KEY) ? 'Stored (use Test to verify)' : 'Not set',
      fixIn: 'Networking',
    },
    {
      id: 'tunnel',
      label: 'Cloudflare Tunnel',
      done:
        has(EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId) &&
        has(EXPOSURE_SETTINGS_KEYS.cloudflareAccountId) &&
        has(EXPOSURE_SETTINGS_KEYS.cloudflareZoneId),
      detail: has(EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId)
        ? `Tunnel ${s[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId].slice(0, 8)}…`
        : 'Not provisioned — run start.sh with the token set',
      fixIn: 'Networking',
    },
    {
      id: 'npm',
      label: 'Proxy admin credentials',
      done: has(EXPOSURE_SETTINGS_KEYS.npmEmail) && has(EXPOSURE_SETTINGS_KEYS.npmPassword),
      detail: has(EXPOSURE_SETTINGS_KEYS.npmEmail)
        ? s[EXPOSURE_SETTINGS_KEYS.npmEmail]
        : 'Not set',
      fixIn: 'Networking',
    },
    {
      id: 'mail',
      label: 'Email (shared mailbox)',
      done: mail !== null,
      detail: mail ? `${mail.fromAddress} via ${mail.smtpHost}` : 'Not configured',
      fixIn: 'Email',
    },
    {
      id: 'backup',
      label: 'Backup destination',
      done: backup !== null,
      detail: backup ? `${backup.kind}${backup.server ? ` — ${backup.server}` : ''}` : 'Not configured',
      fixIn: 'Backup destination',
    },
    {
      id: 'admin',
      label: 'Administrator account',
      done: Boolean(admin?.email),
      detail: admin?.email
        ? `${admin.username} <${admin.email}> · ${userCount} user${userCount === 1 ? '' : 's'} total`
        : 'Not created — open /setup',
      fixIn: 'Users page',
    },
  ];

  return { checks, outstanding: checks.filter((c) => !c.done).length };
}
