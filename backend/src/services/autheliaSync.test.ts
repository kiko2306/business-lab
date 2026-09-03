import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({ query }));

const { writeFileSync, existsSync } = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));
vi.mock('fs', () => ({ default: { writeFileSync, existsSync }, writeFileSync, existsSync }));

vi.mock('../utils/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { getAppAccessOptions } = vi.hoisted(() => ({ getAppAccessOptions: vi.fn() }));
vi.mock('./userAppAccess', () => ({ getAppAccessOptions }));

const { getUsersDatabasePath, readUsersDatabase } = vi.hoisted(() => ({
  getUsersDatabasePath: vi.fn(() => '/authelia/config/users_database.yml'),
  readUsersDatabase: vi.fn(() => ({ preamble: '# header\n', data: { users: {} } })),
}));
vi.mock('./autheliaUsers', () => ({ getUsersDatabasePath, readUsersDatabase }));

import yaml from 'js-yaml';
import { syncAutheliaUsers } from './autheliaSync';

function writtenUsers(): Record<string, { password: string; email: string; groups: string[]; displayname: string }> {
  const body = writeFileSync.mock.calls.at(-1)?.[1] as string;
  return (yaml.load(body.replace(/^# header\n/, '')) as { users: Record<string, never> }).users;
}

beforeEach(() => {
  query.mockReset();
  writeFileSync.mockReset();
  existsSync.mockReturnValue(true);
  getAppAccessOptions.mockReset();
  getAppAccessOptions.mockResolvedValue([
    { serviceName: 'code-server', label: 'code-server', hostname: 'cs', requiredGroups: [] },
    { serviceName: 'bookstack', label: 'BookStack', hostname: 'bs', requiredGroups: ['wiki-editors'] },
  ]);
  readUsersDatabase.mockReturnValue({ preamble: '# header\n', data: { users: {} } });
  getUsersDatabasePath.mockReturnValue('/authelia/config/users_database.yml');
});

describe('syncAutheliaUsers', () => {
  it('no-ops when Authelia is not installed', async () => {
    getUsersDatabasePath.mockReturnValue(null as unknown as string);
    const result = await syncAutheliaUsers('test');
    expect(result).toEqual({ synced: false, count: 0, reason: 'authelia-not-installed' });
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('never writes an empty user list', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'mat', email: null, password_hash: '$2b$x', roles: ['webmaster'], app_access: [] }],
    });
    const result = await syncAutheliaUsers('test');
    expect(result).toEqual({ synced: false, count: 0, reason: 'no-eligible-users' });
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('gives a webmaster the admins group and every app group, hash copied verbatim', async () => {
    query.mockResolvedValue({
      rows: [{ username: 'mat', email: 'm@x.com', password_hash: '$2b$hash', roles: ['webmaster'], app_access: [] }],
    });

    const result = await syncAutheliaUsers('test');

    expect(result).toEqual({ synced: true, count: 1 });
    const users = writtenUsers();
    expect(users.mat.password).toBe('$2b$hash');
    expect(users.mat.email).toBe('m@x.com');
    expect(users.mat.groups).toEqual(['admins', 'app-bookstack', 'app-code-server']);
  });

  it('gives a non-webmaster only its granted app groups plus declared groups', async () => {
    query.mockResolvedValue({
      rows: [
        { username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], app_access: ['bookstack'] },
      ],
    });

    await syncAutheliaUsers('test');

    expect(writtenUsers().ann.groups).toEqual(['app-bookstack', 'wiki-editors']);
  });

  it('skips an account with no email and keeps an existing displayname', async () => {
    readUsersDatabase.mockReturnValue({
      preamble: '# header\n',
      data: { users: { ann: { displayname: 'Ann Smith' } } },
    });
    query.mockResolvedValue({
      rows: [
        { username: 'ann', email: 'a@x.com', password_hash: '$2b$a', roles: ['user'], app_access: [] },
        { username: 'bob', email: null, password_hash: '$2b$b', roles: ['user'], app_access: [] },
      ],
    });

    const result = await syncAutheliaUsers('test');

    expect(result.count).toBe(1);
    const users = writtenUsers();
    expect(Object.keys(users)).toEqual(['ann']);
    expect(users.ann.displayname).toBe('Ann Smith');
  });
});
