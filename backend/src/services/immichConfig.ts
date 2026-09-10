/**
 * Immich logs in against Authelia's OIDC provider (plan.md §270/§275), but
 * unlike Vikunja/Mealie it has **no OIDC environment variables** — its
 * OAuth settings live either in the admin UI (the database) or in a JSON
 * config file pointed at by `IMMICH_CONFIG_FILE`. The UI path can't be
 * automated without driving the browser, so this writes the file.
 *
 * Immich merges the file over its built-in defaults (`buildConfig` in
 * `server/src/utils/config.ts`), so a partial file carrying only `oauth` +
 * `passwordLogin` is valid — every other setting falls back to the Immich
 * default. Two consequences worth knowing:
 *
 *  - While the file is present Immich's admin settings UI is **read-only**
 *    ("configured via a config file"), and any setting a user had changed in
 *    the UI reverts to the Immich default until exposure is turned back off.
 *  - So the file is only written while Immich is exposed, and removed the
 *    moment it isn't — a non-exposed Immich behaves exactly as before.
 *
 * `IMMICH_CONFIG_FILE` itself is injected only on an exposed start (the
 * `staticOnExposure` key in the registry); the compose default is empty, which
 * Immich treats as "no config file". This runs in the executor's pre-start
 * block, before `docker compose up`, so the file is in place for the start
 * that reads it.
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { buildExposureHostname } from '../config/services';
import { parseEnvFile } from '../utils/envFile';
import { getExposureConfig } from '../utils/exposureSettings';
import { getServiceExposureRow } from './exposure';

/** The app's own `.env` key holding the generated OIDC client secret. */
const CLIENT_SECRET_KEY = 'IMMICH_OIDC_CLIENT_SECRET';
/** Inert compose passthrough — read here, not by the container — for the
 *  config-panel toggle that drops Immich's own email/password form. */
const PASSWORD_LOGIN_KEY = 'IMMICH_PASSWORD_LOGIN_ENABLED';

/** Where the generated file lands; the compose file bind-mounts `data/config`
 *  to `/config` and `IMMICH_CONFIG_FILE` points at `/config/immich.json`. */
export function immichConfigPath(appDir: string): string {
  return path.join(appDir, 'data', 'config', 'immich.json');
}

export interface ImmichConfigInput {
  hostname: string;
  issuer: string;
  clientSecret: string;
  passwordLoginEnabled: boolean;
}

/**
 * The partial Immich system config: OAuth against Authelia, plus the
 * password-login toggle. `mobileOverrideEnabled` routes the mobile app through
 * Immich's own `/api/oauth/mobile-redirect` bridge so Authelia only needs
 * `https://` redirect URIs (no `app.immich:///` custom scheme). Immich's
 * default `tokenEndpointAuthMethod` is `client_secret_post`, which matches the
 * Authelia client the §270 sync registers.
 */
export function renderImmichConfig(input: ImmichConfigInput): Record<string, unknown> {
  return {
    oauth: {
      enabled: true,
      issuerUrl: `${input.issuer}/.well-known/openid-configuration`,
      clientId: 'immich',
      clientSecret: input.clientSecret,
      scope: 'openid email profile',
      buttonText: 'Login with Authelia',
      autoRegister: true,
      autoLaunch: false,
      mobileOverrideEnabled: true,
      mobileRedirectUri: `https://${input.hostname}/api/oauth/mobile-redirect`,
      tokenEndpointAuthMethod: 'client_secret_post',
    },
    passwordLogin: {
      enabled: input.passwordLoginEnabled,
    },
  };
}

/**
 * Write `immich.json` when Immich is exposed and its client secret exists;
 * remove it otherwise. No-op for every other service. Non-fatal on error —
 * Immich still starts, it just won't show the Authelia button.
 */
export async function applyImmichConfig(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== 'immich') {
    return;
  }

  const configPath = immichConfigPath(appDir);

  try {
    const exposureRow = await getServiceExposureRow('immich');
    const globalConfig = await getExposureConfig();

    if (!exposureRow?.enabled || !globalConfig) {
      if (fs.existsSync(configPath)) {
        fs.rmSync(configPath);
        logger.info('Removed managed immich.json (Immich not exposed)');
      }
      return;
    }

    const envPath = path.join(appDir, '.env');
    const envValues = fs.existsSync(envPath) ? parseEnvFile(envPath) : {};
    const clientSecret = envValues[CLIENT_SECRET_KEY] ?? '';
    if (!clientSecret) {
      logger.warn(
        `immich.json not written: ${CLIENT_SECRET_KEY} is unset — save Immich's config once to generate it`
      );
      return;
    }

    const config = renderImmichConfig({
      hostname: buildExposureHostname('immich', globalConfig.baseDomain),
      issuer: `https://${buildExposureHostname('authelia', globalConfig.baseDomain)}`,
      clientSecret,
      // Left enabled unless an admin explicitly turned it off — a misconfigured
      // IdP must not be able to lock everyone out.
      passwordLoginEnabled: (envValues[PASSWORD_LOGIN_KEY] ?? 'true').trim().toLowerCase() !== 'false',
    });

    const next = JSON.stringify(config, null, 2) + '\n';
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    if (!fs.existsSync(configPath) || fs.readFileSync(configPath, 'utf8') !== next) {
      fs.writeFileSync(configPath, next, { mode: 0o644 });
      logger.info('Wrote managed immich.json for Authelia OIDC');
    }
  } catch (error) {
    logger.error('Failed to apply immich.json', { error: (error as Error).message });
  }
}
