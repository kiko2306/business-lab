import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const exposure = vi.hoisted(() => ({ getServiceExposureRow: vi.fn() }));
const settings = vi.hoisted(() => ({ getExposureConfig: vi.fn() }));

vi.mock('./exposure', () => exposure);
vi.mock('../utils/exposureSettings', () => settings);
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { renderVikunjaConfig, applyVikunjaConfig, vikunjaConfigPath } from './vikunjaConfig';

describe('renderVikunjaConfig', () => {
  it('builds the auth.openid provider block keyed `authelia`', () => {
    const yaml = renderVikunjaConfig({
      publicUrl: 'https://vikunja.example.com',
      issuer: 'https://authelia.example.com',
      clientSecret: 's3cr3t',
    });

    expect(yaml).toContain('  openid:');
    expect(yaml).toContain('    enabled: true');
    expect(yaml).toContain("    redirecturl: 'https://vikunja.example.com/auth/openid/'");
    expect(yaml).toContain('      authelia:');
    expect(yaml).toContain("        authurl: 'https://authelia.example.com'");
    expect(yaml).toContain("        clientid: 'vikunja'");
    expect(yaml).toContain("        clientsecret: 's3cr3t'");
    expect(yaml).toContain("        scope: 'openid profile email'");
  });
});

describe('applyVikunjaConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vikunja-cfg-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'VIKUNJA_OIDC_CLIENT_SECRET=topsecret\n');
    settings.getExposureConfig.mockResolvedValue({ baseDomain: 'example.com' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op for a non-vikunja service', async () => {
    await applyVikunjaConfig('immich', tmpDir);
    expect(exposure.getServiceExposureRow).not.toHaveBeenCalled();
  });

  it('writes config.yml when Vikunja is exposed and the secret exists', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    await applyVikunjaConfig('vikunja', tmpDir);

    const written = fs.readFileSync(vikunjaConfigPath(tmpDir), 'utf8');
    expect(written).toContain("clientsecret: 'topsecret'");
    expect(written).toContain("authurl: 'https://authelia.example.com'");
    expect(written).toContain("redirecturl: 'https://vikunja.example.com/auth/openid/'");
  });

  it('removes a stale config.yml when Vikunja is not exposed', async () => {
    const configPath = vikunjaConfigPath(tmpDir);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'auth:\n');
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: false });

    await applyVikunjaConfig('vikunja', tmpDir);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('does not write when the client secret is missing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'VIKUNJA_JWT_SECRET=x\n');
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });

    await applyVikunjaConfig('vikunja', tmpDir);
    expect(fs.existsSync(vikunjaConfigPath(tmpDir))).toBe(false);
  });
});
