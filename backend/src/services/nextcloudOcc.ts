/**
 * Run a sequence of `occ` commands inside a throwaway Nextcloud container.
 *
 * Shared scaffold for the Nextcloud roster-wiring reconcilers
 * (nextcloudOnlyOffice.ts, nextcloudClamav.ts). All of them need the same
 * three things:
 *  - a container built from Nextcloud's own image + volume, run as `www-data`
 *    (occ refuses to run as root),
 *  - `docker compose run --rm`, not `exec` — the backend reaches Docker through
 *    the socket-proxy, which blocks exec,
 *  - a short wait for `occ status`, because `docker compose up -d` returns
 *    before Nextcloud has finished its own first-run install.
 *
 * The reconcilers must be called AFTER `docker compose up` (occ needs the
 * Nextcloud database, which is only up once the container is), not before like
 * ensureHomeAssistantHacs.
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const NEXTCLOUD_SERVICE = 'nextcloud';

// Poll occ for up to 60s (20 × 3s) before giving up. A start that isn't ready
// yet just retries on the next one.
const WAIT_FOR_OCC = [
  'i=0',
  'while ! php occ status >/dev/null 2>&1; do',
  '  i=$((i+1))',
  '  if [ $i -ge 20 ]; then',
  '    echo "hlm: Nextcloud is not ready (occ status failed); skipping"',
  '    exit 0',
  '  fi',
  '  sleep 3',
  'done',
];

export interface OccRunResult {
  ok: boolean;
  /** stdout on success, stderr/error message on failure. */
  output: string;
}

/**
 * Base64 `bodyLines` into a /bin/sh script (prefixed with `set -e`, a `cd` to
 * the web root, and the occ-readiness wait) and run it in a one-shot Nextcloud
 * container. Never throws.
 *
 * `passEnv` names environment variables to forward into the container with
 * `-e NAME` (pass-through form — the value never appears on the command line);
 * put the values in `env`.
 */
export async function runNextcloudOccScript(
  bodyLines: string[],
  opts: { env?: NodeJS.ProcessEnv; passEnv?: string[]; timeoutMs?: number } = {}
): Promise<OccRunResult> {
  const resolved = resolveComposeFile(NEXTCLOUD_SERVICE);
  if (!resolved?.composeFile) {
    return { ok: false, output: 'nextcloud is not installed' };
  }

  const script = ['set -e', 'cd /var/www/html', ...WAIT_FOR_OCC, ...bodyLines].join('\n');
  const scriptB64 = Buffer.from(script).toString('base64');
  const passFlags = (opts.passEnv ?? []).map((name) => `-e ${name}`).join(' ');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `--user www-data ${passFlags} --entrypoint /bin/sh nextcloud -c "echo ${scriptB64} | base64 -d | /bin/sh"`;

  return new Promise((resolve) => {
    exec(
      command,
      { timeout: opts.timeoutMs ?? 180_000, maxBuffer: 4 * 1024 * 1024, env: opts.env ?? process.env },
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
