/**
 * The one-off `docker compose run` that eleven services use to reach inside an
 * app's image (an `occ`, a `php` snippet, `smbpasswd`, `authelia
 * validate-config`). Kept in one place because each copy was a hand-built
 * shell string: a quoting slip in any one of them is a host shell injection.
 *
 * `--rm` so nothing is left behind, `--no-deps` so the run never starts the
 * app's database or friends as a side effect, `-T` because the backend has no
 * TTY to give it.
 */
import type { ResolvedComposeFile } from '../types';

export function composeRunCommand(
  resolved: Pick<ResolvedComposeFile, 'projectName' | 'composeArgs'>,
  args: string
): string {
  return `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ${args}`;
}

/**
 * `script` fed to `interpreter` inside the container. It travels as base64,
 * so no quote, `$` or backtick in it is ever parsed by the host shell — only
 * the base64 alphabet appears on the command line.
 */
export function pipedScript(script: string, interpreter: string): string {
  return `echo ${Buffer.from(script).toString('base64')} | base64 -d | ${interpreter}`;
}
