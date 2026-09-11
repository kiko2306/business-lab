/**
 * Run ITFlow's first-run setup wizard on start, so there's no manual step and
 * no first-visitor-claims-admin race once ITFlow is exposed directly (§344).
 *
 * Same shape as docusealAdminBootstrap / immichAdminBootstrap: resolve the
 * cross-project base URL, poll for the webapp, drive the flow, best-effort
 * (never throws, never blocks the start). Runs after `docker compose up` on
 * every ITFlow start. Idempotent — once the wizard's telemetry step has run,
 * `setup/` 302s away and getSetupState reports `already-setup`.
 *
 * ITFlow can't use Authelia (OIDC-only) and can't hide its own form, and its
 * client portal must be public, so its own login is the only gate — the admin
 * account this creates (Authelia admin's email + generated
 * `ITFLOW_ADMIN_PASSWORD`) is it. Enable 2FA in ITFlow's own profile settings
 * afterwards.
 *
 * The image never creates the schema — the wizard's first step does, from the
 * DB credentials posted to it (§350). Those come from apps/itflow/.env
 * (`ITFLOW_DB_*`, same values the itflow-db container was created with); the
 * host is always the compose service name.
 *
 * The wizard's own admin-creation (`add_user`) only ever runs once —
 * `already-setup` short-circuits before it every start after. Found live
 * (2026-09-11): the very first bootstrap ran while the Authelia admin's
 * email was still the placeholder `admin@example.com` (§350's own proof),
 * and nothing ever re-synced it once the real email was set — a stale
 * identity forever, the same class of gap the Nextcloud admin-group
 * promotion (§377) fixed on the other side. So the `already-setup` branch
 * now also re-syncs `users.user_email`/`user_name` to the *current* Authelia
 * admin on every start via `itflowDb.ts` (PHP + mysqli through ITFlow's own
 * container, prepared statement) — `user_id = 1` is always that
 * wizard-created row, since `add_database` leaves `users` completely empty
 * and `add_user` is the very first insert into it, ever.
 *
 * Same gap, worse shape, for the password (§382 follow-up): ITFlow's login
 * password also unlocks a per-user AES key that wraps a site-wide
 * credential-encryption master key (`user_specific_encryption_ciphertext` —
 * see ITFlow's `functions/security.php`), so changing it correctly means
 * re-wrapping that master key, not just re-hashing. ITFlow's own "change
 * password" code can only do that from an active logged-in session (it
 * reads `$_SESSION`/`$_COOKIE`), which a cold reconciler doesn't have. Found
 * live: @mat changed `ITFLOW_ADMIN_PASSWORD` in the config panel, restarted,
 * and still couldn't log in — the new value sat in `.env` with nothing ever
 * pushing it into ITFlow's own `users` row. `reconcileAdminPassword` closes
 * that gap the only way that's actually correct without a session: detect
 * an out-of-sync password with `password_verify()` first (so a normal
 * restart, nothing changed, is a complete no-op) and, only then, reset both
 * the hash and the master key together — using ITFlow's own
 * `setupFirstUserSpecificKey()` (also required in), the same function its
 * wizard uses for a from-scratch account, since it needs no live session.
 * **This intentionally mirrors the wizard's own from-scratch path — it is
 * not a lossless "rewrap under a new password" (that needs the *old*
 * plaintext password, which a cold script never has either). A password
 * change here also **discards any credential ITFlow itself has encrypted**
 * (client passwords/API keys stored *inside* ITFlow, not the dashboard) —
 * acceptable on `tx-home-utils.com` (CLAUDE.md: data loss there is fine,
 * confirmed with @mat nothing was stored yet), but a real deployment
 * changing this password needs to know that trade-off going in.
 */

import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { getAppTimezone } from '../utils/generalSettings';
import { getAutheliaAdminUser } from './autheliaUsers';
import { getServiceExposureRow } from './exposure';
import { readAppEnvValue } from './appEnv';
import { getSetupState, runSetupWizard } from './itflowClient';
import { runItflowDbScript } from './itflowDb';

export const ITFLOW_SERVICE = 'itflow';
export const ITFLOW_ADMIN_PASSWORD_KEY = 'ITFLOW_ADMIN_PASSWORD';
const FALLBACK_PORT = 10420;
const COMPANY_NAME = 'Company';
// itflow-db is the compose service name; the app always reaches MariaDB there.
const DB_HOST = 'itflow-db';
// Match apps/itflow/.env.example defaults — the itflow-db container is created
// with these unless the operator changed them before the first start.
const DB_NAME_DEFAULT = 'itflow';
const DB_USER_DEFAULT = 'itflow';

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 3000;
// randomString() / setupFirstUserSpecificKey() — needed for reconcileAdminPassword,
// self-contained (no other requires, no session/cookie reads), safe to pull in
// on top of config.php's own $mysqli connection.
const SECURITY_FUNCTIONS_PATH = '/var/www/localhost/htdocs/functions/security.php';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveItflowBaseUrl(): Promise<string> {
  const port = getPublishedUpstreamPort(ITFLOW_SERVICE) ?? FALLBACK_PORT;
  const host = await getHostGatewayIp();
  return `http://${host}:${port}`;
}

export async function reconcileItflowFirstAdmin(serviceName: string): Promise<void> {
  if (serviceName !== ITFLOW_SERVICE) {
    return;
  }
  if (!resolveComposeFile(ITFLOW_SERVICE)?.composeFile) {
    return;
  }

  const exposureRow = await getServiceExposureRow(ITFLOW_SERVICE);
  if (!exposureRow?.enabled) {
    return;
  }

  const password = readAppEnvValue(ITFLOW_SERVICE, ITFLOW_ADMIN_PASSWORD_KEY);
  if (!password) {
    logger.error(`ITFlow admin bootstrap skipped: ${ITFLOW_ADMIN_PASSWORD_KEY} is not set`);
    return;
  }

  const dbPassword = readAppEnvValue(ITFLOW_SERVICE, 'ITFLOW_DB_PASSWORD');
  if (!dbPassword) {
    logger.error('ITFlow admin bootstrap skipped: ITFLOW_DB_PASSWORD is not set — cannot run the wizard database step');
    return;
  }
  const dbName = readAppEnvValue(ITFLOW_SERVICE, 'ITFLOW_DB_NAME') || DB_NAME_DEFAULT;
  const dbUser = readAppEnvValue(ITFLOW_SERVICE, 'ITFLOW_DB_USER') || DB_USER_DEFAULT;

  const admin = getAutheliaAdminUser();
  const email = admin?.email?.trim();
  if (!email) {
    logger.warn('ITFlow admin bootstrap skipped: no Authelia admin email yet');
    return;
  }
  const name = admin?.displayName?.trim() || 'Admin';
  const timezone = (await getAppTimezone().catch(() => null)) || 'UTC';

  try {
    const baseUrl = await resolveItflowBaseUrl();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const state = await getSetupState(baseUrl);

      if (state === 'unreachable') {
        if (attempt === MAX_ATTEMPTS) {
          logger.warn('ITFlow admin bootstrap gave up: the app never became reachable (it downloads its source on first boot)');
          return;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (state === 'already-setup') {
        logger.info('ITFlow setup is already complete; syncing the admin identity');
        await reconcileAdminIdentity(email, name);
        await reconcileAdminPassword(password);
        return;
      }

      const result = await runSetupWizard(baseUrl, {
        name,
        email,
        password,
        companyName: COMPANY_NAME,
        timezone,
        dbHost: DB_HOST,
        dbName,
        dbUser,
        dbPassword,
      });
      if (result === 'completed') {
        logger.info(`Ran ITFlow's setup wizard and created its admin (${email})`);
      } else if (result === 'already-setup') {
        logger.info('ITFlow setup is already complete; nothing to bootstrap');
      } else {
        logger.error('ITFlow admin bootstrap: the setup wizard did not complete — will retry next start');
      }
      return;
    }
  } catch (error) {
    logger.error('Failed to bootstrap the ITFlow first admin', { error: (error as Error).message });
  }
}

/**
 * Re-point the wizard-created admin (`user_id = 1`, see file header) at the
 * *current* Authelia admin's email/name. Idempotent — a no-op once they
 * already match. Never throws; a failure here leaves the previous identity
 * in place, which is a stale-but-working login, not a broken one.
 */
async function reconcileAdminIdentity(email: string, name: string): Promise<void> {
  const script = [
    "$email = getenv('ITFLOW_ADMIN_EMAIL');",
    "$name = getenv('ITFLOW_ADMIN_NAME');",
    '$stmt = $mysqli->prepare("UPDATE users SET user_email = ?, user_name = ? WHERE user_id = 1");',
    '$stmt->bind_param("ss", $email, $name);',
    'if ($stmt->execute()) {',
    '    echo "hlm: admin identity synced to $email\\n";',
    '} else {',
    '    echo "hlm: could not sync admin identity: " . $mysqli->error . "\\n";',
    '}',
  ];

  const result = await runItflowDbScript(script, {
    env: { ...process.env, ITFLOW_ADMIN_EMAIL: email, ITFLOW_ADMIN_NAME: name },
    passEnv: ['ITFLOW_ADMIN_EMAIL', 'ITFLOW_ADMIN_NAME'],
  });
  logger.info('ITFlow admin identity reconciled', { ok: result.ok, output: result.output || '(no output)' });
}

/**
 * Sync the wizard-created admin's password (and the credential-encryption
 * master key it wraps — see the file header) to whatever `.env` currently
 * declares. Detects a mismatch with `password_verify()` first, so a normal
 * restart where nothing changed touches nothing. Never throws.
 */
async function reconcileAdminPassword(password: string): Promise<void> {
  const script = [
    `require '${SECURITY_FUNCTIONS_PATH}';`,
    "$password = getenv('ITFLOW_ADMIN_PASSWORD_SYNC');",
    '$stmt = $mysqli->prepare("SELECT user_password FROM users WHERE user_id = 1");',
    '$stmt->execute();',
    '$stmt->bind_result($current_hash);',
    '$found = $stmt->fetch();',
    '$stmt->close();',
    'if (!$found) {',
    '    echo "hlm: no wizard-created admin (user_id=1) to sync a password for\\n";',
    '} elseif (password_verify($password, $current_hash)) {',
    '    echo "hlm: admin password already matches\\n";',
    '} else {',
    // Mirrors the wizard's own from-scratch path (setupFirstUserSpecificKey
    // needs no live session, unlike ITFlow's own change-password code) —
    // deliberately not a rewrap under the new password, which would need
    // the *old* plaintext one. See the file header for the trade-off.
    '    $password_hash = password_hash($password, PASSWORD_DEFAULT);',
    '    $site_encryption_master_key = randomString();',
    '    $user_specific_encryption_ciphertext = setupFirstUserSpecificKey($password, $site_encryption_master_key);',
    '    $update = $mysqli->prepare("UPDATE users SET user_password = ?, user_specific_encryption_ciphertext = ? WHERE user_id = 1");',
    '    $update->bind_param("ss", $password_hash, $user_specific_encryption_ciphertext);',
    '    if ($update->execute()) {',
    '        echo "hlm: admin password (and its encryption key) synced to the config panel value\\n";',
    '    } else {',
    '        echo "hlm: could not sync admin password: " . $mysqli->error . "\\n";',
    '    }',
    '}',
  ];

  const result = await runItflowDbScript(script, {
    env: { ...process.env, ITFLOW_ADMIN_PASSWORD_SYNC: password },
    passEnv: ['ITFLOW_ADMIN_PASSWORD_SYNC'],
  });
  // Belt-and-braces: the script never echoes the password, but keep it out
  // of the log even if a future mysqli error message happened to include it.
  const safeOutput = result.output.split(password).join('***');
  logger.info('ITFlow admin password reconciled', { ok: result.ok, output: safeOutput || '(no output)' });
}

export const __test = { reconcileAdminIdentity, reconcileAdminPassword };
