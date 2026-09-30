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
  /** true = configured, false = still needs an operator step. */
  done: boolean;
  /** Where in Settings to set it. */
  fixIn: string;
  /**
   * Raw, non-secret values for the frontend to interpolate into its own
   * translated label/detail (keyed by `id`, in `settings.deployment.check.*`)
   * — never prose, so the checklist has no English-only or console-flavoured
   * text baked into it (plan.md §787).
   */
  params: Record<string, string | number>;
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
      done: has(EXPOSURE_SETTINGS_KEYS.baseDomain),
      params: has(EXPOSURE_SETTINGS_KEYS.baseDomain) ? { domain: s[EXPOSURE_SETTINGS_KEYS.baseDomain] } : {},
      fixIn: 'Networking',
    },
    {
      id: 'cloudflare-token',
      done: has(CLOUDFLARE_TOKEN_KEY),
      params: {},
      fixIn: 'Networking',
    },
    {
      id: 'tunnel',
      done:
        has(EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId) &&
        has(EXPOSURE_SETTINGS_KEYS.cloudflareAccountId) &&
        has(EXPOSURE_SETTINGS_KEYS.cloudflareZoneId),
      params: has(EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId)
        ? { tunnelIdPrefix: s[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId].slice(0, 8) }
        : {},
      fixIn: 'Networking',
    },
    {
      id: 'npm',
      done: has(EXPOSURE_SETTINGS_KEYS.npmEmail) && has(EXPOSURE_SETTINGS_KEYS.npmPassword),
      params: has(EXPOSURE_SETTINGS_KEYS.npmEmail) ? { email: s[EXPOSURE_SETTINGS_KEYS.npmEmail] } : {},
      fixIn: 'Networking',
    },
    {
      id: 'mail',
      done: mail !== null,
      params: mail ? { fromAddress: mail.fromAddress, smtpHost: mail.smtpHost } : {},
      fixIn: 'Email',
    },
    {
      id: 'backup',
      done: backup !== null,
      params: backup ? { kind: backup.kind, ...(backup.server ? { server: backup.server } : {}) } : {},
      fixIn: 'Backup destination',
    },
    {
      id: 'admin',
      done: Boolean(admin?.email),
      params: admin?.email ? { username: admin.username, email: admin.email, userCount } : {},
      fixIn: 'Users page',
    },
  ];

  return { checks, outstanding: checks.filter((c) => !c.done).length };
}
