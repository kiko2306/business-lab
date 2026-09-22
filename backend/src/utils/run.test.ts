import { describe, expect, it } from 'vitest';
import { runArgv, runShell } from './run';

describe('runShell', () => {
  it('resolves with stdout and, on request, stderr too', async () => {
    const command = 'echo out; echo err 1>&2';
    expect(await runShell(command)).toBe('out\n');
    expect(await runShell(command, { combineStderr: true })).toBe('out\n\nerr\n');
  });

  it('rejects with stderr on a non-zero exit', async () => {
    await expect(runShell('echo boom 1>&2; exit 3')).rejects.toThrow('boom');
  });

  it('kills a command that outruns its timeout', async () => {
    await expect(runShell('sleep 5', { timeoutMs: 100 })).rejects.toThrow();
  });
});

describe('runArgv', () => {
  it('reports a non-zero exit as a result rather than throwing', async () => {
    const result = await runArgv('sh', ['-c', 'echo out; echo err 1>&2; exit 2']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('out\n');
    expect(result.stderr).toBe('err\n');
    expect(result.output).toContain('out');
    expect(result.output).toContain('err');
  });

  it('reports a command that cannot be spawned as code -1', async () => {
    expect((await runArgv('definitely-not-a-real-binary', [])).code).toBe(-1);
  });

  // SIGKILL, not SIGTERM — a child that ignores SIGTERM must not outlive the call.
  it('kills on timeout and still resolves', async () => {
    const result = await runArgv('sh', ['-c', 'trap "" TERM; sleep 5'], 200);
    expect(result.code).not.toBe(0);
  });
});
