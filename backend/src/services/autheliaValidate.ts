/**
 * Ask Authelia whether a candidate `configuration.yml` is loadable, before
 * it replaces the live one (plan.md §426).
 *
 * Both generators here write rendered text into a config file Authelia then
 * has to parse, and in one session two generated *strings* produced files
 * Authelia refused to load — a `$'` that spliced the file into itself
 * (§423) and a `\?` whose backslash TypeScript ate, leaving a regex Go
 * rejects (§425). Each took Authelia, and therefore every gated app, down
 * until it was noticed. Both were caught afterwards by their own targeted
 * guards; this is the general one that would have caught either.
 *
 * `authelia validate-config` is Authelia's own subcommand, in the same image
 * it already runs, invoked exactly as the service invokes itself — both
 * config files, and the `template` filter that makes
 * `{{ env "BASE_DOMAIN" }}` resolve. Confirmed live in both directions: exit
 * 0 on the real config, exit 1 with "invalid or unsupported Perl syntax" on
 * the §425 regex.
 *
 * The candidate is written inside the app's `config/` directory because that
 * is what the container has mounted at `/config` — read-only there, which is
 * all validation needs.
 */

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';

const SERVICE = 'authelia';
const VALIDATE_TIMEOUT_MS = 120_000;

export interface ValidationResult {
  /** False only when Authelia actually reported the config unloadable. */
  ok: boolean;
  /** False when validation could not be run at all (see the caller's note). */
  ran: boolean;
  message?: string;
}

/**
 * Did the validator run and reject, or fail to run at all? `exec` reports a
 * numeric `code` when the child ran and exited non-zero; a spawn failure or
 * a timeout has no exit code (`killed`/`ENOENT`/`ETIMEDOUT`). Exported
 * because the two outcomes must lead to opposite decisions and nothing else
 * here is testable without Docker.
 */
export function ranButRejected(error: { code?: number | string; killed?: boolean }): boolean {
  return !error.killed && typeof error.code === 'number' && error.code !== 0;
}

function runValidate(command: string): Promise<ValidationResult> {
  return new Promise((resolve) => {
    exec(command, { timeout: VALIDATE_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (!error) {
        resolve({ ok: true, ran: true, message: output });
        return;
      }
      resolve(
        ranButRejected(error as { code?: number; killed?: boolean })
          ? { ok: false, ran: true, message: output || (error as Error).message }
          : { ok: true, ran: false, message: output || (error as Error).message }
      );
    });
  });
}

export async function validateAutheliaConfig(candidateText: string): Promise<ValidationResult> {
  const resolved = resolveComposeFile(SERVICE);
  if (!resolved?.composeFile) return { ok: true, ran: false, message: 'Authelia not installed' };

  const configDir = path.join(path.dirname(resolved.composeFile), 'config');
  if (!fs.existsSync(configDir)) return { ok: true, ran: false, message: `${configDir} not found` };

  const name = `.candidate-${process.pid}-${Date.now()}.yml`;
  const candidatePath = path.join(configDir, name);
  try {
    fs.writeFileSync(candidatePath, candidateText, { mode: 0o640 });
    // Same flags the service itself uses — the oidc secrets file and the
    // template filter are both load-bearing, and validating without them
    // would reject a config that is actually fine.
    const command =
      `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
      `--entrypoint authelia ${SERVICE} validate-config ` +
      `--config /config/${name},/data/oidc-secrets.yml --config.experimental.filters template`;
    return await runValidate(command);
  } catch (error) {
    return { ok: true, ran: false, message: (error as Error).message };
  } finally {
    fs.rmSync(candidatePath, { force: true });
  }
}

/**
 * True when the candidate must not be written. Note the asymmetry, which is
 * deliberate: a *reported* rejection blocks the write, but validation being
 * unable to run does not. Refusing to write whenever Docker hiccups would
 * make exposure changes silently stop applying — trading a rare, recoverable
 * outage for a permanent, invisible one.
 */
export async function rejectsAutheliaConfig(candidateText: string, trigger: string): Promise<boolean> {
  const result = await validateAutheliaConfig(candidateText);
  if (!result.ran) {
    logger.warn(`Authelia config validation (${trigger}) could not run — writing anyway`, {
      detail: result.message?.slice(0, 300),
    });
    return false;
  }
  if (!result.ok) {
    logger.error(
      `Authelia config validation (${trigger}) REJECTED the generated config — keeping the current one`,
      { detail: result.message?.slice(0, 600) }
    );
    return true;
  }
  return false;
}
