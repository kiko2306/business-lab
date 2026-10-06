import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import {
  subscribe,
  unsubscribeByToken,
  listActiveSubscribers,
  listAllSubscribers,
  addSubscriber,
  removeSubscriber,
} from './advertSubscribers';

vi.mock('../utils/database', () => ({ query: vi.fn() }));

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('subscribe', () => {
  it('upserts on email, generating a fresh token to insert but not touching it on conflict', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    await subscribe('reader@example.com');

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL');
    expect(sql).not.toContain('unsubscribe_token = ');
    expect(params).toEqual(['reader@example.com', expect.any(String)]);
  });
});

describe('unsubscribeByToken', () => {
  it('marks the matching, still-active row unsubscribed', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    await unsubscribeByToken('tok123');

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('WHERE unsubscribe_token = $1 AND unsubscribed_at IS NULL');
    expect(params).toEqual(['tok123']);
  });

  it('resolves without error for an unknown token — a repeat hit must not fail', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    await expect(unsubscribeByToken('unknown')).resolves.toBeUndefined();
  });
});

describe('listActiveSubscribers', () => {
  it('maps rows to camelCase, excluding unsubscribed addresses at the query level', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ email: 'a@example.com', unsubscribe_token: 'tok-a' }],
    } as never);

    await expect(listActiveSubscribers()).resolves.toEqual([{ email: 'a@example.com', unsubscribeToken: 'tok-a' }]);
    expect(mockedQuery.mock.calls[0][0]).toContain('WHERE unsubscribed_at IS NULL');
  });
});

// plan.md §847/§845 fix 2: the dashboard's own view of the list.
describe('listAllSubscribers', () => {
  it('returns active and unsubscribed rows alike, never the unsubscribe token', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, email: 'a@example.com', subscribed_at: new Date('2026-10-01T10:00:00Z'), unsubscribed_at: null },
        { id: 2, email: 'b@example.com', subscribed_at: new Date('2026-10-02T10:00:00Z'), unsubscribed_at: new Date('2026-10-03T10:00:00Z') },
      ],
    } as never);

    const rows = await listAllSubscribers();

    expect(rows).toEqual([
      { id: 1, email: 'a@example.com', subscribedAt: '2026-10-01T10:00:00.000Z', unsubscribedAt: null },
      { id: 2, email: 'b@example.com', subscribedAt: '2026-10-02T10:00:00.000Z', unsubscribedAt: '2026-10-03T10:00:00.000Z' },
    ]);
    expect(mockedQuery.mock.calls[0][0]).not.toContain('unsubscribe_token');
  });
});

describe('addSubscriber', () => {
  it('adds a new address', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] } as never);

    await expect(addSubscriber('new@example.com')).resolves.toBe('added');
    expect(mockedQuery.mock.calls[0][0]).toContain('ON CONFLICT (email) DO NOTHING');
  });

  it('reports an address that is already on the list, changing nothing', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ unsubscribed_at: null }] } as never);

    await expect(addSubscriber('a@example.com')).resolves.toBe('exists');
  });

  it('does not override an opt-out: only the person can resubscribe, through the public form', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ unsubscribed_at: new Date() }] } as never);

    await expect(addSubscriber('gone@example.com')).resolves.toBe('unsubscribed');
    // No UPDATE ran: two queries, the insert that did nothing and the read.
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls.every(([sql]) => !String(sql).includes('UPDATE'))).toBe(true);
  });
});

describe('removeSubscriber', () => {
  it('deletes the row and says so', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] } as never);

    await expect(removeSubscriber(3)).resolves.toBe(true);
    expect(mockedQuery.mock.calls[0][0]).toContain('DELETE FROM advert_subscribers');
    expect(mockedQuery.mock.calls[0][1]).toEqual([3]);
  });

  it('says false for a row that is not there', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as never);

    await expect(removeSubscriber(99)).resolves.toBe(false);
  });
});
