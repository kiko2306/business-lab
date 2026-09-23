import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from '../utils/database';
import { subscribe, unsubscribeByToken, listActiveSubscribers } from './advertSubscribers';

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
