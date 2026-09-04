import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../utils/httpJson';
import {
  guacamoleCreateUser,
  guacamoleGetUser,
  guacamoleListUsers,
  guacamoleLogin,
  guacamoleLogout,
  guacamoleSetPassword,
  guacamoleSetUserDisabled,
} from './guacamoleClient';

const session = { authToken: 'tok', dataSource: 'postgresql' };

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

describe('guacamoleGetUser', () => {
  it('GETs the per-datasource user endpoint with the auth token header', async () => {
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: { username: 'alice', disabled: false, attributes: {} },
      raw: '',
    });

    const user = await guacamoleGetUser('http://guac:8080', session, 'alice');

    expect(user).toEqual({ username: 'alice', disabled: false, attributes: {} });
    expect(mockedRequestJson).toHaveBeenCalledWith(
      'http://guac:8080/api/session/data/postgresql/users/alice',
      expect.objectContaining({ headers: { 'Guacamole-Token': 'tok' } })
    );
  });

  it('returns null on a 404', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 404, body: null, raw: '' });

    const user = await guacamoleGetUser('http://guac:8080', session, 'nobody');

    expect(user).toBeNull();
  });

  it('throws on any other non-200', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 500, body: null, raw: '' });

    await expect(guacamoleGetUser('http://guac:8080', session, 'alice')).rejects.toThrow('500');
  });
});

describe('guacamoleListUsers', () => {
  it('GETs the directory and returns the username-keyed map as-is', async () => {
    const body = {
      guacadmin: { username: 'guacadmin', disabled: false, attributes: {} },
      alice: { username: 'alice', disabled: true, attributes: {} },
    };
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body, raw: '' });

    const users = await guacamoleListUsers('http://guac:8080', session);

    expect(users).toEqual(body);
    expect(mockedRequestJson).toHaveBeenCalledWith(
      'http://guac:8080/api/session/data/postgresql/users',
      expect.objectContaining({ headers: { 'Guacamole-Token': 'tok' } })
    );
  });

  it('throws on a non-200 response', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 500, body: null, raw: '' });

    await expect(guacamoleListUsers('http://guac:8080', session)).rejects.toThrow('500');
  });
});

describe('guacamoleCreateUser', () => {
  it('POSTs an enabled user with no attributes', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 200, body: {}, raw: '' });

    await guacamoleCreateUser('http://guac:8080', session, 'alice', 'secret');

    expect(mockedRequestJson).toHaveBeenCalledWith(
      'http://guac:8080/api/session/data/postgresql/users',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Guacamole-Token': 'tok' },
        body: { username: 'alice', password: 'secret', disabled: false, attributes: {} },
      })
    );
  });

  it('throws on a non-2xx response', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 400, body: { message: 'exists' }, raw: '' });

    await expect(guacamoleCreateUser('http://guac:8080', session, 'alice', 'secret')).rejects.toThrow('400');
  });
});

describe('guacamoleSetUserDisabled', () => {
  it('fetches the user, then PUTs it back with only disabled flipped, preserving attributes', async () => {
    mockedRequestJson
      .mockResolvedValueOnce({
        statusCode: 200,
        body: { username: 'alice', disabled: false, attributes: { 'guac-full-name': 'Alice' } },
        raw: '',
      })
      .mockResolvedValueOnce({ statusCode: 204, body: null, raw: '' });

    await guacamoleSetUserDisabled('http://guac:8080', session, 'alice', true);

    expect(mockedRequestJson).toHaveBeenLastCalledWith(
      'http://guac:8080/api/session/data/postgresql/users/alice',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Guacamole-Token': 'tok' },
        body: { username: 'alice', disabled: true, attributes: { 'guac-full-name': 'Alice' } },
      })
    );
  });

  it('is a no-op when the user already has the wanted disabled state', async () => {
    mockedRequestJson.mockResolvedValueOnce({
      statusCode: 200,
      body: { username: 'alice', disabled: true, attributes: {} },
      raw: '',
    });

    await guacamoleSetUserDisabled('http://guac:8080', session, 'alice', true);

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
  });

  it('throws when the user does not exist', async () => {
    mockedRequestJson.mockResolvedValueOnce({ statusCode: 404, body: null, raw: '' });

    await expect(guacamoleSetUserDisabled('http://guac:8080', session, 'nobody', true)).rejects.toThrow('does not exist');
  });
});
