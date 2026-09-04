import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { runNextcloudOccScript } from './nextcloudOcc';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);

/** Decode the base64'd script out of the `sh -c "echo <b64> | base64 -d ..."`. */
function decodeScript(command: string): string {
  const b64 = /echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec(command)?.[1] ?? '';
  return Buffer.from(b64, 'base64').toString('utf8');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'nextcloud',
    appDir: '/apps/nextcloud',
    composeFile: '/apps/nextcloud/docker-compose.yml',
    composeArgs: '-f /apps/nextcloud/docker-compose.yml',
  });
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, 'ok', '');
  }) as unknown as typeof exec);
});

describe('runNextcloudOccScript', () => {
  it('runs a www-data one-shot container and forwards the named env vars with -e', async () => {
    await runNextcloudOccScript(['php occ app:enable foo'], {
      env: { ...process.env, FOO: 'bar' },
      passEnv: ['FOO', 'BAZ'],
    });

    const [command, opts] = mockedExec.mock.calls[0] as unknown as [string, { env: NodeJS.ProcessEnv }];
    expect(command).toContain('docker compose -p nextcloud -f /apps/nextcloud/docker-compose.yml run --rm --no-deps -T');
    expect(command).toContain('--user www-data -e FOO -e BAZ --entrypoint /bin/sh nextcloud');
    expect(opts.env.FOO).toBe('bar');
  });

  it('prepends set -e, a cd to the web root, and an occ-readiness wait', async () => {
    await runNextcloudOccScript(['echo hi']);
    const script = decodeScript(mockedExec.mock.calls[0][0] as string);
    expect(script.startsWith('set -e\ncd /var/www/html\n')).toBe(true);
    expect(script).toMatch(/while ! php occ status[\s\S]*sleep 3[\s\S]*done/);
    expect(script.trimEnd().endsWith('echo hi')).toBe(true);
  });

  it('reports ok:false with stderr when the container command fails, without throwing', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('exit 1'), '', 'boom from occ');
    }) as unknown as typeof exec);

    const res = await runNextcloudOccScript(['php occ status']);
    expect(res).toEqual({ ok: false, output: 'boom from occ' });
  });

  it('reports ok:false when Nextcloud is not installed', async () => {
    mockedResolve.mockReturnValue({
      projectName: 'nextcloud',
      appDir: '/apps/nextcloud',
      composeFile: null,
      composeArgs: '',
    });
    const res = await runNextcloudOccScript(['php occ status']);
    expect(res.ok).toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
