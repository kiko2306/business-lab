import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

import {
  DEFAULT_ALERT_TOPIC,
  appsToApplyAlertSettings,
  ensureAlertCategoryTopics,
  getAlertNotifyConfig,
  isValidAlertTopic,
} from './alertNotify';

describe('isValidAlertTopic', () => {
  it('accepts ntfy-legal topic names', () => {
    expect(isValidAlertTopic('homelab-alerts')).toBe(true);
    expect(isValidAlertTopic('crowdsec-intrusion-alerts')).toBe(true);
    expect(isValidAlertTopic('CrowdSec_Alerts_2')).toBe(true);
    expect(isValidAlertTopic('a')).toBe(true);
    expect(isValidAlertTopic('x'.repeat(64))).toBe(true);
  });

  it('rejects empty, over-long, or names with characters ntfy disallows', () => {
    expect(isValidAlertTopic('')).toBe(false);
    expect(isValidAlertTopic('x'.repeat(65))).toBe(false);
    expect(isValidAlertTopic('has spaces')).toBe(false);
    expect(isValidAlertTopic('has/slash')).toBe(false);
    expect(isValidAlertTopic('emoji✨')).toBe(false);
    expect(isValidAlertTopic(42)).toBe(false);
    expect(isValidAlertTopic(null)).toBe(false);
  });

  it('has a readable default', () => {
    expect(DEFAULT_ALERT_TOPIC).toBe('homelab-alerts');
    expect(isValidAlertTopic(DEFAULT_ALERT_TOPIC)).toBe(true);
  });
});

describe('appsToApplyAlertSettings', () => {
  const none = { crowdsecTopic: false, criticalServiceTopic: false, crowdsec: false };

  it('restarts the relay and CrowdSec for the alerts toggle', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsec: true })).toEqual(['n8n', 'crowdsec']);
  });

  it('restarts only n8n when just the crowdsec category topic changed', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsecTopic: true })).toEqual(['n8n']);
  });

  it('restarts only uptime-kuma when just the critical-service category topic changed', () => {
    expect(appsToApplyAlertSettings({ ...none, criticalServiceTopic: true })).toEqual(['uptime-kuma']);
  });

  it('dedupes and keeps the dependency order when everything changes', () => {
    expect(appsToApplyAlertSettings({ crowdsecTopic: true, criticalServiceTopic: true, crowdsec: true })).toEqual([
      'n8n',
      'uptime-kuma',
      'crowdsec',
    ]);
  });

  it('restarts nothing when nothing changed', () => {
    expect(appsToApplyAlertSettings(none)).toEqual([]);
  });
});

describe('getAlertNotifyConfig — per-category topic + enabled resolution (§553/§609)', () => {
  const mockSettings = (rows: Record<string, string>) => {
    mockedQuery.mockImplementation(async (_sql: unknown, params: unknown) => {
      const key = (params as string[])[0];
      return { rows: key in rows ? [{ value: rows[key] }] : [] } as never;
    });
  };

  beforeEach(() => vi.clearAllMocks());

  it('falls back to DEFAULT_ALERT_TOPIC for a category with no row of its own', async () => {
    mockSettings({ ntfy_topic_backup: 'backup-only-topic' });
    const config = await getAlertNotifyConfig();
    expect(config.topics.backup).toBe('backup-only-topic');
    expect(config.topics.crowdsec).toBe(DEFAULT_ALERT_TOPIC);
    expect(config.topics['critical-service']).toBe(DEFAULT_ALERT_TOPIC);
    expect(config.topics.netbird).toBe(DEFAULT_ALERT_TOPIC);
  });

  it('defaults crowdsec alerts off and the other three categories on, when nothing is stored', async () => {
    mockSettings({});
    const config = await getAlertNotifyConfig();
    expect(config.enabled).toEqual({
      crowdsec: false,
      'critical-service': true,
      netbird: true,
      backup: true,
    });
  });

  it('reads an explicit enabled flag over the default either direction', async () => {
    mockSettings({ crowdsec_alerts_enabled: 'true', backup_alerts_enabled: 'false' });
    const config = await getAlertNotifyConfig();
    expect(config.enabled.crowdsec).toBe(true);
    expect(config.enabled.backup).toBe(false);
    // Untouched categories keep their own default.
    expect(config.enabled.netbird).toBe(true);
  });
});

describe('ensureAlertCategoryTopics (§609 migration off the removed shared default)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('backfills every category with no row of its own, seeded from the old shared default', async () => {
    const rows: Record<string, string> = { ntfy_alerts_topic: 'my-custom-default', ntfy_topic_backup: 'backup-topic' };
    const written: [string, string][] = [];
    mockedQuery.mockImplementation(async (sql: unknown, params: unknown) => {
      const text = sql as string;
      if (text.startsWith('SELECT')) {
        const key = (params as string[])[0];
        return { rows: key in rows ? [{ value: rows[key] }] : [] } as never;
      }
      const [key, value] = params as string[];
      written.push([key, value]);
      return { rows: [] } as never;
    });

    await ensureAlertCategoryTopics();

    expect(written).toEqual(
      expect.arrayContaining([
        ['ntfy_topic_crowdsec', 'my-custom-default'],
        ['ntfy_topic_critical-service', 'my-custom-default'],
        ['ntfy_topic_netbird', 'my-custom-default'],
      ])
    );
    expect(written.find(([key]) => key === 'ntfy_topic_backup')).toBeUndefined();
  });

  it('seeds DEFAULT_ALERT_TOPIC when there was never a shared default either', async () => {
    const written: [string, string][] = [];
    mockedQuery.mockImplementation(async (sql: unknown, params: unknown) => {
      const text = sql as string;
      if (text.startsWith('SELECT')) return { rows: [] } as never;
      const [key, value] = params as string[];
      written.push([key, value]);
      return { rows: [] } as never;
    });

    await ensureAlertCategoryTopics();

    expect(written.every(([, value]) => value === DEFAULT_ALERT_TOPIC)).toBe(true);
    expect(written).toHaveLength(4);
  });
});
