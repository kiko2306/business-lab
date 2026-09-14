import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkTwentyUserState, createTwentyWorkspace, getTwentyAccessToken } from './twentyClient';

vi.mock('../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  json: () => Promise.resolve(body),
});

describe('checkTwentyUserState', () => {
  it('reads "needs-signup" when the account does not exist', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { checkUserExists: { exists: false, availableWorkspacesCount: 0 } } })
    );
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('needs-signup');
  });

  it('reads "needs-workspace" for an account with no workspace yet', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { checkUserExists: { exists: true, availableWorkspacesCount: 0 } } })
    );
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('needs-workspace');
  });

  it('reads "already-owned" once a workspace exists', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { checkUserExists: { exists: true, availableWorkspacesCount: 1 } } })
    );
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('already-owned');
  });

  it('reads "unreachable" on a network error or a malformed response', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('unreachable');

    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'nope' }] }));
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('unreachable');

    fetchMock.mockResolvedValueOnce(jsonResponse({}, false));
    expect(await checkTwentyUserState('http://twenty', 'a@b.com')).toBe('unreachable');
  });
});

describe('getTwentyAccessToken', () => {
  it('pulls the workspace-agnostic token out of signUp', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { signUp: { tokens: { accessOrWorkspaceAgnosticToken: { token: 'tok-1' } } } } })
    );
    const token = await getTwentyAccessToken('http://twenty', 'signUp', 'a@b.com', 'pw');
    expect(token).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://twenty/graphql',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('pulls the token out of signIn the same way', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { signIn: { tokens: { accessOrWorkspaceAgnosticToken: { token: 'tok-2' } } } } })
    );
    expect(await getTwentyAccessToken('http://twenty', 'signIn', 'a@b.com', 'pw')).toBe('tok-2');
  });

  it('returns null on a GraphQL error, e.g. SIGNUP_DISABLED once a workspace already exists', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'Sign up is disabled', extensions: { subCode: 'SIGNUP_DISABLED' } }] })
    );
    expect(await getTwentyAccessToken('http://twenty', 'signUp', 'a@b.com', 'pw')).toBeNull();
  });
});

describe('createTwentyWorkspace', () => {
  it('sends the access token as a Bearer header and reports success from the workspace id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { signUpInNewWorkspace: { workspace: { id: 'ws-1' } } } })
    );
    const created = await createTwentyWorkspace('http://twenty', 'tok-1', 'Business Lab');
    expect(created).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(init.body).variables).toEqual({ input: { displayName: 'Business Lab' } });
  });

  it('reports failure on a GraphQL error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'nope' }] }));
    expect(await createTwentyWorkspace('http://twenty', 'tok-1', 'Business Lab')).toBe(false);
  });
});
