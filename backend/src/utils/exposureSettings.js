'use strict';

const { query } = require('./database');

const KEYS = {
  baseDomain: 'exposure_base_domain',
  npmApiUrl: 'exposure_npm_api_url',
  npmEmail: 'exposure_npm_email',
  npmPassword: 'exposure_npm_password',
  cloudflareAccountId: 'exposure_cloudflare_account_id',
  cloudflareZoneId: 'exposure_cloudflare_zone_id',
  cloudflareTunnelId: 'exposure_cloudflare_tunnel_id',
};

const CLOUDFLARE_TOKEN_KEY = 'cloudflare_tunnel_token';

/**
 * Load the global first-start exposure provisioning configuration, plus the
 * Cloudflare API token that is already stored for tunnel management.
 * Returns `null` if any required field is missing.
 */
async function getExposureConfig() {
  const result = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    [...Object.values(KEYS), CLOUDFLARE_TOKEN_KEY],
  ]);
  const values = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));

  const config = {
    baseDomain: values[KEYS.baseDomain] ?? null,
    npmApiUrl: values[KEYS.npmApiUrl] ?? null,
    npmEmail: values[KEYS.npmEmail] ?? null,
    npmPassword: values[KEYS.npmPassword] ?? null,
    cloudflareAccountId: values[KEYS.cloudflareAccountId] ?? null,
    cloudflareZoneId: values[KEYS.cloudflareZoneId] ?? null,
    cloudflareTunnelId: values[KEYS.cloudflareTunnelId] ?? null,
    cloudflareApiToken: values[CLOUDFLARE_TOKEN_KEY] ?? null,
  };

  const isComplete = Object.values(config).every((value) => Boolean(value));
  return isComplete ? config : null;
}

module.exports = { getExposureConfig, EXPOSURE_SETTINGS_KEYS: KEYS };
