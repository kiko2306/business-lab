import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { runKimaiDbScript } from './kimaiDb';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'kimai',
    appDir: '/apps/kimai',
    composeFile: '/apps/kimai/docker-compose.yml',
    composeArgs: '-f /apps/kimai/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, 'ok', '');
  }) as unknown as typeof exec);
});

describe('runKimaiDbScript', () => {
  it('is not installed → fails without touching docker', async () => {
    mockedResolve.mockReturnValue({ projectName: 'kimai', appDir: '/apps/kimai', composeFile: null, composeArgs: '' } as ReturnType<
      typeof resolveComposeFile
    >);
    const result = await runKimaiDbScript(['echo "x";']);
    expect(result).toEqual({ ok: false, output: 'kimai is not installed' });
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs the script in a one-off container, connecting via DATABASE_URL', async () => {
    await runKimaiDbScript(['echo "hi";']);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p kimai');
    expect(command).toContain('run --rm --no-deps -T');
    expect(command).toContain('--entrypoint /bin/sh kimai');
    // The script itself (PDO preamble + body) travels base64'd, not literally.
    expect(command).not.toContain('echo "hi";');
  });

  it('passes secret env var names through -e, never their values', async () => {
    await runKimaiDbScript(['echo $SECRET;'], {
      env: { ...process.env, SECRET: 'topsecret' },
      passEnv: ['SECRET'],
    });
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('-e SECRET');
    expect(command).not.toContain('topsecret');
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'SQLSTATE[HY000] [2002] Connection refused');
    }) as unknown as typeof exec);
    const result = await runKimaiDbScript(['echo "x";']);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Connection refused');
  });
});
