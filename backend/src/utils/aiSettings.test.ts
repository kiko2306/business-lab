import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AI_PROVIDERS,
  ensureAiApiKeyMigration,
  getActiveProviderKey,
  getAiApiKey,
  getFeatureProvider,
  isValidProviderId,
  maskAiApiKey,
  setAiApiKey,
} from './aiSettings';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('maskAiApiKey', () => {
  it('returns null for a missing key', () => {
    expect(maskAiApiKey(null)).toBeNull();
    expect(maskAiApiKey('')).toBeNull();
  });

  it('blanks a short key entirely rather than leaking most of it', () => {
    expect(maskAiApiKey('sk-ant-abc')).toBe('••••••••');
  });

  it('shows only the first 7 and last 4 characters of a real key', () => {
    expect(maskAiApiKey('sk-ant-api03-abcdefghijklmnop-1234')).toBe('sk-ant-…1234');
  });
});

describe('isValidProviderId', () => {
  it('accepts every registered provider id', () => {
    for (const provider of AI_PROVIDERS) {
      expect(isValidProviderId(provider.id)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isValidProviderId('openai')).toBe(false);
    expect(isValidProviderId(undefined)).toBe(false);
    expect(isValidProviderId(null)).toBe(false);
  });
});

describe('getAiApiKey', () => {
  it('returns the trimmed stored value for that provider', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ value: '  sk-ant-xyz  ' }] } as never);
    expect(await getAiApiKey('anthropic')).toBe('sk-ant-xyz');
    expect(mockedQuery).toHaveBeenCalledWith(expect.any(String), ['ai_api_key_anthropic']);
  });

  it('returns null when unset or blank', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never);
    expect(await getAiApiKey('google')).toBeNull();
    mockedQuery.mockResolvedValue({ rows: [{ value: '   ' }] } as never);
    expect(await getAiApiKey('groq')).toBeNull();
  });
});

describe('getFeatureProvider', () => {
  it('falls back to anthropic when unset', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never);
    expect(await getFeatureProvider('social_generate')).toBe('anthropic');
  });

  it('falls back to anthropic when the stored value is stale/unknown', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ value: 'openai' }] } as never);
    expect(await getFeatureProvider('mealie_parse')).toBe('anthropic');
  });

  it('returns the stored provider when valid', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ value: 'groq' }] } as never);
    expect(await getFeatureProvider('social_generate')).toBe('groq');
  });
});

describe('getActiveProviderKey', () => {
  it('returns null when the feature\'s active provider has no key stored', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ value: 'google' }] } as never) // feature provider
      .mockResolvedValueOnce({ rows: [] } as never); // that provider's key
    expect(await getActiveProviderKey('social_generate')).toBeNull();
  });

  it('returns the provider and key when configured', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ value: 'groq' }] } as never)
      .mockResolvedValueOnce({ rows: [{ value: 'gsk_abc' }] } as never);
    expect(await getActiveProviderKey('mealie_parse')).toEqual({ provider: 'groq', key: 'gsk_abc' });
  });
});

describe('ensureAiApiKeyMigration', () => {
  it('backfills ai_api_key_anthropic from the legacy claude_api_key row', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] } as never) // getAiApiKey('anthropic') -> not migrated yet
      .mockResolvedValueOnce({ rows: [{ value: 'sk-ant-legacy' }] } as never) // legacy row
      .mockResolvedValueOnce({ rows: [] } as never); // the INSERT via setAiApiKey
    await ensureAiApiKeyMigration();
    expect(mockedQuery).toHaveBeenLastCalledWith(expect.any(String), ['ai_api_key_anthropic', 'sk-ant-legacy']);
  });

  it('is a no-op once ai_api_key_anthropic already exists', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ value: 'sk-ant-already-migrated' }] } as never);
    await ensureAiApiKeyMigration();
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when there is no legacy key either', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    await ensureAiApiKeyMigration();
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });
});

describe('setAiApiKey', () => {
  it('upserts under the provider-specific settings key', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never);
    await setAiApiKey('google', 'AIza-test');
    expect(mockedQuery).toHaveBeenCalledWith(expect.any(String), ['ai_api_key_google', 'AIza-test']);
  });
});
