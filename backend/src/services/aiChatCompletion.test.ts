import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiChatCompletionError, callOpenAiCompatChat } from './aiChatCompletion';

const baseRequest = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'test-key',
  model: 'test-model',
  systemPrompt: 'system',
  userPrompt: 'user',
  maxTokens: 100,
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('callOpenAiCompatChat', () => {
  it('posts to <baseUrl>chat/completions with a bearer token and the OpenAI chat shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi there' } }] }));

    const text = await callOpenAiCompatChat(baseRequest);

    expect(text).toBe('hi there');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user' },
      ],
    });
  });

  it('trims the returned text', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '  padded  ' } }] }));
    expect(await callOpenAiCompatChat(baseRequest)).toBe('padded');
  });

  it('throws AiChatCompletionError with the provider\'s error message on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { message: 'invalid api key' } }));
    await expect(callOpenAiCompatChat(baseRequest)).rejects.toThrow(/invalid api key/);
  });

  it('reads the message from Gemini\'s array-wrapped error body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, [{ error: { code: 404, message: 'models/gemini-2.5-pro is not found', status: 'NOT_FOUND' } }])
    );
    await expect(callOpenAiCompatChat(baseRequest)).rejects.toThrow(/gemini-2\.5-pro is not found/);
  });

  it('throws when the response has no text', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { choices: [{ message: {} }] }));
    await expect(callOpenAiCompatChat(baseRequest)).rejects.toBeInstanceOf(AiChatCompletionError);
  });

  // plan.md §953: an overloaded or rate-limited provider is worth retrying or replacing; a bad key is not.
  it('marks 429 and 5xx answers as temporary, and others as not', async () => {
    for (const [status, temporary] of [[429, true], [500, true], [503, true], [401, false], [404, false]] as const) {
      fetchMock.mockResolvedValueOnce(jsonResponse(status, [{ error: { message: 'busy' } }]));
      const error = await callOpenAiCompatChat(baseRequest).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiChatCompletionError);
      expect((error as AiChatCompletionError).temporary).toBe(temporary);
    }
  });

  it('wraps a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(callOpenAiCompatChat(baseRequest)).rejects.toThrow(/Unable to reach the AI provider/);
  });
});
