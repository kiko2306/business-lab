import { describe, expect, it } from 'vitest';
import { DEFAULT_ALERT_TOPIC, appsToApplyAlertSettings, isValidAlertTopic } from './alertNotify';

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
  const none = { topic: false, crowdsec: false, enforce: false };

  it('restarts the relay and CrowdSec for the alerts toggle', () => {
    expect(appsToApplyAlertSettings({ ...none, crowdsec: true })).toEqual(['n8n', 'crowdsec']);
  });

  it('restarts CrowdSec before NPM for enforcement, since CrowdSec renders the block NPM loads', () => {
    expect(appsToApplyAlertSettings({ ...none, enforce: true })).toEqual(['crowdsec', 'nginx-proxy-manager']);
  });

  it('restarts every consumer of the topic', () => {
    expect(appsToApplyAlertSettings({ ...none, topic: true })).toEqual(['n8n', 'uptime-kuma']);
  });

  it('dedupes and keeps the dependency order when everything changes', () => {
    expect(appsToApplyAlertSettings({ topic: true, crowdsec: true, enforce: true })).toEqual([
      'n8n',
      'uptime-kuma',
      'crowdsec',
      'nginx-proxy-manager',
    ]);
  });

  it('restarts nothing when nothing changed', () => {
    expect(appsToApplyAlertSettings(none)).toEqual([]);
  });
});
