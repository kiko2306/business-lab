import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({
  query,
  // setUserAppAccess uses withTransaction; not exercised here.
  withTransaction: vi.fn(),
}));

const { getService } = vi.hoisted(() => ({ getService: vi.fn() }));
vi.mock('../config/services', () => ({ getService }));

import {
  getAppAccessForUsers,
  getAppAccessOptionNames,
  getAppAccessOptions,
} from './userAppAccess';

const REGISTRY: Record<string, { label: string; autheliaGroups?: string[] }> = {
  vaultwarden: { label: 'Vaultwarden' },
  bookstack: { label: 'BookStack', autheliaGroups: ['wiki-editors'] },
};

beforeEach(() => {
  query.mockReset();
  getService.mockReset();
  getService.mockImplementation((name: string) => REGISTRY[name]);
});

describe('getAppAccessOptions', () => {
  it('maps exposure rows to options with registry label + required groups, sorted by label', async () => {
    query.mockResolvedValue({
      rows: [
        { service_name: 'vaultwarden', hostname: 'vault.example.com' },
        { service_name: 'bookstack', hostname: 'wiki.example.com' },
      ],
    });

    const options = await getAppAccessOptions();

    expect(options).toEqual([
      { serviceName: 'bookstack', label: 'BookStack', hostname: 'wiki.example.com', requiredGroups: ['wiki-editors'] },
      { serviceName: 'vaultwarden', label: 'Vaultwarden', hostname: 'vault.example.com', requiredGroups: [] },
    ]);
  });

  it('only asks for exposed, Authelia-protected apps and never Authelia itself', async () => {
    query.mockResolvedValue({ rows: [] });
    await getAppAccessOptions();
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/enabled = TRUE/);
    expect(sql).toMatch(/authelia_protected = TRUE/);
    expect(sql).toMatch(/service_name <> 'authelia'/);
  });

  it('falls back to the service name when the registry has no entry', async () => {
    query.mockResolvedValue({ rows: [{ service_name: 'mystery', hostname: null }] });
    const options = await getAppAccessOptions();
    expect(options).toEqual([
      { serviceName: 'mystery', label: 'mystery', hostname: null, requiredGroups: [] },
    ]);
  });
});

describe('getAppAccessOptionNames', () => {
  it('is the set of grantable service names', async () => {
    query.mockResolvedValue({
      rows: [
        { service_name: 'vaultwarden', hostname: 'v' },
        { service_name: 'bookstack', hostname: 'b' },
      ],
    });
    const names = await getAppAccessOptionNames();
    expect(names).toEqual(new Set(['vaultwarden', 'bookstack']));
  });
});

describe('getAppAccessForUsers', () => {
  it('groups rows by user id and defaults every asked id to an empty list', async () => {
    query.mockResolvedValue({
      rows: [
        { user_id: 1, service_name: 'bookstack' },
        { user_id: 1, service_name: 'vaultwarden' },
        { user_id: 3, service_name: 'bookstack' },
      ],
    });

    const out = await getAppAccessForUsers([1, 2, 3]);

    expect(out).toEqual({
      1: ['bookstack', 'vaultwarden'],
      2: [],
      3: ['bookstack'],
    });
  });

  it('short-circuits with no ids', async () => {
    const out = await getAppAccessForUsers([]);
    expect(out).toEqual({});
    expect(query).not.toHaveBeenCalled();
  });
});
