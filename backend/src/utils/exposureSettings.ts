import path from 'path';
import fs from 'fs';
import { query } from './database';
import { ExposureGlobalConfig } from '../types';
import { getHostGatewayIp } from './network';
import { parseEnvFile } from './envFile';

export const EXPOSURE_SETTINGS_KEYS = {
  baseDomain: 'exposure_base_domain',
  npmEmail: 'exposure_npm_email',
  npmPassword: 'exposure_npm_password',
  cloudflareAccountId: 'exposure_cloudflare_account_id',
  cloudflareZoneId: 'exposure_cloudflare_zone_id',
  cloudflareTunnelId: 'exposure_cloudflare_tunnel_id',
} as const;

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';

/**
 * NPM's admin API port, from its own .env (same value its compose file
 * publishes). Falls back to the allocator's default for NPM_ADMIN_PORT.
 */
function getNpmAdminPort(): string {
  try {
    const envPath = path.join(process.cwd(), 'apps', 'nginx-proxy-manager', '.env');
    if (fs.existsSync(envPath)) {
      const port = parseEnvFile(envPath)['NPM_ADMIN_PORT'];
      if (port && /^\d+$/.test(port)) return port;
    }
  } catch {
    // A missing or unreadable .env must not break provisioning.
  }
  return '10270';
}

/**
 * The NPM admin API URL is derived, never stored: the docker bridge gateway
 * is reachable from both the backend container and cloudflared on the host,
 * and — unlike a LAN IP — does not move when the machine changes networks.
 * Storing it as hand-editable free text let a stale LAN IP survive reboots
 * and 502 every public hostname once that IP was reassigned (plan.md §252).
 */
export async function getNpmApiUrl(): Promise<string> {
  return `http://${await getHostGatewayIp()}:${getNpmAdminPort()}`;
}

/**
 * Load the global first-start exposure provisioning configuration, plus the
 * Cloudflare API token that is already stored for tunnel management.
 * Returns `null` if any required field is missing.
 */
export async function getExposureConfig(): Promise<ExposureGlobalConfig | null> {
  const result = await query<{ key: string; value: string }>('SELECT key, value FROM settings WHERE key = ANY($1)', [
    [...Object.values(EXPOSURE_SETTINGS_KEYS), CLOUDFLARE_TOKEN_KEY],
  ]);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const config: ExposureGlobalConfig = {
    baseDomain: values[EXPOSURE_SETTINGS_KEYS.baseDomain] ?? '',
    npmApiUrl: await getNpmApiUrl(),
    npmEmail: values[EXPOSURE_SETTINGS_KEYS.npmEmail] ?? '',
    npmPassword: values[EXPOSURE_SETTINGS_KEYS.npmPassword] ?? '',
    cloudflareAccountId: values[EXPOSURE_SETTINGS_KEYS.cloudflareAccountId] ?? '',
    cloudflareZoneId: values[EXPOSURE_SETTINGS_KEYS.cloudflareZoneId] ?? '',
    cloudflareTunnelId: values[EXPOSURE_SETTINGS_KEYS.cloudflareTunnelId] ?? '',
    cloudflareApiToken: values[CLOUDFLARE_TOKEN_KEY] ?? '',
  };

  const isComplete = Object.values(config).every((value) => Boolean(value));
  return isComplete ? config : null;
}
