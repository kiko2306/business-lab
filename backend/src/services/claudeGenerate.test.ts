import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSocialPost, AiKeyMissingError } from './claudeGenerate';
import { getActiveProviderKey } from '../utils/aiSettings';
import { callOpenAiCompatChat } from './aiChatCompletion';

vi.mock('../utils/aiSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/aiSettings')>()),
  getActiveProviderKey: vi.fn(),
}));
vi.mock('./aiChatCompletion', () => ({ callOpenAiCompatChat: vi.fn() }));

const mockedGetKey = vi.mocked(getActiveProviderKey);
const mockedCallChat = vi.mocked(callOpenAiCompatChat);

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
      expect.objectContaining({ baseUrl: 'https://api.groq.com/openai/v1/', apiKey: 'gsk_test', model: 'llama-3.3-70b-versatile' })
    );
  });
});
