import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser, listAutheliaUsernames } from './autheliaUsers';
import { reconcilePaperlessUsers } from './paperlessUsers';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn(), listAutheliaUsernames: vi.fn() }));

const mockedExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveComposeFile).mockReturnValue({
    projectName: 'paperless',
    appDir: '/apps/paperless',
    composeFile: '/apps/paperless/compose.yaml',
    composeArgs: '-f /apps/paperless/compose.yaml',
  } as ReturnType<typeof resolveComposeFile>);
  vi.mocked(getAutheliaAdminUser).mockReturnValue({ username: 'mat' } as ReturnType<typeof getAutheliaAdminUser>);
  vi.mocked(listAutheliaUsernames).mockReturnValue(['mat', 'ana']);
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, 'promoted\n', '')) as unknown as typeof exec);
});

describe('reconcilePaperlessUsers', () => {
  it('ignores other services and a missing Authelia admin', async () => {
    await reconcilePaperlessUsers('nextcloud');
    vi.mocked(getAutheliaAdminUser).mockReturnValue(null);
    await reconcilePaperlessUsers('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs manage.py shell in a one-off container, names via -e only, admin excluded from the group list', async () => {
    await reconcilePaperlessUsers('paperless');
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p paperless');
    expect(command).toContain('-e PAPERLESS_FANOUT_ADMIN -e PAPERLESS_FANOUT_USERS --entrypoint /bin/sh paperless-ngx');
    expect(command).toContain('manage.py shell');
    expect(command).not.toContain('mat');
    const { env } = mockedExec.mock.calls[0][1] as { env: Record<string, string> };
    expect(env.PAPERLESS_FANOUT_ADMIN).toBe('mat');
    expect(env.PAPERLESS_FANOUT_USERS).toBe('["ana"]');
  });
});
