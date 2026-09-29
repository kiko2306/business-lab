import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { setSambaAccountEnabled } from './sambaExec';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockReturnValue({
    projectName: 'samba',
    appDir: '/apps/samba',
    composeFile: '/apps/samba/docker-compose.yml',
    composeArgs: '-f /apps/samba/docker-compose.yml',
  } as ReturnType<typeof resolveComposeFile>);
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, '', '');
  }) as unknown as typeof exec);
});

describe('setSambaAccountEnabled', () => {
  it('refuses a username outside the safe charset without touching docker', async () => {
    const result = await setSambaAccountEnabled('bob; rm -rf /', true);
    expect(result).toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('is not installed → fails without touching docker', async () => {
    mockedResolve.mockReturnValue({ projectName: 'samba', appDir: '/apps/samba', composeFile: null, composeArgs: '' } as ReturnType<
      typeof resolveComposeFile
    >);
    const result = await setSambaAccountEnabled('bob', true);
    expect(result).toBe(false);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs smbpasswd -e in a one-off container to enable', async () => {
    const result = await setSambaAccountEnabled('bob', true);
    expect(result).toBe(true);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p samba');
    expect(command).toContain('run --rm --no-deps -T');
    expect(command).toContain('--entrypoint /bin/sh samba');
    expect(command).toContain('smbpasswd -e -c /etc/samba/smb.conf bob');
  });

  it('runs smbpasswd -d in a one-off container to disable', async () => {
    await setSambaAccountEnabled('bob', false);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('smbpasswd -d -c /etc/samba/smb.conf bob');
  });

  it('reports false when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'no such service: samba');
    }) as unknown as typeof exec);
    const result = await setSambaAccountEnabled('bob', true);
    expect(result).toBe(false);
  });
});
