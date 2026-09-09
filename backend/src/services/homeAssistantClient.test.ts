import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwner, getOnboardingState } from './homeAssistantClient';

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
