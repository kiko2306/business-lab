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
const SUBSCRIBER_USER = 'subscriber';

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
function buildScript(password: string): string {
  return [
    'set -e',
    `NTFY_PASSWORD='${password}' ntfy user add --ignore-exists --role=user ${SUBSCRIBER_USER} >/dev/null 2>&1 || true`,
    `ntfy access ${SUBSCRIBER_USER} '*' ro >/dev/null`,
    `ntfy token add --label='Business Lab dashboard (subscriber)' ${SUBSCRIBER_USER}`,
  ].join('\n');
}

export async function ensureNtfySubscriberToken(serviceName: string): Promise<void> {
  if (serviceName !== NTFY_SERVICE) return;

  const existing = (readAppEnvValue(NTFY_SERVICE, NTFY_TOKEN_KEY) ?? '').trim();
  if (existing) return;

  const resolved = resolveComposeFile(NTFY_SERVICE);
  if (!resolved?.composeFile) return;

  try {
    // The password is never used — the app authenticates with the token — but
    // ntfy will not create a user without one, and a blank password would
    // make `subscriber` loggable-into from the web UI.
    const script = buildScript(generateComplexPassword());
    const scriptB64 = Buffer.from(script).toString('base64');
    const command =
      `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
      `--entrypoint /bin/sh ${NTFY_SERVICE} -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

    const token = parseToken(await run(command));
    if (!token) {
      logger.warn('ntfy: minted no subscriber token — `ntfy token add` printed nothing recognisable');
      return;
    }
    await saveServiceEnv(NTFY_SERVICE, { [NTFY_TOKEN_KEY]: token });
    logger.info('ntfy: created the read-only subscriber token (read it in ntfy\'s config panel)');
  } catch (error) {
    // Never blocks the start; retried on the next one.
    logger.warn('ntfy: could not create the subscriber token', { error: (error as Error).message });
  }
}
