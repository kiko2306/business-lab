import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { getAutheliaAdminUser } from './autheliaUsers';
import { reconcilePaperlessAdmin } from './paperlessAdmin';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('./autheliaUsers', () => ({ getAutheliaAdminUser: vi.fn() }));

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
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, 'promoted\n', '')) as unknown as typeof exec);
});

describe('reconcilePaperlessAdmin', () => {
  it('ignores other services and a missing Authelia admin', async () => {
    await reconcilePaperlessAdmin('nextcloud');
    vi.mocked(getAutheliaAdminUser).mockReturnValue(null);
    await reconcilePaperlessAdmin('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs manage.py shell in a one-off container, username via -e only', async () => {
    await reconcilePaperlessAdmin('paperless');
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p paperless');
    expect(command).toContain('-e PAPERLESS_FANOUT_USER --entrypoint /bin/sh paperless-ngx');
    expect(command).toContain('manage.py shell');
    expect(command).not.toContain('mat');
    expect((mockedExec.mock.calls[0][1] as { env: Record<string, string> }).env.PAPERLESS_FANOUT_USER).toBe('mat');
  });
});
