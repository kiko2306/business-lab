import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../utils/database', () => ({ query }));

const { saveServiceEnv } = vi.hoisted(() => ({ saveServiceEnv: vi.fn().mockResolvedValue({ changedKeys: ['ACCEPT_EULA'] }) }));
vi.mock('./appEnv', () => ({ saveServiceEnv }));

import {
  assertMssqlEulaAccepted,
  getMssqlEulaAcceptance,
  recordMssqlEulaAcceptance,
} from './mssqlEula';

const rows = (value: string | undefined) => ({ rows: value === undefined ? [] : [{ value }] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMssqlEulaAcceptance', () => {
  it('returns null when the terms have never been accepted', async () => {
    query.mockResolvedValueOnce(rows(undefined));
    expect(await getMssqlEulaAcceptance()).toBeNull();
  });

  it('parses a stored acceptance', async () => {
    query.mockResolvedValueOnce(
      rows(JSON.stringify({ acceptedAt: '2026-09-07T00:00:00.000Z', acceptedByUserId: 3, acceptedByName: 'mat' }))
    );
    expect(await getMssqlEulaAcceptance()).toEqual({
      acceptedAt: '2026-09-07T00:00:00.000Z',
      acceptedByUserId: 3,
      acceptedByName: 'mat',
    });
  });

  it('treats malformed or incomplete JSON as not accepted', async () => {
    query.mockResolvedValueOnce(rows('not json'));
    expect(await getMssqlEulaAcceptance()).toBeNull();
    query.mockResolvedValueOnce(rows(JSON.stringify({ acceptedByName: 'mat' })));
    expect(await getMssqlEulaAcceptance()).toBeNull();
  });
});

describe('recordMssqlEulaAcceptance', () => {
  it('persists the acceptance and writes ACCEPT_EULA=Y', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const acceptance = await recordMssqlEulaAcceptance(7, 'mat');

    expect(acceptance.acceptedByUserId).toBe(7);
    expect(acceptance.acceptedByName).toBe('mat');
    expect(acceptance.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO settings'), [
      'mssql_eula_accepted',
      expect.stringContaining('"acceptedByUserId":7'),
    ]);
    expect(saveServiceEnv).toHaveBeenCalledWith('mssql', { ACCEPT_EULA: 'Y' });
  });
});

describe('assertMssqlEulaAccepted', () => {
  it('does nothing for a service other than mssql', async () => {
    await expect(assertMssqlEulaAccepted('mealie')).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('resolves when mssql has an accepted licence', async () => {
    query.mockResolvedValueOnce(rows(JSON.stringify({ acceptedAt: '2026-09-07T00:00:00.000Z' })));
    await expect(assertMssqlEulaAccepted('mssql')).resolves.toBeUndefined();
  });

  it('throws a 409 when mssql has no accepted licence', async () => {
    query.mockResolvedValueOnce(rows(undefined));
    await expect(assertMssqlEulaAccepted('mssql')).rejects.toMatchObject({ statusCode: 409 });
  });
});
