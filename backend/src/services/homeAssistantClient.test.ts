import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwner, getAdminAccessToken, getOnboardingState } from './homeAssistantClient';

const BASE = 'http://ha.test';
const realFetch = globalThis.fetch;

function jsonRes(status: number, body: unknown): Response {
  return { status, json: async () => body } as Response;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('getOnboardingState', () => {
  it('is needs-user when the user step is not done', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(200, [{ step: 'user', done: false }, { step: 'core_config', done: false }]));
    expect(await getOnboardingState(BASE)).toBe('needs-user');
  });

  it('is done when the user step is done', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(200, [{ step: 'user', done: true }]));
    expect(await getOnboardingState(BASE)).toBe('done');
  });

  it('is unreachable on a non-200', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(404, {}));
    expect(await getOnboardingState(BASE)).toBe('unreachable');
  });

  it('is unreachable when the body is not a step array with a user step', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(200, { message: 'not ready' }));
    expect(await getOnboardingState(BASE)).toBe('unreachable');
  });

  it('is unreachable on a network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await getOnboardingState(BASE)).toBe('unreachable');
  });
});

describe('createOwner', () => {
  const input = { name: 'Mig', username: 'mig', password: 'pw', clientId: 'https://ha.example/', language: 'en' };

  it('POSTs the onboarding body and returns created on 200', async () => {
    const f = vi.mocked(fetch).mockResolvedValue(jsonRes(200, { auth_code: 'abc' }));
    expect(await createOwner(BASE, input)).toBe('created');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ name: 'Mig', username: 'mig', password: 'pw', client_id: 'https://ha.example/', language: 'en' });
  });

  it('treats 403 (User step already done) as already-done', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(403, { message: 'User step already done' }));
    expect(await createOwner(BASE, input)).toBe('already-done');
  });

  it('is failed on any other status', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(500, {}));
    expect(await createOwner(BASE, input)).toBe('failed');
  });
});

describe('getAdminAccessToken', () => {
  it('drives the three-step login flow and returns the access token', async () => {
    const f = vi
      .mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, { flow_id: 'flow-1', type: 'form' }))
      .mockResolvedValueOnce(jsonRes(200, { type: 'create_entry', result: 'auth-code' }))
      .mockResolvedValueOnce(jsonRes(200, { access_token: 'token-abc', expires_in: 1800 }));

    const result = await getAdminAccessToken(BASE, 'admin', 'pw');

    expect(result).toEqual({ state: 'ok', accessToken: 'token-abc' });
    expect(f.mock.calls[0][0]).toBe(`${BASE}/auth/login_flow`);
    expect(f.mock.calls[1][0]).toBe(`${BASE}/auth/login_flow/flow-1`);
    const step2Body = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(step2Body).toEqual({ client_id: `${BASE}/`, username: 'admin', password: 'pw' });
    expect(f.mock.calls[2][0]).toBe(`${BASE}/auth/token`);
    const tokenBody = (f.mock.calls[2][1] as RequestInit).body as string;
    expect(tokenBody).toContain('grant_type=authorization_code');
    expect(tokenBody).toContain('code=auth-code');
  });

  it('fails when the login flow never returns a flow_id', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonRes(200, {}));
    expect(await getAdminAccessToken(BASE, 'admin', 'pw')).toEqual({ state: 'failed' });
  });

  it('fails when the credentials are wrong (the flow re-renders a form, not create_entry)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, { flow_id: 'flow-1' }))
      .mockResolvedValueOnce(jsonRes(200, { type: 'form', errors: { base: 'invalid_auth' } }));
    expect(await getAdminAccessToken(BASE, 'admin', 'wrong')).toEqual({ state: 'failed' });
  });

  it('fails when the token exchange itself fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonRes(200, { flow_id: 'flow-1' }))
      .mockResolvedValueOnce(jsonRes(200, { type: 'create_entry', result: 'auth-code' }))
      .mockResolvedValueOnce(jsonRes(400, {}));
    expect(await getAdminAccessToken(BASE, 'admin', 'pw')).toEqual({ state: 'failed' });
  });

  it('is failed on a network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await getAdminAccessToken(BASE, 'admin', 'pw')).toEqual({ state: 'failed' });
  });
});
