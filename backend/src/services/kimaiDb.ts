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
 *
 * `reconcileKimaiAdminIdentity` — README TODO found live (2026-09-16):
 * Kimai's entrypoint only ever *creates* the admin (`kimai:user:create
 * admin` from ADMINMAIL/ADMINPASS, no-ops once the row exists), so a
 * KIMAI_ADMIN_EMAIL/KIMAI_ADMIN_PASSWORD change after first boot never
 * reaches the real account — same drift class DocuSeal's
 * `reconcileDocusealAdminPassword` (§495) closed. Looked up by the
 * entrypoint's fixed `username` ('admin'), not email, since email is
 * exactly the column that can drift. Both columns are corrected in one
 * write — unlike DocuSeal's split (a live HTTP call for email, a direct
 * write for password), Kimai's `kimai2_users` wraps neither column in any
 * session-bound state, so there's nothing a direct write could break.
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

export type KimaiReconcileAdminResult = 'synced' | 'unchanged' | 'not-found' | 'failed';

const RECONCILE_ADMIN_SCRIPT = [
  "$email = getenv('KIMAI_FANOUT_EMAIL');",
  "$password = getenv('KIMAI_FANOUT_PASSWORD');",
  "$stmt = $pdo->prepare(\"SELECT email, password FROM kimai2_users WHERE username = 'admin'\");",
  '$stmt->execute();',
  '$row = $stmt->fetch(PDO::FETCH_ASSOC);',
  'if (!$row) {',
  "  echo 'not-found';",
  '} else {',
  "  $emailChanged = $row['email'] !== $email;",
  "  $passwordChanged = !password_verify($password, $row['password']);",
  '  if (!$emailChanged && !$passwordChanged) {',
  "    echo 'unchanged';",
  '  } else {',
  "    $hash = $passwordChanged ? password_hash($password, PASSWORD_BCRYPT, ['cost' => 13]) : $row['password'];",
  "    $upd = $pdo->prepare(\"UPDATE kimai2_users SET email = :email, password = :hash WHERE username = 'admin'\");",
  "    $upd->execute([':email' => $email, ':hash' => $hash]);",
  "    echo 'synced';",
  '  }',
  '}',
];

/** §501: re-sync Kimai's admin (email + password) only when it's actually drifted from the tracked values. */
export async function reconcileKimaiAdminIdentity(email: string, password: string): Promise<KimaiReconcileAdminResult> {
  const result = await runKimaiDbScript(RECONCILE_ADMIN_SCRIPT, {
    env: { ...process.env, KIMAI_FANOUT_EMAIL: email, KIMAI_FANOUT_PASSWORD: password },
    passEnv: ['KIMAI_FANOUT_EMAIL', 'KIMAI_FANOUT_PASSWORD'],
  });
  if (result.ok && result.output.includes('synced')) return 'synced';
  if (result.ok && result.output.includes('unchanged')) return 'unchanged';
  if (result.ok && result.output.includes('not-found')) return 'not-found';
  return 'failed';
}
