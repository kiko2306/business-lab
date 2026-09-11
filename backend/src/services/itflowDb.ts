/**
 * Run a one-off PHP script against ITFlow's own database, through ITFlow's
 * own container image rather than reaching `itflow-db` directly.
 *
 * ITFlow has no environment-variable support for SMTP/IMAP/cron settings —
 * they live in its `settings` table, written only by its own PHP
 * (admin/post/settings_mail.php, admin/post/cron.php). Its image already
 * ships `php84-mysqli` (it's an Apache+mod_php app) and its own
 * `config.php` — written by the setup wizard (§350) — already connects and
 * hands back a live `$mysqli`, so `require`-ing it is simpler and safer than
 * re-deriving host/user/pass/db name: no hand-rolled SQL escaping, no
 * connection details to keep in sync, and it fails the same obvious way
 * (`require(): Failed opening required`) when the wizard hasn't run yet —
 * self-describing, no separate "is it set up" check needed.
 *
 * `docker compose run`, not `exec` — same constraint as nextcloudOcc.ts (the
 * backend reaches Docker through the socket-proxy, which blocks exec).
 * `--no-deps`: `itflow-db` is already up (this only runs after `compose
 * up`), skip re-waiting on its healthcheck.
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const ITFLOW_SERVICE = 'itflow';
const CONFIG_PATH = '/var/www/localhost/htdocs/config.php';

export interface ItflowDbRunResult {
  ok: boolean;
  /** stdout on success, stderr/error message on failure. */
  output: string;
}

/**
 * `phpBody` runs after `config.php` is required (so `$mysqli` is already a
 * live connection) inside a one-shot ITFlow container. Base64'd onto the
 * command line the same way runNextcloudOccScript does, and for the same
 * reason: `passEnv` carries secret values in through the environment
 * (`-e NAME`), never interpolated into the script text itself. Never throws.
 */
export async function runItflowDbScript(
  phpBody: string[],
  opts: { env?: NodeJS.ProcessEnv; passEnv?: string[]; timeoutMs?: number } = {}
): Promise<ItflowDbRunResult> {
  const resolved = resolveComposeFile(ITFLOW_SERVICE);
  if (!resolved?.composeFile) {
    return { ok: false, output: 'itflow is not installed' };
  }

  const script = ['<?php', `require '${CONFIG_PATH}';`, ...phpBody].join('\n');
  const scriptB64 = Buffer.from(script).toString('base64');
  const passFlags = (opts.passEnv ?? []).map((name) => `-e ${name}`).join(' ');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `${passFlags} --entrypoint /bin/sh itflow -c "echo ${scriptB64} | base64 -d | php"`;

  return new Promise((resolve) => {
    exec(
      command,
      { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, env: opts.env ?? process.env },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, output: (stderr?.toString() || error.message).trim() });
          return;
        }
        resolve({ ok: true, output: stdout.toString().trim() });
      }
    );
  });
}
