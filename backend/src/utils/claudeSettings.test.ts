import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClaudeApiKey, maskClaudeKey } from './claudeSettings';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

beforeEach(() => vi.clearAllMocks());

describe('maskClaudeKey', () => {
  it('returns null for a missing key', () => {
    expect(maskClaudeKey(null)).toBeNull();
    expect(maskClaudeKey('')).toBeNull();
  });

  it('blanks a short key entirely rather than leaking most of it', () => {
    expect(maskClaudeKey('sk-ant-abc')).toBe('••••••••');
  });

  it('shows only the first 7 and last 4 characters of a real key', () => {
    expect(maskClaudeKey('sk-ant-api03-abcdefghijklmnop-1234')).toBe('sk-ant-…1234');
  });
});

describe('getClaudeApiKey', () => {
  it('returns the trimmed stored value', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ value: '  sk-ant-xyz  ' }] } as never);
    expect(await getClaudeApiKey()).toBe('sk-ant-xyz');
  });

  it('returns null when unset or blank', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never);
    expect(await getClaudeApiKey()).toBeNull();
    mockedQuery.mockResolvedValue({ rows: [{ value: '   ' }] } as never);
    expect(await getClaudeApiKey()).toBeNull();
  });
});
