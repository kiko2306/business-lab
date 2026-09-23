import { describe, it, expect, vi, beforeEach } from 'vitest';

// The module pulls in db/logger/services transitively; stub the leaves so the
// two pure functions can be imported without a real environment.
vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// EXPOSURE_SETTINGS_KEYS is a plain const object — the real module is safe to
// import (no side effects at module load), so it isn't mocked away here.
vi.mock('./userAppAccess', () => ({ getAppAccessOptions: vi.fn() }));
vi.mock('./autheliaSync', () => ({ appGroupName: (n: string) => `app-${n}` }));
vi.mock('./autheliaUsers', () => ({ getUsersDatabasePath: vi.fn() }));
vi.mock('../config/services', () => ({
  resolveComposeFile: vi.fn(),
  getService: vi.fn(),
  isAutheliaProtectionRequired: vi.fn(),
}));
// The real one shells out to `docker compose run authelia validate-config`;
// its own behaviour is covered in autheliaValidate.test.ts. `false` = "does
// not reject", i.e. the write proceeds.
vi.mock('./autheliaValidate', () => ({ rejectsAutheliaConfig: vi.fn().mockResolvedValue(false) }));
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn() },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('child_process', () => ({ execFile: vi.fn((_cmd, _args, _opts, cb) => cb?.(null, '', '')) }));

import fs from 'fs';
import { query } from '../utils/database';
import { getAppAccessOptions } from './userAppAccess';
import { getUsersDatabasePath } from './autheliaUsers';
import { getService, isAutheliaProtectionRequired, resolveComposeFile } from '../config/services';
import { renderAccessControl, spliceAccessControl, syncAutheliaAccessControl } from './autheliaAccessControl';

const mockedQuery = vi.mocked(query);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedWriteFileSync = vi.mocked(fs.writeFileSync);
const mockedGetAppAccessOptions = vi.mocked(getAppAccessOptions);
const mockedGetUsersDatabasePath = vi.mocked(getUsersDatabasePath);
const mockedResolveComposeFile = vi.mocked(resolveComposeFile);

/**
 * Dispatch the query mock on the SQL rather than on call order.
 *
 * `syncAutheliaAccessControl` runs its lookups under `Promise.all`, so a
 * positional `mockResolvedValueOnce` chain depends on an ordering the code is
 * free to change — and did, the moment gated secondary exposures added a third
 * query (plan.md §637).
 */
function mockQueries(responses: { exposure?: unknown[]; settings?: unknown[]; secondary?: unknown[] }): void {
  mockedQuery.mockImplementation((async (sql: string) => {
    if (sql.includes("LIKE '%:%'")) return { rows: responses.secondary ?? [] };
    if (sql.includes('service_exposure')) return { rows: responses.exposure ?? [] };
    if (sql.includes('settings')) return { rows: responses.settings ?? [] };
    throw new Error(`unexpected query in test: ${sql}`);
  }) as never);
}

describe('renderAccessControl', () => {
  it('emits default deny, a bypass for the portal, and one one_factor rule per app', () => {
    const block = renderAccessControl('authelia.example.com', [
      { hostname: 'code-server.example.com', group: 'app-code-server' },
      { hostname: 'wiki.example.com', group: 'app-bookstack' },
    ]);

    expect(block).toContain('access_control:\n  default_policy: deny\n  rules:');
    expect(block).toContain("- domain: 'authelia.example.com'\n      policy: bypass");
    expect(block).toContain(
      "- domain: 'code-server.example.com'\n      policy: one_factor\n      subject:\n" +
        "        - 'group:admins'\n        - 'group:app-code-server'"
    );
    expect(block.startsWith('# >>> managed by the dashboard')).toBe(true);
    expect(block.trimEnd().endsWith('# <<< managed by the dashboard')).toBe(true);
  });

  it('still denies by default with no gated apps', () => {
    const block = renderAccessControl(null, []);
    expect(block).toContain('default_policy: deny');
    expect(block).not.toContain('policy: one_factor');
  });
});

describe('syncAutheliaAccessControl', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedExistsSync.mockReset();
    mockedReadFileSync.mockReset();
    mockedWriteFileSync.mockReset();
    mockedGetAppAccessOptions.mockReset();
    mockedGetUsersDatabasePath.mockReset();
    mockedResolveComposeFile.mockReset();
    mockedGetUsersDatabasePath.mockReturnValue('/apps/authelia/config/users_database.yml');
    mockedExistsSync.mockReturnValue(true);
    mockedGetAppAccessOptions.mockResolvedValue([]);
    mockedResolveComposeFile.mockReturnValue({
      projectName: 'authelia',
      appDir: '/apps/authelia',
      composeFile: '/apps/authelia/docker-compose.yml',
      composeArgs: '-f /apps/authelia/docker-compose.yml',
    });
  });

  it('skips the write rather than emit an unloadable default_policy: deny with zero rules (§283/§284)', async () => {
    // Authelia's own service_exposure row has no hostname yet, and the base
    // domain isn't resolvable either — the exact state hit on a fresh
    // deploy's first exposure enable, before NPM's admin was bootstrapped.
    mockQueries({ exposure: [{ hostname: null }], settings: [] });

    const result = await syncAutheliaAccessControl('exposure_change');

    expect(result).toEqual({ changed: false, restarted: false, ruleCount: 0 });
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it('gates a secondary hostname that opted in, and leaves the rest public (§637)', async () => {
    // A secondary exposure is public by default and excluded from the rules;
    // this is the opt-in case apps/hotel needs — one app owning both a gated
    // admin hostname and public guest ones.
    vi.mocked(getService).mockImplementation(((name: string) =>
      name === 'hotel'
        ? {
            name: 'hotel',
            autheliaBypassPaths: ['^/agent($|[/?])'],
            additionalExposures: [
              { suffix: 'core', label: 'Core API', portEnvVar: 'HOTEL_CORE_PORT', autheliaProtected: true },
              { suffix: 'checkin', label: 'Check-in', portEnvVar: 'HOTEL_CHECKIN_PORT' },
            ],
          }
        : undefined) as never);
    vi.mocked(isAutheliaProtectionRequired).mockImplementation(((name: string) => name === 'hotel') as never);

    mockQueries({
      exposure: [{ hostname: 'authelia.example.com' }],
      settings: [{ value: 'example.com' }],
      secondary: [
        { service_name: 'hotel:core', hostname: 'hotel-core.example.com' },
        { service_name: 'hotel:checkin', hostname: 'hotel-checkin.example.com' },
      ],
    });
    mockedReadFileSync.mockReturnValue('theme: light\n');

    await syncAutheliaAccessControl('exposure_change');
    const [, written] = mockedWriteFileSync.mock.calls[0] as [unknown, string];

    // The opted-in one is gated, admitting the app's own group.
    expect(written).toContain("domain: 'hotel-core.example.com'");
    expect(written).toContain("group:app-hotel");
    // Its bypass rides along, so the shop agent still reaches /agent.
    expect(written).toContain("^/agent($|[/?])");
    // The guest hostname gets no rule at all — it is never sent to Authelia,
    // so a rule here would be dead weight at best and a login wall at worst.
    expect(written).not.toContain('hotel-checkin.example.com');
  });

  it('writes and restarts once the base domain resolves, even with no gated apps yet', async () => {
    mockQueries({ exposure: [{ hostname: null }], settings: [{ value: 'example.com' }] });
    mockedReadFileSync.mockReturnValue('theme: light\n');

    const result = await syncAutheliaAccessControl('exposure_change');

    expect(mockedWriteFileSync).toHaveBeenCalled();
    const [, written] = mockedWriteFileSync.mock.calls[0];
    expect(written).toContain("domain: 'authelia.example.com'");
    expect(written).toContain('policy: bypass');
    expect(result.changed).toBe(true);
  });
});

describe('spliceAccessControl', () => {
  const block = renderAccessControl('a.example.com', [
    { hostname: 'x.example.com', group: 'app-x' },
  ]);

  it('replaces a plain access_control block and leaves the rest of the file intact', () => {
    const before = [
      'theme: light',
      '',
      'access_control:',
      '  default_policy: one_factor',
      '',
      'session:',
      '  name: authelia',
    ].join('\n');

    const after = spliceAccessControl(before, block);

    expect(after).toContain('theme: light');
    expect(after).toContain('session:\n  name: authelia');
    expect(after).toContain('default_policy: deny');
    expect(after).not.toContain('default_policy: one_factor');
    // Exactly one access_control key survives.
    expect(after.match(/^access_control:/gm)).toHaveLength(1);
  });

  it('replaces its own previously-written managed block on a second run', () => {
    const once = spliceAccessControl(
      'theme: light\n\naccess_control:\n  default_policy: one_factor\n\nsession:\n  name: a\n',
      block
    );
    const twice = spliceAccessControl(
      once,
      renderAccessControl('a.example.com', [
        { hostname: 'x.example.com', group: 'app-x' },
        { hostname: 'y.example.com', group: 'app-y' },
      ])
    );

    expect(twice.match(/^access_control:/gm)).toHaveLength(1);
    expect(twice).toContain("group:app-y'");
    expect(twice).toContain('session:\n  name: a');
  });

  it('is a no-op producing identical text when nothing changed', () => {
    const src = 'theme: light\n\naccess_control:\n  default_policy: one_factor\n\nsession:\n  name: a\n';
    const first = spliceAccessControl(src, block);
    const second = spliceAccessControl(first, block);
    expect(second).toBe(first);
  });
});

describe('renderAccessControl bypass paths', () => {
  it('emits the bypass rule BEFORE the app\'s own one_factor rule', () => {
    const block = renderAccessControl('authelia.example.com', [
      { hostname: 'vault.example.com', group: 'app-vaultwarden', bypassPaths: ['^/api($|/)'] },
    ]);

    const bypassAt = block.indexOf("- domain: 'vault.example.com'\n      policy: bypass");
    const gateAt = block.indexOf("- domain: 'vault.example.com'\n      policy: one_factor");
    expect(bypassAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    // Authelia is first-match-wins: the other order silently never bypasses.
    expect(bypassAt).toBeLessThan(gateAt);
    expect(block).toContain("      resources:\n        - '^/api($|/)'");
  });

  it('lists every path, in the declared order', () => {
    const block = renderAccessControl(null, [
      { hostname: 'vault.example.com', group: 'app-vaultwarden', bypassPaths: ['^/a$', '^/b$'] },
    ]);
    expect(block).toContain("      resources:\n        - '^/a$'\n        - '^/b$'");
  });

  it('emits no bypass rule at all for an app that declares none', () => {
    for (const paths of [undefined, []]) {
      const block = renderAccessControl(null, [
        { hostname: 'wiki.example.com', group: 'app-bookstack', bypassPaths: paths },
      ]);
      expect(block).not.toContain('policy: bypass');
      expect(block).not.toContain('resources:');
    }
  });
});

// §423: a bypass path ending in `$'` was read as String.replace's
// "everything after the match" pattern, splicing the rest of the file into
// the block and leaving a config Authelia refused to load — which took every
// gated app down with it. Both splice branches must treat the block as
// literal text.
describe('spliceAccessControl treats the block as literal', () => {
  const dangerous = [
    "    - domain: 'v.example.com'\n      policy: bypass\n      resources:\n        - '^/identity/connect/token$'\n",
    "        - '^/api($|/)'\n",
    '        - \'$& $` $\' $1\'\n',
  ];

  it('keeps $-sequences intact when replacing an existing marked block', () => {
    for (const body of dangerous) {
      const block = `# >>> managed by the dashboard — plan.md §151; regenerated on every exposure change, manual edits are lost\naccess_control:\n${body}# <<< managed by the dashboard\n`;
      const before = `head: true\n# >>> managed by the dashboard — plan.md §151; regenerated on every exposure change, manual edits are lost\naccess_control:\n  old: yes\n# <<< managed by the dashboard\ntail_marker_unique: true\n`;
      const out = spliceAccessControl(before, block);
      expect(out).toContain(body.trimEnd());
      // The tail must appear exactly once — twice means it was spliced in.
      expect(out.split('tail_marker_unique').length - 1).toBe(1);
    }
  });

  it('keeps $-sequences intact on the structural (no markers yet) branch', () => {
    const block = "access_control:\n  rules:\n    - domain: 'v'\n      resources:\n        - '^/x$'\n";
    const out = spliceAccessControl('access_control:\n  default_policy: deny\n\ntail_marker_unique: true\n', block);
    expect(out).toContain("- '^/x$'");
    expect(out.split('tail_marker_unique').length - 1).toBe(1);
  });
});
