import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({ query }));

const { resolveComposeFile } = vi.hoisted(() => ({ resolveComposeFile: vi.fn() }));
vi.mock('../config/services', () => ({ resolveComposeFile }));

const { regenerateSambaFiles, sambaUsernameFor } = vi.hoisted(() => ({
  regenerateSambaFiles: vi.fn(),
  sambaUsernameFor: vi.fn((name: string) => name.toLowerCase()),
}));
vi.mock('./sambaConfig', () => ({ SAMBA_SERVICE: 'samba', regenerateSambaFiles, sambaUsernameFor }));

const { recreateSambaContainer, setSambaAccountEnabled } = vi.hoisted(() => ({
  recreateSambaContainer: vi.fn(),
  setSambaAccountEnabled: vi.fn(),
}));
vi.mock('./sambaExec', () => ({ recreateSambaContainer, setSambaAccountEnabled }));

vi.mock('../utils/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { disableSambaUser, provisionSambaUser } from './sambaUserProvisioning';

beforeEach(() => {
  vi.clearAllMocks();
  resolveComposeFile.mockReturnValue({
    projectName: 'samba',
    appDir: '/apps/samba',
    composeFile: '/apps/samba/docker-compose.yml',
    composeArgs: '-f /apps/samba/docker-compose.yml',
  });
  query.mockResolvedValue({ rows: [{ id: 7, username: 'Bob' }] });
  regenerateSambaFiles.mockResolvedValue(new Map([[7, 'bob']]));
  recreateSambaContainer.mockResolvedValue(true);
  setSambaAccountEnabled.mockResolvedValue(true);
});

describe('provisionSambaUser', () => {
  it('is not installed → skips without touching the DB', async () => {
    resolveComposeFile.mockReturnValue({ projectName: 'samba', appDir: '/apps/samba', composeFile: null, composeArgs: '' });
    const result = await provisionSambaUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('not-installed');
    expect(query).not.toHaveBeenCalled();
  });

  it('reports not-found when no dashboard account matches the email', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await provisionSambaUser({ email: 'nobody@example.com', password: 'pw' });
    expect(result).toBe('not-found');
    expect(regenerateSambaFiles).not.toHaveBeenCalled();
  });

  it('writes users.conf/smb.conf with this user\'s fresh password *before* recreating the container, and re-enables', async () => {
    const result = await provisionSambaUser({ email: 'bob@example.com', password: 'new-pw' });

    expect(regenerateSambaFiles).toHaveBeenCalledWith('/apps/samba', { userId: 7, password: 'new-pw' });
    expect(recreateSambaContainer).toHaveBeenCalled();
    // Order matters: recreating via the generic restart path would re-run
    // config generation with no override and clobber the password that was
    // just written (the bug this shape exists to avoid) — regenerate must
    // still have run strictly before the recreate.
    expect(regenerateSambaFiles.mock.invocationCallOrder[0]).toBeLessThan(recreateSambaContainer.mock.invocationCallOrder[0]);
    expect(setSambaAccountEnabled).toHaveBeenCalledWith('bob', true);
    expect(result).toBe('updated');
  });

  it('reports failed when the regenerated map has no entry for this user', async () => {
    regenerateSambaFiles.mockResolvedValue(new Map());
    const result = await provisionSambaUser({ email: 'bob@example.com', password: 'pw' });
    expect(result).toBe('failed');
    expect(recreateSambaContainer).not.toHaveBeenCalled();
  });
});

describe('disableSambaUser', () => {
  it('is not installed → skips without touching the DB', async () => {
    resolveComposeFile.mockReturnValue({ projectName: 'samba', appDir: '/apps/samba', composeFile: null, composeArgs: '' });
    const result = await disableSambaUser('bob@example.com');
    expect(result).toBe('not-installed');
    expect(query).not.toHaveBeenCalled();
  });

  it('reports not-found when no dashboard account matches the email', async () => {
    query.mockResolvedValue({ rows: [] });
    const result = await disableSambaUser('nobody@example.com');
    expect(result).toBe('not-found');
    expect(setSambaAccountEnabled).not.toHaveBeenCalled();
  });

  it('disables the derived Samba account by username, never touching users.conf', async () => {
    const result = await disableSambaUser('bob@example.com');
    expect(setSambaAccountEnabled).toHaveBeenCalledWith('bob', false);
    expect(regenerateSambaFiles).not.toHaveBeenCalled();
    expect(result).toBe('disabled');
  });

  it('reports failed when the disable call fails', async () => {
    setSambaAccountEnabled.mockResolvedValue(false);
    const result = await disableSambaUser('bob@example.com');
    expect(result).toBe('failed');
  });
});
