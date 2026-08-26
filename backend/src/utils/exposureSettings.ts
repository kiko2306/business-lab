import { query } from './database';
import { ExposureGlobalConfig } from '../types';

export const EXPOSURE_SETTINGS_KEYS = {
  baseDomain: 'exposure_base_domain',
  npmApiUrl: 'exposure_npm_api_url',
  npmEmail: 'exposure_npm_email',
  npmPassword: 'exposure_npm_password',
  cloudflareAccountId: 'exposure_cloudflare_account_id',
  cloudflareZoneId: 'exposure_cloudflare_zone_id',
  cloudflareTunnelId: 'exposure_cloudflare_tunnel_id',
} as const;

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';

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
    npmApiUrl: values[EXPOSURE_SETTINGS_KEYS.npmApiUrl] ?? '',
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
