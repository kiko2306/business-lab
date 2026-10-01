import { beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

import { setSetting, setSettings } from './settingsStore';

beforeEach(() => {
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('setSettings', () => {
  it('writes every key in one statement, so a save cannot land half-applied', () => {
    // The whole point: the per-key `await query(...)` loops this replaces left
    // mail/exposure/backup config partly written when one key failed.
    setSettings({ base_domain: 'example.com', npm_email: 'a@example.com' });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO settings');
    expect(sql).toContain('ON CONFLICT (key)');
    expect(params).toEqual([
      ['base_domain', 'npm_email'],
      ['example.com', 'a@example.com'],
    ]);
  });

  it('keeps keys and values aligned', () => {
    setSettings({ a: '1', b: '2', c: '3' });
    const [, params] = mockedQuery.mock.calls[0];
    const [keys, values] = params as [string[], (string | null)[]];
    expect(keys.map((key, index) => `${key}=${values[index]}`)).toEqual(['a=1', 'b=2', 'c=3']);
  });

  it('stores an absent value as null, as the per-key writes did', () => {
    setSettings({ cloudflare_tunnel_id: undefined });
    const [, params] = mockedQuery.mock.calls[0];
    expect(params).toEqual([['cloudflare_tunnel_id'], [null]]);
  });

  it('does not go to the database with nothing to write', async () => {
    await setSettings({});
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('setSetting', () => {
  it('writes one key through the same statement', () => {
    setSetting('app_timezone', 'Europe/Lisbon');
    const [, params] = mockedQuery.mock.calls[0];
    expect(params).toEqual([['app_timezone'], ['Europe/Lisbon']]);
  });
});
