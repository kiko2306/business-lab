import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, withTransaction } = vi.hoisted(() => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock('../utils/database', () => ({ query, withTransaction }));

const { getService, isAutheliaProtectionRequired } = vi.hoisted(() => ({
  getService: vi.fn(),
  isAutheliaProtectionRequired: vi.fn(),
}));
vi.mock('../config/services', () => ({ getService, isAutheliaProtectionRequired }));

const { getNoSsoCredentialAppNames } = vi.hoisted(() => ({ getNoSsoCredentialAppNames: vi.fn() }));
vi.mock('./noSsoCredentialFanout', () => ({ getNoSsoCredentialAppNames }));

import {
  clearPendingNoSsoFanout,
  getAppAccessForUsers,
  getAppAccessOptionNames,
  getAppAccessOptions,
  getGrantableAppOptionNames,
  getGrantableAppOptions,
  getPendingNoSsoFanoutApps,
  setUserAppAccess,
} from './userAppAccess';

/** A fake `PoolClient` good enough for `withTransaction`'s callback: records every `.query()` call and answers the current-rows SELECT from `currentRows`. */
function fakeClient(currentRows: { service_name: string }[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT service_name FROM user_app_access')) {
        return Promise.resolve({ rows: currentRows });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
  return { client, calls };
}

const REGISTRY: Record<string, { label: string; autheliaGroups?: string[] }> = {
  vaultwarden: { label: 'Vaultwarden' },
  bookstack: { label: 'BookStack', autheliaGroups: ['wiki-editors'] },
  jellyfin: { label: 'Jellyfin' },
};

beforeEach(() => {
  query.mockReset();
  withTransaction.mockReset();
  getService.mockReset();
  getService.mockImplementation((name: string) => REGISTRY[name]);
  isAutheliaProtectionRequired.mockReset();
  // Default: every app is Authelia-gated unless a test says otherwise.
  isAutheliaProtectionRequired.mockReturnValue(true);
  getNoSsoCredentialAppNames.mockReset();
  getNoSsoCredentialAppNames.mockReturnValue([]);
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

  it('only asks the DB for exposed primary apps; the Authelia filter is applied in JS', async () => {
    query.mockResolvedValue({ rows: [] });
    await getAppAccessOptions();
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toMatch(/enabled = TRUE/);
    // Secondary exposure keys (netbird-vpn:api, homepage:apex, …) are not
    // grantable apps — their `:suffix` name breaks the appAccess pattern and
    // `app-<name>` group naming (regression: user create 400'd on them).
    expect(sql).toMatch(/service_name NOT LIKE '%:%'/);
  });

  it('drops apps that are not Authelia-protected (Home Page, Authelia, skipAutheliaProtection)', async () => {
    query.mockResolvedValue({
      rows: [
        { service_name: 'vaultwarden', hostname: 'v' },
        { service_name: 'homepage', hostname: 'h' },
        { service_name: 'docuseal', hostname: 'd' },
      ],
    });
    isAutheliaProtectionRequired.mockImplementation((name: string) => name === 'vaultwarden');

    const options = await getAppAccessOptions();

    expect(options.map((o) => o.serviceName)).toEqual(['vaultwarden']);
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

describe('getGrantableAppOptions', () => {
  it('includes a no-SSO app with a credential-fanout provisioner even though it is not Authelia-protected', async () => {
    query.mockResolvedValue({
      rows: [
        { service_name: 'vaultwarden', hostname: 'v' },
        { service_name: 'docuseal', hostname: 'd' },
        { service_name: 'nocodb', hostname: 'n' },
      ],
    });
    isAutheliaProtectionRequired.mockImplementation((name: string) => name === 'vaultwarden');
    getNoSsoCredentialAppNames.mockReturnValue(['docuseal']);

    const options = await getGrantableAppOptions();

    // nocodb has neither Authelia protection nor a provisioner yet — still excluded.
    expect(options.map((o) => o.serviceName).sort()).toEqual(['docuseal', 'vaultwarden']);
  });

  it('is just getAppAccessOptions when no app has a no-SSO provisioner', async () => {
    query.mockResolvedValue({ rows: [{ service_name: 'vaultwarden', hostname: 'v' }] });
    isAutheliaProtectionRequired.mockReturnValue(true);
    getNoSsoCredentialAppNames.mockReturnValue([]);

    expect(await getGrantableAppOptions()).toEqual(await getAppAccessOptions());
  });

  it('includes a no-SSO provisioner app that has no exposure row at all (lanOnly, e.g. Jellyfin)', async () => {
    // No 'jellyfin' row from the DB at all — lanOnly apps never get one.
    query.mockResolvedValue({ rows: [{ service_name: 'vaultwarden', hostname: 'v' }] });
    isAutheliaProtectionRequired.mockImplementation((name: string) => name === 'vaultwarden');
    getNoSsoCredentialAppNames.mockReturnValue(['jellyfin']);

    const options = await getGrantableAppOptions();

    expect(options).toEqual([
      { serviceName: 'jellyfin', label: 'Jellyfin', hostname: null, requiredGroups: [] },
      { serviceName: 'vaultwarden', label: 'Vaultwarden', hostname: 'v', requiredGroups: [] },
    ]);
  });
});

describe('getGrantableAppOptionNames', () => {
  it('is the set of Authelia-grantable plus no-SSO-provisioned service names', async () => {
    query.mockResolvedValue({
      rows: [
        { service_name: 'vaultwarden', hostname: 'v' },
        { service_name: 'docuseal', hostname: 'd' },
      ],
    });
    isAutheliaProtectionRequired.mockImplementation((name: string) => name === 'vaultwarden');
    getNoSsoCredentialAppNames.mockReturnValue(['docuseal']);

    const names = await getGrantableAppOptionNames();
    expect(names).toEqual(new Set(['vaultwarden', 'docuseal']));
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

describe('setUserAppAccess', () => {
  beforeEach(() => {
    getNoSsoCredentialAppNames.mockReturnValue(['docuseal', 'nocodb', 'itflow']);
  });

  it('diffs against the current rows instead of a blanket delete+reinsert', async () => {
    const { client, calls } = fakeClient([{ service_name: 'vaultwarden' }, { service_name: 'docuseal' }]);
    withTransaction.mockImplementation((fn: (c: unknown) => unknown) => fn(client));

    const diff = await setUserAppAccess(1, ['vaultwarden', 'nocodb']);

    expect(diff).toEqual({ added: ['nocodb'], removed: ['docuseal'] });
    // vaultwarden (unchanged) is never touched — no DELETE/INSERT mentions it.
    const deletes = calls.filter((c) => c.sql.startsWith('DELETE'));
    const inserts = calls.filter((c) => c.sql.startsWith('INSERT'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].params).toEqual([1, 'docuseal']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params).toEqual([1, 'nocodb', false]);
  });

  it('marks a newly-added no-SSO app pending when markAddedPending is set', async () => {
    const { client, calls } = fakeClient([]);
    withTransaction.mockImplementation((fn: (c: unknown) => unknown) => fn(client));

    await setUserAppAccess(1, ['nocodb'], { markAddedPending: true });

    const inserts = calls.filter((c) => c.sql.startsWith('INSERT'));
    expect(inserts[0].params).toEqual([1, 'nocodb', true]);
  });

  it('never marks an Authelia-gated app pending, even with markAddedPending set', async () => {
    const { client, calls } = fakeClient([]);
    withTransaction.mockImplementation((fn: (c: unknown) => unknown) => fn(client));

    await setUserAppAccess(1, ['vaultwarden'], { markAddedPending: true });

    const inserts = calls.filter((c) => c.sql.startsWith('INSERT'));
    expect(inserts[0].params).toEqual([1, 'vaultwarden', false]);
  });
});

describe('getPendingNoSsoFanoutApps', () => {
  it('queries pending rows restricted to today\'s no-SSO app names', async () => {
    getNoSsoCredentialAppNames.mockReturnValue(['docuseal', 'nocodb']);
    query.mockResolvedValue({ rows: [{ service_name: 'nocodb' }] });

    const result = await getPendingNoSsoFanoutApps(1);

    expect(result).toEqual(['nocodb']);
    expect(query.mock.calls[0][1]).toEqual([1, ['docuseal', 'nocodb']]);
  });

  it('short-circuits with no query when no app has a provisioner', async () => {
    getNoSsoCredentialAppNames.mockReturnValue([]);
    const result = await getPendingNoSsoFanoutApps(1);
    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('clearPendingNoSsoFanout', () => {
  it('clears the flag for the given apps', async () => {
    query.mockResolvedValue({ rows: [] });
    await clearPendingNoSsoFanout(1, ['nocodb', 'itflow']);
    expect(query.mock.calls[0][0]).toMatch(/SET pending_fanout = FALSE/);
    expect(query.mock.calls[0][1]).toEqual([1, ['nocodb', 'itflow']]);
  });

  it('short-circuits with no query for an empty list', async () => {
    await clearPendingNoSsoFanout(1, []);
    expect(query).not.toHaveBeenCalled();
  });
});
