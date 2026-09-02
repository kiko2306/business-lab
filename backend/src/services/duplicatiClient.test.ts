import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// duplicatiClient imports these at module load; getBackupJobStatus itself
// touches neither, so a bare stub is enough to import the module in isolation.
vi.mock('../utils/database', () => ({ query: vi.fn() }));
vi.mock('../utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  getBackupJobStatus,
  parseDuplicatiTimestamp,
  sanitizeTargetUrl,
} from './duplicatiClient';

describe('sanitizeTargetUrl', () => {
  it('strips the query string, which is where Google Drive keeps its AuthID', () => {
    expect(sanitizeTargetUrl('googledrive://homelab-backups?authid=1ffa:secret-token'))
      .toBe('googledrive://homelab-backups');
  });

  it('strips userinfo credentials from a share URL', () => {
    expect(sanitizeTargetUrl('ssh://user:hunter2@nas.local/volume1/backup'))
      .toBe('ssh://nas.local/volume1/backup');
  });

  it('leaves a mounted destination untouched', () => {
    expect(sanitizeTargetUrl('file:///backups')).toBe('file:///backups');
  });
});

describe('parseDuplicatiTimestamp', () => {
  it('widens Duplicati\'s compact form into ISO 8601', () => {
    expect(parseDuplicatiTimestamp('20260901T153928Z')).toBe('2026-09-01T15:39:28.000Z');
  });

  it('passes an already-ISO value through', () => {
    expect(parseDuplicatiTimestamp('2026-09-01T15:39:28.000Z')).toBe('2026-09-01T15:39:28.000Z');
  });

  it('returns null for empty or unrecognised input', () => {
    expect(parseDuplicatiTimestamp('')).toBeNull();
    expect(parseDuplicatiTimestamp(undefined)).toBeNull();
    expect(parseDuplicatiTimestamp('not a date')).toBeNull();
  });
});

describe('getBackupJobStatus', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const jsonResponse = (body: unknown, status = 200) => ({
    status,
    text: async () => JSON.stringify(body),
  });

  it('returns UNREACHABLE without calling Duplicati when there is no password', async () => {
    const status = await getBackupJobStatus(null);
    expect(status).toMatchObject({ reachable: false, configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the managed job\'s metadata and sanitises the destination', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ AccessToken: 'tok' })) // login
      .mockResolvedValueOnce(
        jsonResponse([
          {
            Backup: {
              Name: 'Homelab apps (managed by dashboard)',
              TargetURL: 'googledrive://homelab-backups?authid=1ffa:secret',
              Metadata: {
                TargetFilesetsCount: '3',
                BackupListCount: '2',
                TargetSizeString: '593.215 MiB',
                TargetFilesSize: '622030693',
                SourceSizeString: '1.228 GiB',
                LastBackupStarted: '20260901T153928Z',
                LastBackupFinished: '20260901T171301Z',
                LastBackupDuration: '01:33:33.2743087',
                LastErrorDate: '20260901T153411Z',
                LastErrorMessage: 'The operation has timed out.',
              },
            },
          },
        ])
      );

    const status = await getBackupJobStatus('pw');

    expect(status).toEqual({
      reachable: true,
      configured: true,
      destination: 'googledrive://homelab-backups',
      // live fileset count wins over the trailing BackupListCount
      versionCount: 3,
      destinationSize: '593.215 MiB',
      destinationSizeBytes: 622030693,
      sourceSize: '1.228 GiB',
      lastBackupAt: '2026-09-01T15:39:28.000Z',
      lastBackupFinishedAt: '2026-09-01T17:13:01.000Z',
      lastBackupDuration: '01:33:33',
      lastErrorAt: '2026-09-01T15:34:11.000Z',
      lastErrorMessage: 'The operation has timed out.',
    });
  });

  it('reports reachable-but-unconfigured when the managed job is absent', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ AccessToken: 'tok' }))
      .mockResolvedValueOnce(jsonResponse([{ Backup: { Name: 'someone else\'s job' } }]));

    const status = await getBackupJobStatus('pw');
    expect(status).toMatchObject({ reachable: true, configured: false, destination: null });
  });

  it('swallows a Duplicati that rejects the password and returns UNREACHABLE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('unauthorized', 401));
    const status = await getBackupJobStatus('wrong');
    expect(status).toMatchObject({ reachable: false, configured: false });
  });
});
