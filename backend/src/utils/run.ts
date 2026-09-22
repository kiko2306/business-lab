/**
 * The two child-process shapes this backend actually uses, in one place.
 *
 * Nine services had each grown their own private `run()` — six of them
 * byte-identical apart from the default timeout, three more identical apart
 * from a field name. That is not just duplication: each copy quietly carried
 * its own answer to "what happens on a hang", and the answers disagreed.
 * `npmConfigWriter`'s had no timeout at all, so a wedged `docker exec` into
 * NPM wedged the caller forever; `webdavMount`'s used spawn's own `timeout`
 * option, which sends SIGTERM and lets a process that ignores it keep
 * running, rather than the explicit SIGKILL timer the others used.
 *
 * Not everything folds in here, deliberately: `appDumps` needs a Buffer
 * stdout (pg_dump output is binary and must not go through a string), and
 * `networkScan` wants execFile's reject-on-nonzero over an argv with no
 * shell. Both are one call site each; bending this file into their shape
 * would cost more than it saves.
 */

import { exec, spawn } from 'child_process';

/** Generous enough that no current caller trips it in normal operation. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** `docker compose` output on a big project comfortably exceeds 1 MB. */
const MAX_BUFFER = 4 * 1024 * 1024;

export interface RunShellOptions {
  timeoutMs?: number;
  /**
   * Resolve with `stdout\nstderr` instead of stdout alone. `cscli` and
   * `ntfy access` write parts of what their callers parse to stderr, while
   * every other caller parses stdout and would only get noise from this.
   */
  combineStderr?: boolean;
}

/**
 * Run a shell command, rejecting with stderr (or the spawn error) on a
 * non-zero exit. The command string goes through `/bin/sh`, so callers must
 * not interpolate untrusted input into it.
 */
export function runShell(command: string, options: RunShellOptions = {}): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, combineStderr = false } = options;
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(combineStderr ? `${stdout}\n${stderr}` : stdout.toString());
    });
  });
}

export interface RunArgvResult {
  /** The exit code, or -1 when the process could not be spawned at all. */
  code: number;
  stdout: string;
  stderr: string;
  /** Both streams interleaved in arrival order — what a human would see. */
  output: string;
}

/**
 * Run a command as an argv with no shell, and never reject: a non-zero exit
 * is an ordinary result every caller here inspects rather than an exception
 * (a `docker volume rm` of a volume that isn't there, a Kopia connect against
 * a destination the user has just mistyped).
 *
 * The timeout SIGKILLs *and* resolves, rather than only killing and waiting
 * for `close`. Every one of the nine wrappers this replaced only killed —
 * which does not actually bound the call: `close` fires when the pipes close,
 * not when the child dies, so a killed process that had spawned a grandchild
 * holding those pipes left the caller waiting for the grandchild anyway. The
 * shapes here (`docker run`, `docker compose`) make that unlikely rather than
 * impossible, and a timeout that doesn't time out is worth two lines to
 * close. A timeout is reported as code -1 with whatever output arrived.
 */
export function runArgv(command: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RunArgvResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = '';
    let stderr = '';
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: -1, stdout, stderr: stderr || `Timed out after ${timeoutMs}ms`, output });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      output += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      output += d.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message, output: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, output });
    });
  });
}
