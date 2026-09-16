/**
 * Run a one-off PHP script against Kimai's own database, through a
 * throwaway `kimai` container — same `docker compose run` shape as
 * itflowDb.ts (the backend reaches Docker through the socket-proxy, which
 * blocks `exec`).
 *
 * Unlike ITFlow, there's no app-owned config file to `require` for
 * connection details: Kimai's `DATABASE_URL` is already present in the
 * container from the compose service's own `environment:` block (it's how
 * Kimai itself connects), so the script just parses that directly with
 * PHP's `parse_url()`.
 */

import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';

const KIMAI_SERVICE = 'kimai';

const CONNECT_PREAMBLE = [
  "$url = parse_url(getenv('DATABASE_URL'));",
  '$pdo = new PDO(',
  "  'mysql:host=' . $url['host'] . ';port=' . ($url['port'] ?? 3306) . ';dbname=' . ltrim($url['path'], '/') . ';charset=utf8mb4',",
  "  $url['user'],",
  "  $url['pass'],",
  '  [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]',
  ');',
];

export interface KimaiDbRunResult {
  ok: boolean;
  /** stdout on success, stderr/error message on failure. */
  output: string;
}

/**
 * `phpBody` runs after `$pdo` is already a live connection. Base64'd onto
 * the command line the same way itflowDb.ts's script travels, and for the
 * same reason: `passEnv` carries secret values in through the environment
 * (`-e NAME`), never interpolated into the script text itself. Never throws.
 */
export async function runKimaiDbScript(
  phpBody: string[],
  opts: { env?: NodeJS.ProcessEnv; passEnv?: string[]; timeoutMs?: number } = {}
): Promise<KimaiDbRunResult> {
  const resolved = resolveComposeFile(KIMAI_SERVICE);
  if (!resolved?.composeFile) {
    return { ok: false, output: 'kimai is not installed' };
  }

  const script = ['<?php', ...CONNECT_PREAMBLE, ...phpBody].join('\n');
  const scriptB64 = Buffer.from(script).toString('base64');
  const passFlags = (opts.passEnv ?? []).map((name) => `-e ${name}`).join(' ');
  const command =
    `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
    `${passFlags} --entrypoint /bin/sh kimai -c "echo ${scriptB64} | base64 -d | php"`;

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
