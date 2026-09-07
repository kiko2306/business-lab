/**
 * Vikunja logs in against Authelia's OIDC provider (plan.md §270/§271), but its
 * OpenID *providers* can't be delivered by environment variables alone: Vikunja
 * only knows a provider exists if it is declared in a config file first
 * ("you must add at least one key to a config file if you want to read values
 * from an environment variable as the provider won't be known to Vikunja
 * otherwise" — vikunja.io/docs/config-options). With the provider set only via
 * `VIKUNJA_AUTH_OPENID_PROVIDERS_*` env, the login page shows no Authelia
 * button (proven live — §271 follow-up). So the whole OIDC block goes in a
 * managed `config.yml`, the same shape as Immich's managed `immich.json`
 * (§275).
 *
 * Vikunja auto-discovers `/etc/vikunja/config.yml` (search path #2), so no
 * pointer env var is needed — the compose file bind-mounts `data/config` there.
 * The file is only written while Vikunja is exposed and removed the moment it
 * isn't, so a non-exposed Vikunja behaves exactly as before. `auth.local` is
 * deliberately left out of the file: `VIKUNJA_AUTH_LOCAL_ENABLED` stays the
 * config-panel toggle (a scalar env var Vikunja honours fine), and a value in
 * the file would just be re-overridden by that env anyway.
 *
 * Runs in the executor's pre-start block, before `docker compose up`, so the
 * file is in place for the start that reads it.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { buildExposureHostname } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import { getExposureConfig } from '../utils/exposureSettings';
import { getServiceExposureRow } from './exposure';

/** The app's own `.env` key holding the generated OIDC client secret. */
const CLIENT_SECRET_KEY = 'VIKUNJA_OIDC_CLIENT_SECRET';

/** Where the generated file lands; the compose file bind-mounts `data/config`
 *  to `/etc/vikunja`, which is on Vikunja's config search path. */
export function vikunjaConfigPath(appDir: string): string {
  return path.join(appDir, 'data', 'config', 'config.yml');
}

export interface VikunjaConfigInput {
  publicUrl: string;
  issuer: string;
  clientSecret: string;
}

/**
 * The partial Vikunja config: OpenID against Authelia, keyed `authelia` so the
 * callback path is `<publicurl>/auth/openid/authelia` (matches the `vikunja`
 * Authelia client's redirect URI and the registry's `redirectPaths`).
 * `authurl` is Authelia's issuer base — Vikunja runs discovery against
 * `<authurl>/.well-known/openid-configuration` itself.
 */
export function renderVikunjaConfig(input: VikunjaConfigInput): string {
  // Hand-rendered: the block is fixed-shape and every value is a controlled
  // string (a URL, the literal client id, or a 64-char hex secret), so there is
  // nothing here that needs a YAML library to escape. Strings are single-quoted
  // defensively all the same.
  return [
    'auth:',
    '  openid:',
    '    enabled: true',
    `    redirecturl: '${input.publicUrl}/auth/openid/'`,
    '    providers:',
    '      authelia:',
    "        name: 'Authelia'",
    `        authurl: '${input.issuer}'`,
    "        clientid: 'vikunja'",
    `        clientsecret: '${input.clientSecret}'`,
    "        scope: 'openid profile email'",
    '',
  ].join('\n');
}

/**
 * Write `config.yml` when Vikunja is exposed and its client secret exists;
 * remove it otherwise. No-op for every other service. Non-fatal on error —
 * Vikunja still starts, it just won't show the Authelia button.
 */
export async function applyVikunjaConfig(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== 'vikunja') {
    return;
  }

  const configPath = vikunjaConfigPath(appDir);

  try {
    const exposureRow = await getServiceExposureRow('vikunja');
    const globalConfig = await getExposureConfig();

    if (!exposureRow?.enabled || !globalConfig) {
      if (fs.existsSync(configPath)) {
        fs.rmSync(configPath);
        logger.info('Removed managed vikunja config.yml (Vikunja not exposed)');
      }
      return;
    }

    const envPath = path.join(appDir, '.env');
    const envValues = fs.existsSync(envPath) ? parseEnvFile(envPath) : {};
    const clientSecret = envValues[CLIENT_SECRET_KEY] ?? '';
    if (!clientSecret) {
      logger.warn(
        `vikunja config.yml not written: ${CLIENT_SECRET_KEY} is unset — save Vikunja's config once to generate it`
      );
      return;
    }

    const next = renderVikunjaConfig({
      publicUrl: `https://${buildExposureHostname('vikunja', globalConfig.baseDomain)}`,
      issuer: `https://${buildExposureHostname('authelia', globalConfig.baseDomain)}`,
      clientSecret,
    });

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (!fs.existsSync(configPath) || fs.readFileSync(configPath, 'utf8') !== next) {
      fs.writeFileSync(configPath, next, { mode: 0o644 });
      logger.info('Wrote managed vikunja config.yml for Authelia OIDC');
    }
  } catch (error) {
    logger.error('Failed to apply vikunja config.yml', { error: (error as Error).message });
  }
}
