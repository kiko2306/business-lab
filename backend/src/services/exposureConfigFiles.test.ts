import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { getService, resolveComposeFile } from '../config/services';
import { getServiceExposureRow } from './exposure';
import { applyExposureConfigFiles, __test } from './exposureConfigFiles';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ getService: vi.fn(), resolveComposeFile: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedGetService = vi.mocked(getService);
const mockedResolveCompose = vi.mocked(resolveComposeFile);
const mockedGetRow = vi.mocked(getServiceExposureRow);

function execSucceeds(stdout = 'hlm: reset migrated .storage/http') {
  mockedExec.mockImplementation(((_cmd: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, stdout, '');
  }) as unknown as typeof exec);
}

describe('exposureConfigFiles.hasOwnHttpSection', () => {
  it('is false for the stock HA config', () => {
    expect(__test.hasOwnHttpSection('default_config:\n\nfrontend:\n  themes: !include x\n')).toBe(false);
  });

  it('is true when the user declared their own http: block', () => {
    expect(__test.hasOwnHttpSection('default_config:\n\nhttp:\n  server_port: 8123\n')).toBe(true);
  });

  it('ignores our own managed block when deciding', () => {
    expect(__test.hasOwnHttpSection(`default_config:\n\n${__test.HA_HTTP_BLOCK}`)).toBe(false);
  });
});

describe('buildHomeAssistantFixScript', () => {
  const script = __test.buildHomeAssistantFixScript();

  it('appends the http: block only when neither our marker nor a user http: is present', () => {
    expect(script).toContain('grep -qF "$MARK"');
    expect(script).toContain('grep -qE "^http:([[:space:]]|$)"');
    expect(script).toContain('base64 -d >> "$CFG"');
  });

  it('resets a stale .storage/http', () => {
    expect(script).toContain('/config/.storage/http');
    expect(script).toMatch(/mv -f \/config\/\.storage\/http/);
  });

  it('carries the trusted_proxies block in its embedded payload', () => {
    const b64 = script.match(/"([A-Za-z0-9+/=]{40,})"/)?.[1] ?? '';
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    expect(decoded).toContain('use_x_forwarded_for: true');
    expect(decoded).toContain('172.16.0.0/12');
  });
});

describe('applyExposureConfigFiles — home-assistant', () => {
  beforeEach(() => {
    mockedGetService.mockReturnValue({ exposureConfigFile: true } as ReturnType<typeof getService>);
    mockedGetRow.mockResolvedValue({ enabled: true } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    mockedResolveCompose.mockReturnValue({
      projectName: 'home-assistant',
      appDir: '/apps/home-assistant',
      composeFile: '/apps/home-assistant/docker-compose.yml',
    });
    execSucceeds();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs a one-off HA container to reconcile the proxy config when exposure is enabled', async () => {
    await applyExposureConfigFiles('home-assistant', '/apps/home-assistant');

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p home-assistant -f /apps/home-assistant/docker-compose.yml run --rm');
    expect(command).toContain('--entrypoint /bin/sh home-assistant -c');
    expect(command).toContain('base64 -d | /bin/sh');
  });

  it('does nothing when exposure is disabled', async () => {
    mockedGetRow.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await applyExposureConfigFiles('home-assistant', '/apps/home-assistant');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('no-ops for a service that does not declare exposureConfigFile', async () => {
    mockedGetService.mockReturnValue({} as ReturnType<typeof getService>);
    await applyExposureConfigFiles('home-assistant', '/apps/home-assistant');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('swallows a failing docker command (start must not be blocked)', async () => {
    mockedExec.mockImplementation(((_c: string, _o: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('boom'), '', 'no such service');
    }) as unknown as typeof exec);
    await expect(applyExposureConfigFiles('home-assistant', '/apps/home-assistant')).resolves.toBeUndefined();
  });
});
