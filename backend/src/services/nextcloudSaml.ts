/**
 * Let Nextcloud trust Authelia's forward-auth headers instead of showing its
 * own login form on top of Authelia's (plan.md §216/§217). Nextcloud's
 * mechanism for this is the bundled `user_saml` app in **environment-variable
 * mode**: on every request it reads a `$_SERVER` key for the username and logs
 * that user in (auto-provisioning them if needed), the same "trust the proxy"
 * shape as Paperless's `PAPERLESS_ENABLE_HTTP_REMOTE_USER` (§247) and
 * Guacamole's `HTTP_AUTH_HEADER` (§200).
 *
 * NPM forwards Authelia's `Remote-User` / `Remote-Email` / `Remote-Name`
 * response headers upstream as request headers, which PHP exposes as
 * `HTTP_REMOTE_USER` etc. — that is what the mappings below point at.
 *
 * Gated behind `NEXTCLOUD_PROXY_HEADER_AUTH` (a config-panel toggle, default
 * off) **and** Nextcloud being exposed. Off, or not exposed, → `user_saml` is
 * disabled and Nextcloud behaves exactly as before. It ships off because the
 * NPM proxy host also needs Authelia's `authelia-authrequest.conf` snippet
 * applied before the header is actually present, and because a wrong mapping
 * would auto-provision junk accounts — so @mat applies the snippet, flips the
 * toggle, and proves it live (§217).
 *
 * Lockout recovery if the header path misbehaves: `https://<host>/login?direct=1`
 * always renders the normal username/password form, and the local admin
 * account still works there. Turning the toggle back off (or disabling
 * exposure) removes `user_saml` entirely on the next start.
 *
 * Runs after `docker compose up` on every Nextcloud start (occ needs the
 * database), through the shared nextcloudOcc scaffold. No-op for every other
 * service. Never fatal.
 */

import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { getServiceExposureRow } from './exposure';
import { runNextcloudOccScript } from './nextcloudOcc';

const NEXTCLOUD_SERVICE = 'nextcloud';
const TOGGLE_KEY = 'NEXTCLOUD_PROXY_HEADER_AUTH';

/**
 * occ lines that install + switch `user_saml` into environment-variable mode.
 * Idempotent — the app is only installed when absent, every `set` overwrites,
 * so this converges on every start. A `user_saml` install needs the Nextcloud
 * app store (network); if that fails the script exits 0 and the next start
 * retries.
 *
 * The attribute mappings live in the **provider config** (the
 * `user_saml_configurations` table), reached with `occ saml:config:set`, not
 * `occ config:app:set user_saml ...` (appconfig) — user_saml 6.x moved them
 * and the old keys are now dead writes nothing reads (found live: §330, the
 * env-mode login 500'd with "IDP parameter for the UID not found" while
 * `HTTP_REMOTE_USER` was right there in `$_SERVER`). Provider id **1** is
 * fixed: `SessionService::ENVIRONMENT_IDENTITY_PROVIDER_ID`. `saml:config:set`
 * upserts (`ConfigurationsMapper::set` → `insertOrUpdate`), so no create step.
 * `type` and `general-require_provisioned_account` are still appconfig.
 */
export function buildEnableScript(): string[] {
  return [
    'if ! php occ app:getpath user_saml >/dev/null 2>&1; then',
    '  if ! php occ app:install user_saml; then',
    '    echo "hlm: could not install user_saml (app store unreachable?); skipping"',
    '    exit 0',
    '  fi',
    'fi',
    'php occ app:enable user_saml >/dev/null',
    'php occ config:app:set user_saml type --value "environment-variable"',
    // Provider 1's attribute mappings — the $_SERVER keys Authelia's headers
    // land on once NPM forwards them.
    'php occ saml:config:set 1 ' +
      '--general-idp0_display_name="Authelia" ' +
      '--general-uid_mapping="HTTP_REMOTE_USER" ' +
      '--saml-attribute-mapping-email_mapping="HTTP_REMOTE_EMAIL" ' +
      '--saml-attribute-mapping-displayName_mapping="HTTP_REMOTE_NAME"',
    // 0 = auto-provision a Nextcloud account for any header identity Authelia
    // vouches for. 1 would require the account to pre-exist on another backend.
    'php occ config:app:set user_saml general-require_provisioned_account --value "0"',
    'echo "hlm: user_saml environment mode configured"',
  ];
}

/** occ lines that fully back the feature out — used when the toggle is off or
 *  Nextcloud isn't exposed. Idempotent: no-op when the app isn't present. */
export function buildDisableScript(): string[] {
  return [
    'if php occ app:getpath user_saml >/dev/null 2>&1; then',
    '  php occ app:disable user_saml >/dev/null 2>&1 || true',
    '  echo "hlm: user_saml disabled"',
    'else',
    '  echo "hlm: user_saml not installed; nothing to disable"',
    'fi',
  ];
}

/**
 * Reconcile `user_saml` on a Nextcloud start. No-op for every other service.
 * Never throws — a failure here is a missing SSO convenience, not a broken
 * Nextcloud (the normal login form still works).
 */
export async function reconcileNextcloudSaml(serviceName: string): Promise<void> {
  if (serviceName !== NEXTCLOUD_SERVICE) {
    return;
  }
  if (!resolveComposeFile(NEXTCLOUD_SERVICE)?.composeFile) {
    return;
  }

  try {
    const exposureRow = await getServiceExposureRow(NEXTCLOUD_SERVICE);
    const toggle = (readAppEnvValue(NEXTCLOUD_SERVICE, TOGGLE_KEY) ?? '').trim().toLowerCase();
    const wanted = Boolean(exposureRow?.enabled) && toggle === 'true';

    const result = await runNextcloudOccScript(wanted ? buildEnableScript() : buildDisableScript());
    logger.info(`Nextcloud user_saml reconciled (${wanted ? 'enabled' : 'disabled'})`, {
      ok: result.ok,
      output: result.output || '(no output)',
    });
  } catch (error) {
    logger.error('Failed to reconcile Nextcloud user_saml', { error: (error as Error).message });
  }
}
