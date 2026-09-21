import { describe, expect, it, vi, beforeEach } from 'vitest';
import { query } from './database';

vi.mock('./database', () => ({ query: vi.fn() }));
const mockedQuery = vi.mocked(query);

import { DEFAULT_ALERT_TOPIC, appsToApplyAlertSettings, getAlertNotifyConfig, isValidAlertTopic } from './alertNotify';

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
  const none = { crowdsecTopic: false, criticalServiceTopic: false, crowdsec: false, enforce: false };

  it('restarts the relay and CrowdSec for the alerts toggle', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsec: true })).toEqual(['n8n', 'crowdsec']);
  });

  it('restarts CrowdSec before NPM for enforcement, since CrowdSec renders the block NPM loads', () => {
    expect(appsToApplyAlertSettings({ ...none, enforce: true })).toEqual(['crowdsec', 'nginx-proxy-manager']);
  });

  it('restarts only n8n when just the crowdsec category topic changed', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsecTopic: true })).toEqual(['n8n']);
  });

  it('restarts only uptime-kuma when just the critical-service category topic changed', () => {
    expect(appsToApplyAlertSettings({ ...none, criticalServiceTopic: true })).toEqual(['uptime-kuma']);
  });

  it('restarts every baked-in consumer when the default topic changes, since both categories fall back to it', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsecTopic: true, criticalServiceTopic: true })).toEqual([
      'n8n',
      'uptime-kuma',
    ]);
  });

  it('dedupes and keeps the dependency order when everything changes', () => {
    expect(
      appsToApplyAlertSettings({ crowdsecTopic: true, criticalServiceTopic: true, crowdsec: true, enforce: true })
    ).toEqual(['n8n', 'uptime-kuma', 'crowdsec', 'nginx-proxy-manager']);
  });

  it('restarts nothing when nothing changed', () => {
    expect(appsToApplyAlertSettings(none)).toEqual([]);
  });
});

describe('getAlertNotifyConfig — per-category topic resolution (§553)', () => {
  const mockSettings = (rows: Record<string, string>) => {
    mockedQuery.mockImplementation(async (_sql: unknown, params: unknown) => {
      const key = (params as string[])[0];
      return { rows: key in rows ? [{ value: rows[key] }] : [] } as never;
    });
  };

  beforeEach(() => vi.clearAllMocks());

  it('falls back to the default topic for every category with no override', async () => {
    mockSettings({ ntfy_alerts_topic: 'default-topic' });
    const config = await getAlertNotifyConfig();
    expect(config.topic).toBe('default-topic');
    expect(config.topics).toEqual({
      crowdsec: 'default-topic',
      'critical-service': 'default-topic',
      netbird: 'default-topic',
      backup: 'default-topic',
    });
  });

  it('resolves an overridden category to its own topic, leaving the rest on the default', async () => {
    mockSettings({ ntfy_alerts_topic: 'default-topic', ntfy_topic_backup: 'backup-only-topic' });
    const config = await getAlertNotifyConfig();
    expect(config.topics.backup).toBe('backup-only-topic');
    expect(config.topics.crowdsec).toBe('default-topic');
    expect(config.topics['critical-service']).toBe('default-topic');
    expect(config.topics.netbird).toBe('default-topic');
  });

  it('falls back to the default when nothing is stored at all', async () => {
    mockSettings({});
    const config = await getAlertNotifyConfig();
    expect(config.topic).toBe(DEFAULT_ALERT_TOPIC);
    expect(config.topics.crowdsec).toBe(DEFAULT_ALERT_TOPIC);
  });
});
