import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/httpJson', () => ({ requestJson: vi.fn() }));

import { requestJson } from '../utils/httpJson';
import { immichAdminSignUp, immichEnsurePhotosLibrary } from './immichClient';

const mocked = vi.mocked(requestJson);
const reply = (statusCode: number, message: string) =>
  mocked.mockResolvedValue({ statusCode, body: { message }, raw: message } as never);

describe('immichAdminSignUp', () => {
  beforeEach(() => mocked.mockReset());

  it.each(['The server already has an admin', 'Admin setup is not available'])(
    'treats a 400 "%s" as already-exists',
    async (message) => {
      reply(400, message);
      expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('already-exists');
    }
  );

  it('reports created on 2xx and failed on anything else', async () => {
    reply(201, '');
    expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('created');
    reply(500, 'boom');
    expect(await immichAdminSignUp('http://i', 'a@b.c', 'pw', 'Admin')).toBe('failed');
  });
});

describe('immichEnsurePhotosLibrary', () => {
  const ok = (body: unknown, statusCode = 200) => ({ statusCode, body, raw: '' } as never);
  beforeEach(() => mocked.mockReset());

  it('logs in, creates the library when none covers /mnt/photos, and scans it', async () => {
    mocked
      .mockResolvedValueOnce(ok({ accessToken: 'tok', userId: 'u1' }, 201))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok({ id: 'lib1' }, 201))
      .mockResolvedValueOnce(ok(null, 204));

    expect(await immichEnsurePhotosLibrary('http://i', 'a@b.c', 'pw')).toBe('created');

    const calls = mocked.mock.calls;
    expect(calls[0][0]).toBe('http://i/api/auth/login');
    expect(calls[2][0]).toBe('http://i/api/libraries');
    expect(calls[2][1]?.body).toEqual({ ownerId: 'u1', name: 'Shared photos', importPaths: ['/mnt/photos'] });
    expect(calls[2][1]?.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(calls[3][0]).toBe('http://i/api/libraries/lib1/scan');
  });

  it('does nothing when a library already imports /mnt/photos', async () => {
    mocked
      .mockResolvedValueOnce(ok({ accessToken: 'tok', userId: 'u1' }, 201))
      .mockResolvedValueOnce(ok([{ id: 'x', importPaths: ['/mnt/photos'] }]));

    expect(await immichEnsurePhotosLibrary('http://i', 'a@b.c', 'pw')).toBe('exists');
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('reports failed when login is refused', async () => {
    mocked.mockResolvedValueOnce(ok({ message: 'Incorrect email or password' }, 401));
    expect(await immichEnsurePhotosLibrary('http://i', 'a@b.c', 'pw')).toBe('failed');
  });
});
