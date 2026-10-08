import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

import { isSecretSettingKey, openSettingValue, sealStoredSecrets, setSetting, setSettings } from './settingsStore';
import { sealSecret } from './totpSecret';

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

describe('secret settings at rest (plan.md §893)', () => {
  const ORIGINAL = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = `master-${'x'.repeat(24)}`;
  });
  afterEach(() => {
    process.env.JWT_SECRET = ORIGINAL;
  });

  it('seals a secret key on write and leaves other keys alone', () => {
    setSettings({ cloudflare_tunnel_token: 'tok-secret-123', cloudflare_zone_id: 'zone' });
    const [, params] = mockedQuery.mock.calls[0];
    const [, values] = params as [string[], string[]];
    expect(values[0]).not.toContain('tok-secret-123');
    expect(openSettingValue('cloudflare_tunnel_token', values[0])).toBe('tok-secret-123');
    expect(values[1]).toBe('zone');
  });

  it('seals every kind of secret key, including per-provider AI keys', () => {
    for (const key of [
      'cloudflare_tunnel_token',
      'exposure_npm_password',
      'mail_smtp_password',
      'mail_imap_password',
      'backup_target_password',
      'ai_api_key_openai',
    ]) {
      expect(isSecretSettingKey(key)).toBe(true);
    }
    expect(isSecretSettingKey('ai_provider_social_generate')).toBe(false);
    expect(isSecretSettingKey('mail_smtp_host')).toBe(false);
  });

  it('does not seal an empty or null secret', () => {
    setSettings({ mail_smtp_password: '' });
    expect(mockedQuery.mock.calls[0][1]).toEqual([['mail_smtp_password'], ['']]);
  });

  it('reads a legacy plaintext row as-is during rollover', () => {
    expect(openSettingValue('cloudflare_tunnel_token', 'plain-token-value')).toBe('plain-token-value');
  });

  it('reads a value sealed under another JWT_SECRET as empty rather than throwing', () => {
    const sealed = sealSecret('abc');
    process.env.JWT_SECRET = `other-${'y'.repeat(24)}`;
    expect(openSettingValue('mail_smtp_password', sealed)).toBe('');
  });

  it('never opens a non-secret key', () => {
    expect(openSettingValue('app_timezone', 'v1:a:b:c')).toBe('v1:a:b:c');
  });

  it('re-wraps plaintext secrets, guarded on the old value, and skips sealed ones', async () => {
    const already = sealSecret('keep');
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { key: 'cloudflare_tunnel_token', value: 'plain-1' },
        { key: 'mail_smtp_password', value: already },
        { key: 'exposure_npm_password', value: '' },
      ],
    } as never);
    await sealStoredSecrets();
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockedQuery.mock.calls[1];
    expect(sql).toContain('UPDATE settings');
    expect(sql).toContain('AND value = $3');
    const [key, sealed, old] = params as string[];
    expect(key).toBe('cloudflare_tunnel_token');
    expect(old).toBe('plain-1');
    expect(openSettingValue(key, sealed)).toBe('plain-1');
  });
});
