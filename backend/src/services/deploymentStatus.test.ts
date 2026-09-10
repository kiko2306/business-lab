import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '../utils/database';
import { getMailConfig } from '../utils/mailSettings';
import { getBackupTarget } from '../utils/backupTarget';
import { getAutheliaAdminUser, listAutheliaUsernames } from './autheliaUsers';
import { getDeploymentStatus } from './deploymentStatus';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/mailSettings', () => ({ getMailConfig: vi.fn() }));
vi.mock('../utils/backupTarget', () => ({ getBackupTarget: vi.fn() }));
vi.mock('./autheliaUsers', () => ({
  getAutheliaAdminUser: vi.fn(),
  listAutheliaUsernames: vi.fn(),
}));

const mockedQuery = vi.mocked(query);
const mockedMail = vi.mocked(getMailConfig);
const mockedBackup = vi.mocked(getBackupTarget);
const mockedAdmin = vi.mocked(getAutheliaAdminUser);
const mockedUsers = vi.mocked(listAutheliaUsernames);

const settingsRows = (values: Record<string, string>) =>
  mockedQuery.mockResolvedValue({
    rows: Object.entries(values).map(([key, value]) => ({ key, value })),
  } as never);

const byId = (r: Awaited<ReturnType<typeof getDeploymentStatus>>, id: string) =>
  r.checks.find((c) => c.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  settingsRows({});
  mockedMail.mockResolvedValue(null);
  mockedBackup.mockResolvedValue(null);
  mockedAdmin.mockReturnValue(null);
  mockedUsers.mockReturnValue([]);
});

describe('getDeploymentStatus', () => {
  it('reports every check outstanding on a fresh box', async () => {
    const status = await getDeploymentStatus();
    expect(status.checks).toHaveLength(7);
    expect(status.outstanding).toBe(7);
    expect(status.checks.every((c) => !c.done)).toBe(true);
  });

  it('marks a check done and surfaces its value when set', async () => {
    settingsRows({
      exposure_base_domain: 'acme.example',
      cloudflare_tunnel_token: 'tok',
      exposure_cloudflare_tunnel_id: 'abcd1234ef',
      exposure_cloudflare_account_id: 'acc',
      exposure_cloudflare_zone_id: 'zone',
    });
    const status = await getDeploymentStatus();
    expect(byId(status, 'domain')).toMatchObject({ done: true, detail: 'acme.example' });
    expect(byId(status, 'tunnel').done).toBe(true);
    expect(byId(status, 'tunnel').detail).toContain('abcd1234');
    expect(status.outstanding).toBe(4); // npm, mail, backup, admin still blank
  });

  it('tunnel stays outstanding without account and zone ids', async () => {
    settingsRows({ exposure_cloudflare_tunnel_id: 'abcd1234ef' });
    expect((await getDeploymentStatus()).checks.find((c) => c.id === 'tunnel')!.done).toBe(false);
  });

  it('folds mail, backup and the user count into their checks', async () => {
    mockedMail.mockResolvedValue({ fromAddress: 'hi@acme.example', smtpHost: 'smtp.acme' } as never);
    mockedBackup.mockResolvedValue({ kind: 'sftp', server: 'nas.acme' } as never);
    mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@acme.example', displayName: '', groups: [] });
    mockedUsers.mockReturnValue(['mig', 'anna', 'sam']);

    const status = await getDeploymentStatus();
    expect(byId(status, 'mail')).toMatchObject({ done: true, detail: 'hi@acme.example via smtp.acme' });
    expect(byId(status, 'backup').detail).toBe('sftp — nas.acme');
    expect(byId(status, 'admin').detail).toContain('3 users total');
  });

  it('singularises a one-user box', async () => {
    mockedAdmin.mockReturnValue({ username: 'mig', email: 'mig@acme.example', displayName: '', groups: [] });
    mockedUsers.mockReturnValue(['mig']);
    expect((await getDeploymentStatus()).checks.find((c) => c.id === 'admin')!.detail).toContain('1 user total');
  });
});
