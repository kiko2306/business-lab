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

import { renderImmichConfig, applyImmichConfig, immichConfigPath } from './immichConfig';

describe('renderImmichConfig', () => {
  it('builds the OAuth block against Authelia with the https mobile bridge', () => {
    const cfg = renderImmichConfig({
      hostname: 'immich.example.com',
      issuer: 'https://authelia.example.com',
      clientSecret: 's3cr3t',
      passwordLoginEnabled: true,
    }) as any;

    expect(cfg.oauth.enabled).toBe(true);
    expect(cfg.oauth.issuerUrl).toBe('https://authelia.example.com/.well-known/openid-configuration');
    expect(cfg.oauth.clientId).toBe('immich');
    expect(cfg.oauth.clientSecret).toBe('s3cr3t');
    expect(cfg.oauth.mobileOverrideEnabled).toBe(true);
    expect(cfg.oauth.mobileRedirectUri).toBe('https://immich.example.com/api/oauth/mobile-redirect');
    expect(cfg.oauth.tokenEndpointAuthMethod).toBe('client_secret_post');
    expect(cfg.passwordLogin.enabled).toBe(true);
  });

  it('carries the password-login toggle through', () => {
    const cfg = renderImmichConfig({
      hostname: 'immich.example.com',
      issuer: 'https://authelia.example.com',
      clientSecret: 'x',
      passwordLoginEnabled: false,
    }) as any;
    expect(cfg.passwordLogin.enabled).toBe(false);
  });
});

describe('applyImmichConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'immich-cfg-'));
    fs.writeFileSync(path.join(tmpDir, '.env'), 'IMMICH_OIDC_CLIENT_SECRET=topsecret\n');
    settings.getExposureConfig.mockResolvedValue({ baseDomain: 'example.com' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op for a non-immich service', async () => {
    await applyImmichConfig('vikunja', tmpDir);
    expect(exposure.getServiceExposureRow).not.toHaveBeenCalled();
  });

  it('writes immich.json when Immich is exposed and the secret exists', async () => {
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    await applyImmichConfig('immich', tmpDir);

    const written = JSON.parse(fs.readFileSync(immichConfigPath(tmpDir), 'utf8'));
    expect(written.oauth.clientSecret).toBe('topsecret');
    expect(written.oauth.issuerUrl).toBe(
      'https://authelia.example.com/.well-known/openid-configuration'
    );
    expect(written.passwordLogin.enabled).toBe(true);
  });

  it('reflects IMMICH_PASSWORD_LOGIN_ENABLED=false from .env', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.env'),
      'IMMICH_OIDC_CLIENT_SECRET=topsecret\nIMMICH_PASSWORD_LOGIN_ENABLED=false\n'
    );
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });
    await applyImmichConfig('immich', tmpDir);

    const written = JSON.parse(fs.readFileSync(immichConfigPath(tmpDir), 'utf8'));
    expect(written.passwordLogin.enabled).toBe(false);
  });

  it('removes a stale immich.json when Immich is not exposed', async () => {
    const configPath = immichConfigPath(tmpDir);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{}');
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: false });

    await applyImmichConfig('immich', tmpDir);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('does not write when the client secret is missing', async () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'IMMICH_DB_PASSWORD=x\n');
    exposure.getServiceExposureRow.mockResolvedValue({ enabled: true });

    await applyImmichConfig('immich', tmpDir);
    expect(fs.existsSync(immichConfigPath(tmpDir))).toBe(false);
  });
});
