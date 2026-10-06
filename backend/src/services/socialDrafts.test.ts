import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { ensureSocialDraftsTable, listDrafts, recordSend } from './socialDrafts';

vi.mock('../utils/database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

beforeEach(() => mockedQuery.mockReset());

// plan.md §845 fix 3: a draft remembers its last send.
describe('social drafts: last send', () => {
  it('adds the columns to a table that already exists, so a running box upgrades in place', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as never);
    await ensureSocialDraftsTable();
    const sql = mockedQuery.mock.calls.map(([q]) => String(q)).join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_sent_at');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS last_sent_count');
  });

  it('returns lastSentAt and lastSentCount, null for a draft never sent', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, prompt: 'p', content: 'c', created_at: 'x', updated_at: 'y', last_sent_at: null, last_sent_count: null },
        { id: 2, prompt: 'p', content: 'c', created_at: 'x', updated_at: 'y', last_sent_at: '2026-10-06T10:00:00Z', last_sent_count: 12 },
      ],
    } as never);

    const drafts = await listDrafts();

    expect(drafts[0]).toMatchObject({ lastSentAt: null, lastSentCount: null });
    expect(drafts[1]).toMatchObject({ lastSentAt: '2026-10-06T10:00:00Z', lastSentCount: 12 });
  });

  it('stamps the time and count of a send', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);
    await recordSend(4, 9);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('last_sent_at = NOW()');
    expect(params).toEqual([4, 9]);
  });
});
