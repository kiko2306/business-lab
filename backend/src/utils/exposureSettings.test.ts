import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { getNpmApiUrl, getExposureConfig } from './exposureSettings';
import { getHostGatewayIp } from './network';
import { parseEnvFile } from './envFile';
import { query } from './database';

vi.mock('./network', () => ({ getHostGatewayIp: vi.fn() }));
vi.mock('./envFile', () => ({ parseEnvFile: vi.fn() }));
vi.mock('./database', () => ({ query: vi.fn() }));

const mockedGateway = vi.mocked(getHostGatewayIp);
const mockedParseEnv = vi.mocked(parseEnvFile);
const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGateway.mockResolvedValue('10.201.0.1');
  mockedParseEnv.mockReturnValue({ NPM_ADMIN_PORT: '10270' });
  vi.spyOn(fs, 'existsSync').mockReturnValue(true);
});

describe('getNpmApiUrl', () => {
  it('builds the URL from the bridge gateway and NPM_ADMIN_PORT', async () => {
    mockedGateway.mockResolvedValue('172.20.0.1');
    mockedParseEnv.mockReturnValue({ NPM_ADMIN_PORT: '10275' });
    expect(await getNpmApiUrl()).toBe('http://172.20.0.1:10275');
  });

  it('falls back to 10270 when the .env is absent', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(await getNpmApiUrl()).toBe('http://10.201.0.1:10270');
  });

  it('falls back to 10270 when the port value is not numeric', async () => {
    mockedParseEnv.mockReturnValue({ NPM_ADMIN_PORT: 'nope' });
    expect(await getNpmApiUrl()).toBe('http://10.201.0.1:10270');
  });
});

describe('getExposureConfig', () => {
  const complete = {
    exposure_base_domain: 'example.com',
    exposure_npm_email: 'admin@example.com',
    exposure_npm_password: 'pw',
    exposure_cloudflare_account_id: 'a'.repeat(32),
    exposure_cloudflare_zone_id: 'z'.repeat(32),
    exposure_cloudflare_tunnel_id: 'tunnel',
    cloudflare_tunnel_token: 'token',
  };
  const rows = (o: Record<string, string>) => ({ rows: Object.entries(o).map(([key, value]) => ({ key, value })) });

  it('returns the config with a derived npmApiUrl when every stored field is set', async () => {
    mockedQuery.mockResolvedValue(rows(complete) as never);
    const config = await getExposureConfig();
    expect(config).toMatchObject({ baseDomain: 'example.com', npmApiUrl: 'http://10.201.0.1:10270' });
  });

  it('returns null when a required stored field is missing', async () => {
    const { exposure_npm_email: _omit, ...rest } = complete;
    mockedQuery.mockResolvedValue(rows(rest) as never);
    expect(await getExposureConfig()).toBeNull();
  });
});
