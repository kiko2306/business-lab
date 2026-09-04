import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'child_process';
import { resolveComposeFile } from '../config/services';
import { ensureHomeAssistantHacs, __test } from './homeAssistantHacs';

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedExec = vi.mocked(exec);
const mockedResolveCompose = vi.mocked(resolveComposeFile);

function execSucceeds(stdout = 'hlm: installed HACS 2.0.5') {
  mockedExec.mockImplementation(((_cmd: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
    cb(null, stdout, '');
  }) as unknown as typeof exec);
}

describe('buildHacsInstallScript', () => {
  const script = __test.buildHacsInstallScript();

  it('does nothing when HACS is already there', () => {
    // HACS updates itself from inside HA. Re-stamping the latest release over a
    // running install on every restart would fight its updater, and could
    // downgrade someone who took a newer version through the UI.
    expect(script).toContain(`if [ -f ${__test.HACS_DIR}/manifest.json ]; then`);
    expect(script).toMatch(/already installed[\s\S]*?exit 0/);
  });

  it('unpacks to a staging directory and only then moves it into place', () => {
    // A truncated download must never leave a half-populated custom_components/
    // hacs — HA would try to load it and fail, which is worse than no HACS.
    const stage = '/config/custom_components/.hacs-staging';
    const extractIndex = script.indexOf(`extractall(sys.argv[2])" /tmp/hacs.zip ${stage}`);
    const verifyIndex = script.indexOf(`if [ ! -f ${stage}/manifest.json ]; then`);
    const moveIndex = script.indexOf(`mv ${stage} ${__test.HACS_DIR}`);
    expect(extractIndex).toBeGreaterThan(-1);
    expect(verifyIndex).toBeGreaterThan(extractIndex);
    expect(moveIndex).toBeGreaterThan(verifyIndex);
  });

  it('exits 0 rather than failing the start when the download fails', () => {
    // Home Assistant without HACS is a missing feature; Home Assistant that
    // refuses to start is an outage.
    expect(script).toContain('curl -fsSL -o /tmp/hacs.zip');
    expect(script).toMatch(/could not download HACS[\s\S]*?exit 0/);
  });

  it('installs the published release rather than main', () => {
    expect(__test.HACS_ZIP_URL).toBe(
      'https://github.com/hacs/integration/releases/latest/download/hacs.zip'
    );
  });
});

describe('ensureHomeAssistantHacs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveCompose.mockReturnValue({
      projectName: 'home-assistant',
      appDir: '/apps/home-assistant',
      composeFile: '/apps/home-assistant/docker-compose.yml',
      composeArgs: '-f /apps/home-assistant/docker-compose.yml',
    });
  });

  it('runs the install inside a throwaway container built from HA\'s own image', async () => {
    // /config is owned by HA's root container; the dashboard's process is not
    // root and cannot write there directly.
    execSucceeds();
    await ensureHomeAssistantHacs('home-assistant');

    expect(mockedExec).toHaveBeenCalledTimes(1);
    const command = mockedExec.mock.calls[0][0] as string;
    expect(command).toContain('docker compose -p home-assistant');
    expect(command).toContain('run --rm --no-deps -T');
    expect(command).toContain('--entrypoint /bin/sh home-assistant');
    expect(command).toContain('base64 -d | /bin/sh');
  });

  it('does nothing for any other service', async () => {
    execSucceeds();
    await ensureHomeAssistantHacs('paperless');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('skips quietly when Home Assistant is not installed', async () => {
    mockedResolveCompose.mockReturnValue({
      projectName: 'home-assistant',
      appDir: '/apps/home-assistant',
      composeFile: null,
      composeArgs: '',
    });
    await ensureHomeAssistantHacs('home-assistant');
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('never throws when the install fails, so the app still starts', async () => {
    mockedExec.mockImplementation(((_cmd: string, _opts: unknown, cb: (...a: unknown[]) => void) => {
      cb(new Error('no such image'), '', 'pull failed');
    }) as unknown as typeof exec);

    await expect(ensureHomeAssistantHacs('home-assistant')).resolves.toBeUndefined();
  });
});
