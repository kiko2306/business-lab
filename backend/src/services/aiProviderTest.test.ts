import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeRequest extends EventEmitter {
  end: () => void;
  setTimeout: () => void;
  destroy: () => void;
}

const requestMock = vi.fn();
vi.mock('https', () => ({ default: { request: (...args: unknown[]) => requestMock(...args) } }));

import { testAiProviderKey } from './aiProviderTest';

/** Drives https.request's callback-based API with a canned status/body. */
function respondWith(status: number, body: string) {
  requestMock.mockImplementation((_url: string, _options: unknown, callback: (res: EventEmitter) => void) => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = status;
    const request = new EventEmitter() as FakeRequest;
    request.end = () => {
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    };
    request.setTimeout = () => {};
    request.destroy = () => {};
    return request;
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe('testAiProviderKey', () => {
  it('verifies an Anthropic key via x-api-key + anthropic-version headers', async () => {
    respondWith(200, '{}');
    const result = await testAiProviderKey('anthropic', 'sk-ant-test');
    expect(result).toEqual({ success: true, message: 'Anthropic API key verified.' });
    const [url, options] = requestMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1');
    expect(options.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' });
  });

  it('verifies a Google key as a query param, not a header', async () => {
    respondWith(200, '{}');
    await testAiProviderKey('google', 'AIza-test key');
    const [url, options] = requestMock.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=AIza-test%20key');
    expect(options.headers).toEqual({});
  });

  it('verifies a Groq key via a bearer token', async () => {
    respondWith(200, '{}');
    await testAiProviderKey('groq', 'gsk_test');
    const [url, options] = requestMock.mock.calls[0];
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
});
