import { describe, it, expect, vi } from 'vitest';

// The module pulls in db/logger/services transitively; stub the leaves so the
// two pure functions can be imported without a real environment.
vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn() }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/exposureSettings', () => ({ getExposureConfig: vi.fn() }));
vi.mock('./userAppAccess', () => ({ getAppAccessOptions: vi.fn() }));
vi.mock('./autheliaSync', () => ({ appGroupName: (n: string) => `app-${n}` }));
vi.mock('./autheliaUsers', () => ({ getUsersDatabasePath: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile: vi.fn() }));

import { renderAccessControl, spliceAccessControl } from './autheliaAccessControl';

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
