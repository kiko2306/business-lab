import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeExposureEnvOverrides } from './exposureEnv';

const HOST = 'paperless.example.com';

describe('computeExposureEnvOverrides', () => {
  it('sets url keys to the https public URL and host keys to the bare host', () => {
    const out = computeExposureEnvOverrides(
      { url: ['PAPERLESS_URL', 'PAPERLESS_CSRF_TRUSTED_ORIGINS'], host: ['N8N_HOST'] },
      HOST,
      {}
    );
    expect(out.PAPERLESS_URL).toBe('https://paperless.example.com');
    expect(out.PAPERLESS_CSRF_TRUSTED_ORIGINS).toBe('https://paperless.example.com');
    expect(out.N8N_HOST).toBe('paperless.example.com');
  });

  it('appends the host to a comma-separated allow-list, keeping existing entries', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['PAPERLESS_ALLOWED_HOSTS'] }, HOST, {
      PAPERLESS_ALLOWED_HOSTS: 'localhost, 127.0.0.1',
    });
    expect(out.PAPERLESS_ALLOWED_HOSTS).toBe('localhost,127.0.0.1,paperless.example.com');
  });

  it('does not duplicate a host already in the list', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['H'] }, HOST, { H: `foo,${HOST}` });
    expect(out.H).toBe(`foo,${HOST}`);
  });

  it('strips a scheme and trailing slash from an existing entry, so it can match a Host header', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['H'] }, HOST, {
      H: 'https://paperless.example.com/',
    });
    // Not `https://paperless.example.com/,paperless.example.com`: the pasted
    // URL matches no Host header, so keeping it around only hides the mistake.
    expect(out.H).toBe(HOST);
  });

  it('honours a space separator (Nextcloud trusted domains)', () => {
    const out = computeExposureEnvOverrides(
      { allowedHosts: ['NEXTCLOUD_TRUSTED_DOMAINS'], allowedHostsSeparator: ' ' },
      HOST,
      { NEXTCLOUD_TRUSTED_DOMAINS: 'localhost 192.168.1.5' }
    );
    expect(out.NEXTCLOUD_TRUSTED_DOMAINS).toBe(`localhost 192.168.1.5 ${HOST}`);
  });

  it('passes staticOnExposure values through verbatim', () => {
    const out = computeExposureEnvOverrides(
      { staticOnExposure: { N8N_PROTOCOL: 'https', NEXTCLOUD_OVERWRITEPROTOCOL: 'https' } },
      HOST,
      {}
    );
    expect(out).toMatchObject({ N8N_PROTOCOL: 'https', NEXTCLOUD_OVERWRITEPROTOCOL: 'https' });
  });

  it('sets gatewayOnExposure keys to the gateway IP, and leaves them unset without one', () => {
    expect(
      computeExposureEnvOverrides({ gatewayOnExposure: ['MESHCENTRAL_TLS_OFFLOAD'] }, HOST, {}, [], '10.201.0.1')
    ).toEqual({ MESHCENTRAL_TLS_OFFLOAD: '10.201.0.1' });
    // No gateway (LAN-only start) → the key is not forced on.
    expect(
      computeExposureEnvOverrides({ gatewayOnExposure: ['MESHCENTRAL_TLS_OFFLOAD'] }, HOST, {})
    ).toEqual({});
  });

  it('is empty when nothing is declared', () => {
    expect(computeExposureEnvOverrides({}, HOST, {})).toEqual({});
  });

  it('folds extraHosts into every allow-list key, deduped (apex exposure, §111)', () => {
    const out = computeExposureEnvOverrides({ allowedHosts: ['H'] }, 'homepage.example.com', {
      H: 'localhost,example.com',
    }, ['example.com']);
    // example.com was already present — not added twice; the primary host is.
    expect(out.H).toBe('localhost,example.com,homepage.example.com');
  });
});

// §92: an app whose allow-list env var relies on a compose `${VAR:-default}`
// rather than an explicit .env value lost that default the moment it was
// exposed, because the merge was seeded from .env alone. 'homepage' is the
// real registry entry that surfaced this (HOMEPAGE_ALLOWED_HOSTS).
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));

describe('buildExposureEnvOverrides — compose default fallback', () => {
  let tmpDir: string;
  let originalAppsDir: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exposureenv-test-'));
    fs.mkdirSync(path.join(tmpDir, 'home-page'));
    // Mirrors the real apps/home-page/docker-compose.yml line verbatim: the
    // default is itself built from another ${VAR:-default}, which is what
    // broke the naive regex parse (services.test.ts covers the parser directly).
    fs.writeFileSync(
      path.join(tmpDir, 'home-page', 'docker-compose.yml'),
      'services:\n  homepage:\n    environment:\n      HOMEPAGE_ALLOWED_HOSTS: ${HOMEPAGE_ALLOWED_HOSTS:-localhost:${HOMEPAGE_PORT:-10190}}\n'
    );
    originalAppsDir = process.env.APPS_DIR;
    process.env.APPS_DIR = tmpDir;

    const { getServiceExposureRow } = await import('./exposure');
    const { getExposureConfig } = await import('../utils/exposureSettings');
    vi.mocked(getServiceExposureRow).mockResolvedValue({ enabled: true } as never);
    vi.mocked(getExposureConfig).mockResolvedValue({ baseDomain: 'example.com' } as never);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalAppsDir === undefined) {
      delete process.env.APPS_DIR;
    } else {
      process.env.APPS_DIR = originalAppsDir;
    }
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps the compose default in the allow-list when .env does not set it', async () => {
    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    const out = await buildExposureEnvOverrides('homepage', path.join(tmpDir, 'home-page'));
    // Trailing `example.com` is the apex additional exposure (§111) — the Home
    // Page is served at the bare domain too, so its Host allow-list carries it.
    expect(out.HOMEPAGE_ALLOWED_HOSTS).toBe('localhost:10190,homepage.example.com,example.com');
  });

  it('still prefers an explicit .env value over the compose default', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'home-page', '.env'),
      'HOMEPAGE_ALLOWED_HOSTS=192.168.1.23:10190\n'
    );
    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    const out = await buildExposureEnvOverrides('homepage', path.join(tmpDir, 'home-page'));
    expect(out.HOMEPAGE_ALLOWED_HOSTS).toBe('192.168.1.23:10190,homepage.example.com,example.com');
  });

  it('substitutes the oidcClient.appEnv tokens for an exposed app (Vikunja)', async () => {
    const appDir = path.join(tmpDir, 'vikunja');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'docker-compose.yml'),
      'services:\n  vikunja:\n    ports:\n      - "${VIKUNJA_PORT:-10390}:3456"\n'
    );
    fs.writeFileSync(path.join(appDir, '.env'), 'VIKUNJA_OIDC_CLIENT_SECRET=topsecret\n');

    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    const out = await buildExposureEnvOverrides('vikunja', appDir);

    expect(out.VIKUNJA_AUTH_OPENID_ENABLED).toBe('true');
    expect(out.VIKUNJA_AUTH_OPENID_REDIRECTURL).toBe('https://vikunja.example.com/auth/openid/');
    expect(out.VIKUNJA_AUTH_OPENID_PROVIDERS_AUTHELIA_AUTHURL).toBe('https://authelia.example.com');
    expect(out.VIKUNJA_AUTH_OPENID_PROVIDERS_AUTHELIA_CLIENTID).toBe('vikunja');
    expect(out.VIKUNJA_AUTH_OPENID_PROVIDERS_AUTHELIA_CLIENTSECRET).toBe('topsecret');
    // exposureEnvKeys still applied alongside
    expect(out.VIKUNJA_PUBLIC_URL).toBe('https://vikunja.example.com');
  });

  it('substitutes the oidcClient.appEnv tokens for an exposed app (Homebox)', async () => {
    const appDir = path.join(tmpDir, 'homebox');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'docker-compose.yml'),
      'services:\n  homebox:\n    ports:\n      - "${HOMEBOX_PORT:-10440}:7745"\n'
    );
    fs.writeFileSync(path.join(appDir, '.env'), 'HOMEBOX_OIDC_CLIENT_SECRET=topsecret\n');

    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    const out = await buildExposureEnvOverrides('homebox', appDir);

    expect(out.HBOX_OIDC_ENABLED).toBe('true');
    expect(out.HBOX_OIDC_ISSUER_URL).toBe('https://authelia.example.com');
    expect(out.HBOX_OIDC_CLIENT_ID).toBe('homebox');
    expect(out.HBOX_OIDC_CLIENT_SECRET).toBe('topsecret');
    expect(out.HBOX_OPTIONS_TRUST_PROXY).toBe('true');
  });

  it('substitutes the oidcClient.appEnv tokens for an exposed app (Mealie)', async () => {
    const appDir = path.join(tmpDir, 'mealie');
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, 'docker-compose.yml'),
      'services:\n  mealie:\n    ports:\n      - "${MEALIE_PORT:-10230}:9000"\n'
    );
    fs.writeFileSync(path.join(appDir, '.env'), 'MEALIE_OIDC_CLIENT_SECRET=topsecret\n');

    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    const out = await buildExposureEnvOverrides('mealie', appDir);

    expect(out.OIDC_AUTH_ENABLED).toBe('true');
    expect(out.OIDC_CONFIGURATION_URL).toBe(
      'https://authelia.example.com/.well-known/openid-configuration'
    );
    expect(out.OIDC_CLIENT_ID).toBe('mealie');
    expect(out.OIDC_CLIENT_SECRET).toBe('topsecret');
    expect(out.OIDC_PROVIDER_NAME).toBe('Authelia');
    // exposureEnvKeys still applied alongside
    expect(out.MEALIE_BASE_URL).toBe('https://mealie.example.com');
  });

  it('returns no overrides for an oidcClient app that is not exposed', async () => {
    const appDir = path.join(tmpDir, 'vikunja');
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, 'docker-compose.yml'), 'services:\n  vikunja:\n    image: x\n');
    const { getServiceExposureRow } = await import('./exposure');
    vi.mocked(getServiceExposureRow).mockResolvedValue({ enabled: false } as never);

    const { buildExposureEnvOverrides } = await import('./exposureEnv');
    expect(await buildExposureEnvOverrides('vikunja', appDir)).toEqual({});
  });
});
