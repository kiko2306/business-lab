import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// kopiaClient only imports the logger; a bare stub keeps the module isolated.
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  checkKopiaConnection,
  cookieHeader,
  extractCsrfToken,
  getBackupSourceStatus,
  getRestoreTaskStatus,
  listSnapshots,
  provisionBackupSource,
  restoreSnapshot,
  runSnapshotNow,
} from './kopiaClient';

describe('extractCsrfToken', () => {
  it('pulls the token out of the meta tag', () => {
    const html = '<head><meta name="kopia-csrf-token" content="abc123" /></head>';
    expect(extractCsrfToken(html)).toBe('abc123');
  });

  it('tolerates extra whitespace and is case-insensitive on the tag', () => {
    const html = '<META  NAME="kopia-csrf-token"   content="deadbeef" >';
    expect(extractCsrfToken(html)).toBe('deadbeef');
  });

  it('returns null when the tag is absent', () => {
    expect(extractCsrfToken('<head></head>')).toBeNull();
  });
});

describe('cookieHeader', () => {
  it('keeps only the name=value pair of each Set-Cookie and joins them', () => {
    expect(
      cookieHeader(['Kopia-Session-Cookie=abc; Path=/; HttpOnly', 'Kopia-Auth=xyz; Path=/; Expires=later'])
    ).toBe('Kopia-Session-Cookie=abc; Kopia-Auth=xyz');
  });

  it('drops empty entries', () => {
    expect(cookieHeader(['', 'A=1; Path=/'])).toBe('A=1');
  });
});

// --- transport mocking ------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The `GET /` response that opens a session — carries cookies + the token. */
const sessionResponse = (status = 200, csrf = 'tok') => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () =>
    `<html><head><meta name="kopia-csrf-token" content="${csrf}" /></head></html>`,
  headers: {
    getSetCookie: () => ['Kopia-Session-Cookie=s; Path=/', 'Kopia-Auth=a; Path=/'],
    get: () => null,
  },
});

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  headers: { getSetCookie: () => [], get: () => null },
});

const SOURCES_ONE = {
  localUsername: 'root',
  localHost: 'kopia',
  sources: [
    {
      source: { userName: 'root', host: 'kopia', path: '/source/apps' },
      status: 'IDLE',
      lastSnapshot: {
        startTime: '2026-09-04T11:34:13Z',
        stats: { totalSize: 2048, fileCount: 7, errorCount: 0 },
      },
    },
  ],
};
const SOURCES_NONE = { localUsername: 'root', localHost: 'kopia', sources: [] };

describe('checkKopiaConnection', () => {
  it('reports ok with the repository description when connected', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: true, description: 'Repository in Filesystem: /repository' }));

    expect(await checkKopiaConnection('pw')).toEqual({
      ok: true,
      detail: 'Repository in Filesystem: /repository',
    });
  });

  it('reports not-ok when the server is up but has no repository', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: false }));

    const result = await checkKopiaConnection('pw');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not connected to a repository/i);
  });

  it('turns a 401 at the login into a credentials message, without throwing', async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse(401));
    const result = await checkKopiaConnection('wrong');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/KOPIA_SERVER_PASSWORD/);
  });
});

describe('provisionBackupSource', () => {
  it('registers the source and reports created:true when it was absent', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: true })) // repo/status
      .mockResolvedValueOnce(jsonResponse(SOURCES_NONE)) // sources (pre-check)
      .mockResolvedValueOnce(jsonResponse({ snapshotted: false })) // POST /sources
      .mockResolvedValueOnce(jsonResponse(SOURCES_NONE)); // localSourceId

    const result = await provisionBackupSource('pw');
    expect(result).toEqual({
      created: true,
      source: { userName: 'root', host: 'kopia', path: '/source/apps' },
    });

    // The POST body must carry an inline policy, or Kopia answers "missing policy".
    const postInit = fetchMock.mock.calls[3][1];
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/api\/v1\/sources$/);
    expect(postInit.method).toBe('POST');
    expect(JSON.parse(postInit.body)).toMatchObject({ path: '/source/apps', policy: {} });
  });

  it('reports created:false when the source already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: true }))
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE))
      .mockResolvedValueOnce(jsonResponse({ snapshotted: false }))
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE));

    expect((await provisionBackupSource('pw')).created).toBe(false);
  });

  it('throws when the repository is not connected', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: false }));

    await expect(provisionBackupSource('pw')).rejects.toThrow(/not connected to a repository/i);
  });

  it('throws when Kopia rejects the source registration', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: true }))
      .mockResolvedValueOnce(jsonResponse(SOURCES_NONE))
      .mockResolvedValueOnce(jsonResponse({ code: 'MALFORMED_REQUEST', error: 'missing policy' }, 400));

    await expect(provisionBackupSource('pw')).rejects.toThrow(/missing policy/);
  });
});

describe('runSnapshotNow', () => {
  it('returns started:false when no managed source is registered yet', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse(SOURCES_NONE));

    expect(await runSnapshotNow('pw')).toEqual({
      started: false,
      detail: 'no dashboard-managed backup source exists yet',
    });
  });

  it('triggers the upload and returns started:true', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE))
      .mockResolvedValueOnce(jsonResponse({ sources: { 'root@kopia:/source/apps': { success: true } } }));

    const result = await runSnapshotNow('pw');
    expect(result.started).toBe(true);

    const uploadUrl = String(fetchMock.mock.calls[2][0]);
    expect(uploadUrl).toContain('/api/v1/sources/upload?');
    expect(uploadUrl).toContain('path=%2Fsource%2Fapps');
  });

  it('returns started:false when Kopia reports the snapshot did not succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE))
      .mockResolvedValueOnce(jsonResponse({ sources: { 'root@kopia:/source/apps': { success: false } } }));

    expect((await runSnapshotNow('pw')).started).toBe(false);
  });

  it('swallows an unreachable server', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const result = await runSnapshotNow('pw');
    expect(result).toEqual({ started: false, detail: 'connect ECONNREFUSED' });
  });
});

describe('listSnapshots', () => {
  it('maps the fields the dashboard needs, including the root id', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE)) // localSourceId
      .mockResolvedValueOnce(
        jsonResponse({
          snapshots: [
            {
              id: 'manifest-1',
              rootID: 'k541aa98',
              startTime: '2026-09-04T11:34:13Z',
              endTime: '2026-09-04T11:34:14Z',
              summary: { size: 2048, files: 7 },
              retention: ['latest-1', 'daily-1'],
            },
          ],
        })
      );

    expect(await listSnapshots('pw')).toEqual([
      {
        id: 'manifest-1',
        rootId: 'k541aa98',
        startTime: '2026-09-04T11:34:13Z',
        endTime: '2026-09-04T11:34:14Z',
        sizeBytes: 2048,
        fileCount: 7,
        retentionReasons: ['latest-1', 'daily-1'],
      },
    ]);
  });

  it('returns an empty list rather than throwing when Kopia is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    expect(await listSnapshots('pw')).toEqual([]);
  });
});

describe('restoreSnapshot', () => {
  it('returns the task id and forces a full (non-shallow) restore', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ id: '7', status: 'RUNNING' }));

    const result = await restoreSnapshot('pw', { rootId: 'kroot', targetPath: '/tmp/out' });
    expect(result).toEqual({ taskId: '7' });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.root).toBe('kroot');
    expect(body.fsOutput.targetPath).toBe('/tmp/out');
    expect(body.options.restoreDirEntryAtDepth).toBe(2147483647);
    expect(body.options.minSizeForPlaceholder).toBe(0);
    expect(body.options.incremental).toBe(false);
  });

  it('throws when Kopia rejects the restore', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', error: 'object not found' }, 404));

    await expect(
      restoreSnapshot('pw', { rootId: 'bad', targetPath: '/tmp/out' })
    ).rejects.toThrow(/object not found/);
  });

  it('throws when the restore is accepted but no task id comes back', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ status: 'RUNNING' }));

    await expect(
      restoreSnapshot('pw', { rootId: 'kroot', targetPath: '/tmp/out' })
    ).rejects.toThrow(/no task id/);
  });
});

describe('getRestoreTaskStatus', () => {
  it('maps a finished restore', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'SUCCESS',
          counters: { 'Restored Bytes': { value: 2048 }, 'Restored Files': { value: 7 } },
        })
      );

    expect(await getRestoreTaskStatus('pw', '7')).toEqual({
      status: 'SUCCESS',
      running: false,
      succeeded: true,
      restoredBytes: 2048,
      restoredFiles: 7,
      error: null,
    });
  });

  it('surfaces a failed task as a normal return with the error set', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ status: 'FAILED', errorMessage: 'disk full' }));

    const result = await getRestoreTaskStatus('pw', '7');
    expect(result.succeeded).toBe(false);
    expect(result.error).toBe('disk full');
  });

  it('throws when the task lookup itself fails', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse('no such task', 404));

    await expect(getRestoreTaskStatus('pw', '99')).rejects.toThrow(/lookup failed/);
  });
});

describe('getBackupSourceStatus', () => {
  it('returns UNREACHABLE without calling Kopia when there is no password', async () => {
    const status = await getBackupSourceStatus(null);
    expect(status).toMatchObject({ reachable: false, configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the managed source and its last snapshot', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(
        jsonResponse({ connected: true, description: 'Repository in Filesystem: /repository', storage: 'filesystem' })
      )
      .mockResolvedValueOnce(jsonResponse(SOURCES_ONE))
      .mockResolvedValueOnce(jsonResponse({ snapshots: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));

    expect(await getBackupSourceStatus('pw')).toEqual({
      reachable: true,
      configured: true,
      repositoryDescription: 'Repository in Filesystem: /repository',
      storageType: 'filesystem',
      snapshotCount: 3,
      lastSnapshotAt: '2026-09-04T11:34:13Z',
      lastSnapshotSizeBytes: 2048,
      lastSnapshotFileCount: 7,
      lastSnapshotErrorCount: 0,
      sourceStatus: 'IDLE',
    });
  });

  it('reports reachable-but-unconfigured when the server has no repository', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(jsonResponse({ connected: false }));

    expect(await getBackupSourceStatus('pw')).toMatchObject({ reachable: true, configured: false });
  });

  it('degrades to UNREACHABLE when Kopia throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    expect(await getBackupSourceStatus('pw')).toMatchObject({ reachable: false });
  });
});
