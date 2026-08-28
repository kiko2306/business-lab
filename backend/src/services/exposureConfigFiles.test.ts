import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getService } from '../config/services';
import { getServiceExposureRow } from './exposure';
import { applyExposureConfigFiles, __test } from './exposureConfigFiles';

vi.mock('../config/services', () => ({ getService: vi.fn() }));
vi.mock('./exposure', () => ({ getServiceExposureRow: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const mockedGetService = vi.mocked(getService);
const mockedGetRow = vi.mocked(getServiceExposureRow);

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

describe('applyExposureConfigFiles — home-assistant', () => {
  let appDir: string;
  const configPath = () => path.join(appDir, 'data', 'configuration.yaml');

  beforeEach(() => {
    appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expcfg-'));
    fs.mkdirSync(path.join(appDir, 'data'));
    fs.writeFileSync(configPath(), 'default_config:\n\nfrontend:\n  themes: !include_dir_merge_named themes\n');
    mockedGetService.mockReturnValue({ exposureConfigFile: true } as ReturnType<typeof getService>);
    mockedGetRow.mockResolvedValue({ enabled: true } as Awaited<ReturnType<typeof getServiceExposureRow>>);
  });

  afterEach(() => {
    fs.rmSync(appDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('appends the http: block once exposure is enabled', async () => {
    await applyExposureConfigFiles('home-assistant', appDir);
    const text = fs.readFileSync(configPath(), 'utf8');
    expect(text).toContain('use_x_forwarded_for: true');
    expect(text).toContain('trusted_proxies:');
  });

  it('is idempotent — a second run does not append again', async () => {
    await applyExposureConfigFiles('home-assistant', appDir);
    await applyExposureConfigFiles('home-assistant', appDir);
    const occurrences = fs.readFileSync(configPath(), 'utf8').split(__test.HA_MARKER_BEGIN).length - 1;
    expect(occurrences).toBe(1);
  });

  it('does nothing when exposure is disabled', async () => {
    mockedGetRow.mockResolvedValue({ enabled: false } as Awaited<ReturnType<typeof getServiceExposureRow>>);
    await applyExposureConfigFiles('home-assistant', appDir);
    expect(fs.readFileSync(configPath(), 'utf8')).not.toContain('trusted_proxies');
  });

  it('leaves a user-managed http: block alone', async () => {
    fs.writeFileSync(configPath(), 'default_config:\n\nhttp:\n  server_port: 8123\n');
    await applyExposureConfigFiles('home-assistant', appDir);
    expect(fs.readFileSync(configPath(), 'utf8')).not.toContain('homelab-management');
  });

  it('no-ops for a service that does not declare exposureConfigFile', async () => {
    mockedGetService.mockReturnValue({} as ReturnType<typeof getService>);
    await applyExposureConfigFiles('home-assistant', appDir);
    expect(fs.readFileSync(configPath(), 'utf8')).not.toContain('trusted_proxies');
  });

  it('moves aside a migrated .storage/http so the yaml http: block re-migrates', async () => {
    const storeDir = path.join(appDir, 'data', '.storage');
    fs.mkdirSync(storeDir);
    const storePath = path.join(storeDir, 'http');
    fs.writeFileSync(storePath, JSON.stringify({ data: { yaml_migration_done: true, stable: {} } }));

    await applyExposureConfigFiles('home-assistant', appDir);

    expect(fs.existsSync(storePath)).toBe(false);
    expect(fs.existsSync(`${storePath}.superseded-by-homelab-management`)).toBe(true);
    expect(fs.readFileSync(configPath(), 'utf8')).toContain('use_x_forwarded_for: true');
  });

  it('leaves .storage/http alone when it already carries use_x_forwarded_for', async () => {
    const storeDir = path.join(appDir, 'data', '.storage');
    fs.mkdirSync(storeDir);
    const storePath = path.join(storeDir, 'http');
    fs.writeFileSync(
      storePath,
      JSON.stringify({ data: { yaml_migration_done: true, stable: { use_x_forwarded_for: true } } })
    );

    await applyExposureConfigFiles('home-assistant', appDir);

    expect(fs.existsSync(storePath)).toBe(true);
  });
});
