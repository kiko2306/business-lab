/**
 * Mint ntfy's read-only subscriber account and access token on start
 * (plan.md §425), so the ntfy phone app can subscribe to the alert topic
 * without a human running `ntfy user add` in a container.
 *
 * Why this exists at all: ntfy now runs with
 * `NTFY_AUTH_DEFAULT_ACCESS=write-only` — anonymous clients may publish but
 * not read — which is what makes it safe to let Authelia bypass ntfy's read
 * endpoints for native apps that cannot follow a login redirect (§415/§423).
 * That protection is only useful if there is a token to read *with*, and
 * minting one is `ntfy token add`, i.e. a console step this project forbids.
 *
 * A throwaway `docker compose run` against ntfy's own image and volume, not
 * `docker compose exec`: the backend reaches Docker through the socket-proxy,
 * which blocks exec — same constraint and same workaround as
 * nextcloudOnlyOffice.ts and homeAssistantHacs.ts. ntfy's CLI writes the auth
 * database directly, so the server does not need to be up for this.
 *
 * Stores **both** a password and a token, because the two clients want
 * different things: ntfy's own docs describe the Android app in terms of a
 * "user configured for a server" and its troubleshooting says "username/
 * password may be incorrect", while the CLI and raw HTTP take
 * `Authorization: Bearer tk_…`. The first cut stored only the token and
 * generated the password inline — so the phone app, which asks for a
 * username and password, had nothing to enter and ntfy answered 403 (§428).
 *
 * Runs once: a token already in `.env` is left alone, because `ntfy token
 * add` mints a *new* token every time it is called and the old one keeps
 * working — re-running blindly would litter the auth database with tokens
 * nobody can identify.
 */

import { exec } from 'child_process';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { generateComplexPassword, readAppEnvValue, saveServiceEnv } from './appEnv';

export const NTFY_SERVICE = 'ntfy';
export const NTFY_TOKEN_KEY = 'NTFY_SUBSCRIBE_TOKEN';
export const NTFY_PASSWORD_KEY = 'NTFY_SUBSCRIBE_PASSWORD';
/** Also the username to type into the ntfy app. */
export const SUBSCRIBER_USER = 'subscriber';

function run(command: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(`${stdout}\n${stderr}`);
    });
  });
}

/**
 * ntfy prints the new token on a line of its own, e.g.
 *   token tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2 for user subscriber
 * Exported for the test — picking the wrong substring here stores a token
 * that silently never authenticates.
 */
export function parseToken(cliOutput: string): string | null {
  return /\btk_[A-Za-z0-9]{10,}\b/.exec(cliOutput)?.[0] ?? null;
}

/**
 * `ro` on every topic rather than just the configured one: the alert topic is
 * a user-editable setting, and a token that stops working when someone
 * renames the topic is a worse failure than a read-only token that follows
 * it. Still read-only, and still the only way to read anything.
 */
function buildScript(password: string, recreate: boolean): string {
  return [
    'set -e',
    // Recreating is how an existing subscriber whose password was never
    // stored (the §428 state) converges on one that is. Deleting takes its
    // tokens with it, which is why a fresh token is minted right after.
    recreate ? `ntfy user del ${SUBSCRIBER_USER} >/dev/null 2>&1 || true` : ':',
    `NTFY_PASSWORD='${password}' ntfy user add --ignore-exists --role=user ${SUBSCRIBER_USER} >/dev/null 2>&1 || true`,
    `ntfy access ${SUBSCRIBER_USER} '*' ro >/dev/null`,
    `ntfy token add --label='Business Lab dashboard (subscriber)' ${SUBSCRIBER_USER}`,
  ].join('\n');
}

/**
 * A stored password that cannot have come from `generateComplexPassword()`
 * (24 chars, always at least one digit and one of `!@#%^*-_=+`) means
 * something overwrote it after this hook stored the real one — which is
 * exactly what happened live: ntfy's `.env` ended up holding an 11-character
 * value with no digit, so the phone app's credential no longer matched
 * ntfy's auth database and subscribing returned 401 (§429). Treated as "no
 * usable password", so the account is re-issued rather than left broken.
 */
export function looksGenerated(password: string): boolean {
  return password.length === 24 && /[0-9]/.test(password) && /[!@#%^*\-_=+]/.test(password);
}

export async function ensureNtfySubscriberToken(serviceName: string, force = false): Promise<void> {
  if (serviceName !== NTFY_SERVICE) return;

  const existingToken = (readAppEnvValue(NTFY_SERVICE, NTFY_TOKEN_KEY) ?? '').trim();
  const storedPassword = (readAppEnvValue(NTFY_SERVICE, NTFY_PASSWORD_KEY) ?? '').trim();
  const existingPassword = looksGenerated(storedPassword) ? storedPassword : '';
  if (storedPassword && !existingPassword) {
    logger.warn(
      'ntfy: the stored subscriber password is not one this generated — re-issuing the account (§429)'
    );
  }
  if (existingToken && existingPassword && !force) return;
  // A token but no password means this ran before §428 and the phone app has
  // no credential it can use. Recreate the user so both exist.
  const recreate = force || (Boolean(existingToken) && !existingPassword);

  const resolved = resolveComposeFile(NTFY_SERVICE);
  if (!resolved?.composeFile) return;

  try {
    const password = generateComplexPassword();
    const script = buildScript(password, recreate);
    const scriptB64 = Buffer.from(script).toString('base64');
    const command =
      `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
      `--entrypoint /bin/sh ${NTFY_SERVICE} -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

    const token = parseToken(await run(command));
    if (!token) {
      logger.warn('ntfy: minted no subscriber token — `ntfy token add` printed nothing recognisable');
      return;
    }
    await saveServiceEnv(NTFY_SERVICE, { [NTFY_TOKEN_KEY]: token, [NTFY_PASSWORD_KEY]: password });

    // Read it straight back. The credential is useless if what lands in .env
    // is not what ntfy was given, and that failed silently once already —
    // the app just says "not authorized" and nothing here notices (§429).
    const storedBack = (readAppEnvValue(NTFY_SERVICE, NTFY_PASSWORD_KEY) ?? '').trim();
    if (storedBack !== password) {
      logger.error(
        'ntfy: the subscriber password did not survive the round-trip to .env — the phone app will get 401',
        { wrote: password.length, readBack: storedBack.length }
      );
      return;
    }
    logger.info(
      `ntfy: ${recreate ? 're-created' : 'created'} the read-only '${SUBSCRIBER_USER}' account — ` +
        'username/password for the phone app, token for the CLI, both in ntfy\'s config panel'
    );
  } catch (error) {
    // Never blocks the start; retried on the next one.
    logger.warn('ntfy: could not create the subscriber token', { error: (error as Error).message });
  }
}
