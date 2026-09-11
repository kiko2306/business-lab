import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { buildSharedMountScript, reconcileNextcloudSharedMount } from './nextcloudSharedMount';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedResolve = vi.mocked(resolveComposeFile);

const resolved = (name: string) => ({
  projectName: name,
  appDir: `/apps/${name}`,
  composeFile: `/apps/${name}/docker-compose.yml`,
  composeArgs: `-f /apps/${name}/docker-compose.yml`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockedResolve.mockImplementation((name: string) => resolved(name) as ReturnType<typeof resolveComposeFile>);
  mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, 'hlm: /shared registered as external storage', '');
  }) as unknown as typeof exec);
});

describe('buildSharedMountScript', () => {
  const script = buildSharedMountScript().join('\n');

  it('enables files_external only when absent', () => {
    expect(script).toContain('if ! php occ app:getpath files_external');
    expect(script).toContain('php occ app:install files_external');
    expect(script).toContain('php occ app:enable files_external');
  });

  it('creates the /shared mount only when files_external:list does not already show it', () => {
    expect(script).toContain('if php occ files_external:list | grep -q "/shared"');
    expect(script).toContain('php occ files_external:create Shared local null::null -c datadir=/shared');
  });
});

describe('reconcileNextcloudSharedMount', () => {
  it('does nothing for any other service', async () => {
    await reconcileNextcloudSharedMount('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs the wiring in a www-data Nextcloud container', async () => {
    await reconcileNextcloudSharedMount('nextcloud');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p nextcloud');
    expect(command).toContain('run --rm --no-deps -T --user www-data');
  });

  it('skips quietly when Nextcloud is not installed', async () => {
    mockedResolve.mockReturnValue({ projectName: 'nextcloud', appDir: '/apps/nextcloud', composeFile: null, composeArgs: '' } as ReturnType<
      typeof resolveComposeFile
    >);
    await reconcileNextcloudSharedMount('nextcloud');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'boom');
    }) as unknown as typeof exec);
    await expect(reconcileNextcloudSharedMount('nextcloud')).resolves.toBeUndefined();
  });
});
