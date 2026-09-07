import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSocialPost, ClaudeKeyMissingError } from './claudeGenerate';
import { getClaudeApiKey } from '../utils/claudeSettings';

vi.mock('../utils/claudeSettings', () => ({ getClaudeApiKey: vi.fn() }));

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

const mockedGetKey = vi.mocked(getClaudeApiKey);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetKey.mockResolvedValue('sk-ant-test');
});

describe('generateSocialPost', () => {
  it('throws ClaudeKeyMissingError when no key is stored', async () => {
    mockedGetKey.mockResolvedValue(null);
    await expect(generateSocialPost('hi')).rejects.toBeInstanceOf(ClaudeKeyMissingError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('joins text blocks and trims, ignoring non-text blocks', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '  Ship it. ' },
        { type: 'text', text: '#launch' },
      ],
    });
    expect(await generateSocialPost('announce the launch')).toBe('Ship it. #launch');
  });

  it('throws when the response has no text', async () => {
    createMock.mockResolvedValue({ content: [{ type: 'thinking', thinking: 'x' }] });
    await expect(generateSocialPost('x')).rejects.toThrow('empty response');
  });
});
