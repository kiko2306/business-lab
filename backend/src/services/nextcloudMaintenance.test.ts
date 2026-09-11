import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { reconcileNextcloudMaintenance, buildMaintenanceScript } from './nextcloudMaintenance';

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
    cb(null, 'hlm: maintenance window configured', '');
  }) as unknown as typeof exec);
});

describe('buildMaintenanceScript', () => {
  const script = buildMaintenanceScript().join('\n');

  it('sets a maintenance window start hour', () => {
    expect(script).toContain('maintenance_window_start --type integer --value "2"');
  });

  it('gates the (expensive) mimetype repair behind its own sentinel so it only runs once', () => {
    expect(script).toContain('config:app:get core hlm_mimetype_migrated');
    expect(script).toContain('maintenance:repair --include-expensive');
    expect(script).toContain('config:app:set core hlm_mimetype_migrated --value "1"');
  });
});

describe('reconcileNextcloudMaintenance', () => {
  it('does nothing for any other service', async () => {
    await reconcileNextcloudMaintenance('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('runs the reconciler in a www-data Nextcloud container with a longer timeout', async () => {
    await reconcileNextcloudMaintenance('nextcloud');
    expect(mockedExec).toHaveBeenCalledTimes(1);
    const [command, options] = mockedExec.mock.calls[0] as [string, { timeout?: number }];
    expect(command).toContain('docker compose -p nextcloud');
    expect(command).toContain('run --rm --no-deps -T --user www-data');
    expect(options.timeout).toBe(600_000);
  });

  it('never throws when the container command fails', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'boom');
    }) as unknown as typeof exec);
    await expect(reconcileNextcloudMaintenance('nextcloud')).resolves.toBeUndefined();
  });
});
