import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestJsonMock = vi.fn();
vi.mock('../utils/httpJson', () => ({ requestJson: (...args: unknown[]) => requestJsonMock(...args) }));

import { testAiProviderKey } from './aiProviderTest';

/** Canned reply from the shared JSON client; `raw` is what the provider sent. */
function respondWith(statusCode: number, raw: string) {
  requestJsonMock.mockResolvedValue({ statusCode, body: null, raw });
}

beforeEach(() => {
  requestJsonMock.mockReset();
});

describe('testAiProviderKey', () => {
  it('verifies an Anthropic key via x-api-key + anthropic-version headers', async () => {
    respondWith(200, '{}');
    const result = await testAiProviderKey('anthropic', 'sk-ant-test');
    expect(result).toEqual({ success: true, message: 'Anthropic API key verified.' });
    const [url, options] = requestJsonMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(options.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' });
  });

  it('verifies a Google key as a query param, not a header', async () => {
    respondWith(200, '{}');
    await testAiProviderKey('google', 'AIza-test key');
    const [url, options] = requestJsonMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=AIza-test%20key');
    expect(options.headers).toEqual({});
  });

  it('verifies a Groq key via a bearer token', async () => {
    respondWith(200, '{}');
    await testAiProviderKey('groq', 'gsk_test');
    const [url, options] = requestJsonMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect(options.headers).toEqual({ Authorization: 'Bearer gsk_test' });
  });

  it('reports a rejected key with the provider\'s error detail', async () => {
    respondWith(401, JSON.stringify({ error: { message: 'invalid x-api-key' } }));
    const result = await testAiProviderKey('anthropic', 'bad-key');
    expect(result).toEqual({ success: false, message: 'Key rejected: invalid x-api-key' });
  });

  it('falls back to a bare status code when the error body is not JSON', async () => {
    respondWith(500, 'gateway error');
    const result = await testAiProviderKey('groq', 'any-key');
    expect(result).toEqual({ success: false, message: 'HTTP 500' });
  });

  // requestJson's timeout message names the URL, and Google's carries the key as a
  // query param; it must not reach the caller (the route returns error text).
  it('does not leak the key through a transport error', async () => {
    requestJsonMock.mockRejectedValue(
      new Error('Request to https://generativelanguage.googleapis.com/v1beta/models?key=AIza-secret timed out.')
    );
    await expect(testAiProviderKey('google', 'AIza-secret')).rejects.toThrow(/timed out/);
    await expect(testAiProviderKey('google', 'AIza-secret')).rejects.not.toThrow(/AIza-secret/);
  });
});
