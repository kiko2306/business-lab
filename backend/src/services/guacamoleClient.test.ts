import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../utils/httpJson';
import { guacamoleLogin, guacamoleLogout, guacamoleSetPassword } from './guacamoleClient';

vi.mock('../utils/httpJson', () => ({
  requestJson: vi.fn(),
}));

const mockedRequestJson = vi.mocked(requestJson);

beforeEach(() => {
  mockedRequestJson.mockReset();
});

describe('guacamoleLogin', () => {
  it('posts form-encoded credentials, not JSON', async () => {
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: { authToken: 'tok', dataSource: 'postgresql' },
      raw: '',
    });

    await guacamoleLogin('http://guac:8080', 'guacadmin', 'guacadmin');

    expect(mockedRequestJson).toHaveBeenCalledWith(
      'http://guac:8080/api/tokens',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        rawBody: Buffer.from('username=guacadmin&password=guacadmin'),
      })
    );
  });

  it('returns the session on a 200 with a token', async () => {
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: { authToken: 'tok', dataSource: 'postgresql' },
      raw: '',
    });

    const session = await guacamoleLogin('http://guac:8080', 'guacadmin', 'guacadmin');

    expect(session).toEqual({ authToken: 'tok', dataSource: 'postgresql' });
  });

  it('falls back to the postgresql data source when the response omits one', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: { authToken: 'tok' }, raw: '' });

    const session = await guacamoleLogin('http://guac:8080', 'guacadmin', 'guacadmin');

    expect(session?.dataSource).toBe('postgresql');
  });

  it('returns null when the credentials are rejected', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 403, body: { message: 'Permission denied.' }, raw: '' });

    const session = await guacamoleLogin('http://guac:8080', 'guacadmin', 'wrong');

    expect(session).toBeNull();
  });

  it('propagates a network-level failure instead of returning null', async () => {
    mockedRequestJson.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(guacamoleLogin('http://guac:8080', 'guacadmin', 'guacadmin')).rejects.toThrow('ECONNREFUSED');
  });
});

describe('guacamoleSetPassword', () => {
  it('PUTs the old/new password to the per-datasource user endpoint with the auth token header', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 204, body: null, raw: '' });

    const ok = await guacamoleSetPassword(
      'http://guac:8080',
      { authToken: 'tok', dataSource: 'postgresql' },
      'guacadmin',
      'guacadmin',
      'new-secret'
    );

    expect(ok).toBe(true);
    expect(mockedRequestJson).toHaveBeenCalledWith(
      'http://guac:8080/api/session/data/postgresql/users/guacadmin/password',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Guacamole-Token': 'tok' },
        body: { oldPassword: 'guacadmin', newPassword: 'new-secret' },
      })
    );
  });

  it('returns false on a non-2xx response', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 403, body: null, raw: '' });

    const ok = await guacamoleSetPassword(
      'http://guac:8080',
      { authToken: 'tok', dataSource: 'postgresql' },
      'guacadmin',
      'guacadmin',
      'new-secret'
    );

    expect(ok).toBe(false);
  });
});

describe('guacamoleLogout', () => {
  it('never throws even when the request fails', async () => {
    mockedRequestJson.mockRejectedValueOnce(new Error('boom'));

    await expect(guacamoleLogout('http://guac:8080', { authToken: 'tok', dataSource: 'postgresql' })).resolves.toBeUndefined();
  });
});
