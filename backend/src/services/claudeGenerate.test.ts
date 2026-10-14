import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSocialPost, AiKeyMissingError } from './claudeGenerate';
import { getActiveProviderKey, getAiApiKey } from '../utils/aiSettings';
import { AiChatCompletionError, callOpenAiCompatChat } from './aiChatCompletion';

vi.mock('../utils/aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/aiSettings')>()),
  getActiveProviderKey: vi.fn(),
  getAiApiKey: vi.fn(),
}));
vi.mock('./aiChatCompletion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiChatCompletion')>()),
  callOpenAiCompatChat: vi.fn(),
}));

const mockedGetKey = vi.mocked(getActiveProviderKey);
const mockedCallChat = vi.mocked(callOpenAiCompatChat);
const mockedGetAnyKey = vi.mocked(getAiApiKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetKey.mockResolvedValue({ provider: 'anthropic', key: 'sk-ant-test' });
});

describe('generateSocialPost', () => {
  it('throws AiKeyMissingError when the social_generate feature has no active provider key', async () => {
    mockedGetKey.mockResolvedValue(null);
    await expect(generateSocialPost('hi')).rejects.toBeInstanceOf(AiKeyMissingError);
    expect(mockedCallChat).not.toHaveBeenCalled();
  });

  it('calls the shared chat-completion helper with the active provider\'s base URL, key and generate model', async () => {
    mockedCallChat.mockResolvedValue('Ship it. #launch');
    const text = await generateSocialPost('announce the launch');

    expect(text).toBe('Ship it. #launch');
    expect(mockedCallChat).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.anthropic.com/v1/',
        apiKey: 'sk-ant-test',
        model: 'claude-opus-5',
        userPrompt: 'announce the launch',
      })
    );
  });

  it('uses whichever provider the feature is actually configured for', async () => {
    mockedGetKey.mockResolvedValue({ provider: 'groq', key: 'gsk_test' });
    mockedCallChat.mockResolvedValue('post');

    await generateSocialPost('x');

    expect(mockedCallChat).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'gsk_test', model: 'openai/gpt-oss-120b' })
    );
  });
});

// plan.md §953: Gemini answered "high demand" three times in ten minutes and the owner only saw "try again".
describe('generateSocialPost when the provider is busy', () => {
  const busy = () => new AiChatCompletionError('AI provider request failed: high demand', true);
  const keys: Record<string, string | null> = { anthropic: null, google: 'AIza-test', groq: 'gsk_test' };

  beforeEach(() => {
    vi.useFakeTimers();
    mockedGetKey.mockResolvedValue({ provider: 'google', key: 'AIza-test' });
    mockedGetAnyKey.mockImplementation(async (p) => keys[p]);
  });
  afterEach(() => vi.useRealTimers());

  const run = async (prompt = 'x') => {
    const result = generateSocialPost(prompt).then((v) => ({ v }), (e: unknown) => ({ e }));
    await vi.runAllTimersAsync();
    return result;
  };

  it('tries the same provider once more after a short wait', async () => {
    mockedCallChat.mockRejectedValueOnce(busy()).mockResolvedValueOnce('second try');

    expect(await run()).toEqual({ v: 'second try' });
    expect(mockedCallChat.mock.calls.map(([r]) => r.apiKey)).toEqual(['AIza-test', 'AIza-test']);
  });

  it('then moves to another provider that has a key', async () => {
    mockedCallChat.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValueOnce('from groq');

    expect(await run()).toEqual({ v: 'from groq' });
    expect(mockedCallChat.mock.calls.map(([r]) => r.apiKey)).toEqual(['AIza-test', 'AIza-test', 'gsk_test']);
    expect(mockedCallChat.mock.calls[2][0]).toMatchObject({ baseUrl: 'https://api.groq.com/openai/v1/', model: 'openai/gpt-oss-120b' });
  });

  it('gives up with the first provider\'s error when every one is busy', async () => {
    const first = busy();
    mockedCallChat.mockRejectedValueOnce(first).mockRejectedValue(busy());

    expect(await run()).toEqual({ e: first });
    expect(mockedCallChat).toHaveBeenCalledTimes(3);
  });

  it('does not retry or switch on an error that is not temporary, like a bad key', async () => {
    const badKey = new AiChatCompletionError('AI provider request failed: invalid key', false);
    mockedCallChat.mockRejectedValueOnce(badKey);

    expect(await run()).toEqual({ e: badKey });
    expect(mockedCallChat).toHaveBeenCalledTimes(1);
  });
});
