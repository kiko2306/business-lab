/**
 * ntfy alerts: one ntfy topic per alert category, each with its own on/off
 * flag (plan.md §609). CrowdSec's `notification-http` plugin POSTs every
 * alert (batched) as raw `models.Alert` JSON (§118.1) straight to a category
 * topic; a later step routes that through an n8n webhook that dedupes/
 * formats before ntfy (§118.4). `critical-service`, `netbird` and `backup`
 * publish straight from backend code via publishAlert().
 *
 * Stored per-key in `settings`, alongside the exposure / mail / timezone
 * config. Topics are plain editable strings with a readable default; note
 * that ntfy topics are publish-by-name and this instance is internet-facing,
 * so a guessable name means anyone who knows it can read the alert stream
 * (which carries attacker IPs) or post noise to it.
 */

import { query } from './database';
import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from './network';

export const DEFAULT_ALERT_TOPIC = 'homelab-alerts';

/**
 * Every alert source, and the shared category list every publishAlert() call
 * (and the Settings-page "Test" button) picks one of (plan.md §553).
 */
export type AlertSource = 'crowdsec' | 'critical-service' | 'netbird' | 'backup';

export const ALERT_CATEGORIES: AlertSource[] = ['crowdsec', 'critical-service', 'netbird', 'backup'];

function categoryTopicKey(category: AlertSource): string {
  return `ntfy_topic_${category}`;
}

const CATEGORY_ENABLED_KEY: Record<AlertSource, string> = {
  crowdsec: 'crowdsec_alerts_enabled',
  'critical-service': 'critical_service_alerts_enabled',
  netbird: 'netbird_alerts_enabled',
  backup: 'backup_alerts_enabled',
};

/**
 * crowdsec alerting is a real opt-in (it wires a relay workflow + a
 * CrowdSec notification plugin that don't exist until asked for), so it
 * defaults off. The other three fired unconditionally before they had a
 * switch at all — defaulting them off would be a silent behaviour change on
 * upgrade, so they default on (§609).
 */
const CATEGORY_ENABLED_DEFAULT: Record<AlertSource, boolean> = {
  crowdsec: false,
  'critical-service': true,
  netbird: true,
  backup: true,
};

const NTFY_SERVICE = 'ntfy';
const ALERT_PUBLISH_TIMEOUT_MS = 8000;

// ntfy's topic charset: letters, digits, - and _, up to 64 chars.
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidAlertTopic(value: unknown): value is string {
  return typeof value === 'string' && TOPIC_PATTERN.test(value);
}

export interface AlertNotifyConfig {
  /** Every category's resolved topic. */
  topics: Record<AlertSource, string>;
  /** Every category's on/off flag. */
  enabled: Record<AlertSource, boolean>;
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const result = await query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
    return result.rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, value]
  );
}

export async function getAlertNotifyConfig(): Promise<AlertNotifyConfig> {
  const rows = await Promise.all(
    ALERT_CATEGORIES.flatMap((category) => [readSetting(categoryTopicKey(category)), readSetting(CATEGORY_ENABLED_KEY[category])])
  );

  const topics = {} as Record<AlertSource, string>;
  const enabled = {} as Record<AlertSource, boolean>;
  ALERT_CATEGORIES.forEach((category, i) => {
    const topicRaw = rows[i * 2];
    const enabledRaw = rows[i * 2 + 1];
    topics[category] = isValidAlertTopic(topicRaw) ? topicRaw : DEFAULT_ALERT_TOPIC;
    enabled[category] = enabledRaw === null ? CATEGORY_ENABLED_DEFAULT[category] : enabledRaw === 'true';
  });

  return { topics, enabled };
}

export async function setAlertCategoryEnabled(category: AlertSource, value: boolean): Promise<void> {
  await writeSetting(CATEGORY_ENABLED_KEY[category], value ? 'true' : 'false');
}

/**
 * Set (or, with an empty string, clear) one category's topic override.
 * A cleared category has no settings row, so it falls back to
 * DEFAULT_ALERT_TOPIC on the next read — no separate "unset" flag needed.
 * Caller must validate a non-empty value with isValidAlertTopic first.
 */
export async function setAlertCategoryTopic(category: AlertSource, topic: string): Promise<void> {
  if (topic === '') {
    await query('DELETE FROM settings WHERE key = $1', [categoryTopicKey(category)]);
    return;
  }
  await writeSetting(categoryTopicKey(category), topic);
}

/**
 * Backfill an explicit `ntfy_topic_<category>` row for every category still
 * relying on the shared default topic that plan.md §609 removed
 * (`ntfy_alerts_topic`) — without this, a database from before that change
 * would silently start resolving to the hardcoded DEFAULT_ALERT_TOPIC
 * instead of whatever custom default the operator had actually set. No-op
 * once every category has its own row (true for a fresh install — init.sql
 * never wrote `ntfy_alerts_topic`).
 */
export async function ensureAlertCategoryTopics(): Promise<void> {
  const legacyDefaultRaw = await readSetting('ntfy_alerts_topic');
  const seed = isValidAlertTopic(legacyDefaultRaw) ? legacyDefaultRaw : DEFAULT_ALERT_TOPIC;
  for (const category of ALERT_CATEGORIES) {
    const existing = await readSetting(categoryTopicKey(category));
    if (!isValidAlertTopic(existing)) {
      await writeSetting(categoryTopicKey(category), seed);
    }
  }
}

/**
 * Publish one alert to its category's ntfy topic, straight from backend code
 * (plan.md §424).
 *
 * Everything that alerted before this went CrowdSec → n8n → ntfy, which is
 * fine for a stream of alerts but far too much machinery for "this one
 * credential has expired". This posts to ntfy's own published port, the same
 * `host.docker.internal` route ntfyPublishUrl() uses — so it does not depend
 * on Cloudflare, NPM, Authelia or n8n being healthy, which matters because
 * the things worth alerting about are often the things that just broke.
 *
 * Never throws and never blocks: an alert that cannot be delivered must not
 * turn a warning into a failed start. Returns whether it was published, for
 * callers that want to log the difference. A category the operator has
 * switched off is silently skipped, same as a delivery failure — the Test
 * button is what confirms the topic/subscription, not this path.
 */
export async function publishAlert(alert: {
  category: AlertSource;
  title: string;
  message: string;
  /** ntfy 1–5; 4 ("high") is right for "a credential stopped working". */
  priority?: number;
  tags?: string[];
}): Promise<boolean> {
  try {
    const port = getPublishedUpstreamPort(NTFY_SERVICE);
    if (!port) return false; // ntfy not installed on this deployment
    const { topics, enabled } = await getAlertNotifyConfig();
    if (!enabled[alert.category]) return false;
    const topic = topics[alert.category];

    const response = await fetch(`http://${await getHostGatewayIp()}:${port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: alert.title,
        message: alert.message,
        priority: alert.priority ?? 4,
        tags: alert.tags ?? ['warning'],
      }),
      signal: AbortSignal.timeout(ALERT_PUBLISH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Which running apps must restart for a change to these settings to take
 * effect, in the order to restart them (§532). Each setting is rendered into
 * its app's config only when that app starts, so saving without this left
 * the whole alert path silently off for days (§531):
 *   - crowdsec (its enabled flag) → n8n's relay workflow + CrowdSec's profiles.yaml
 *   - crowdsecTopic (the 'crowdsec' category topic) → n8n's relay workflow
 *   - criticalServiceTopic (the 'critical-service' category topic) → Uptime Kuma's critical-monitor push
 * n8n first, so the webhook exists before CrowdSec can post to it.
 *
 * 'critical-service', 'netbird' and 'backup' publish straight from backend
 * code and read their topic + enabled flag live on every publishAlert() call
 * — no baked-in config, so toggling or re-topicing any of them needs no
 * restart. Only 'critical-service' has a baked-in consumer (Uptime Kuma's
 * notification), and only its *topic* is baked in — its enabled flag isn't
 * wired into Uptime Kuma's own down-monitor alerts, which are a separate,
 * broader platform-health watchdog (§443), not this category's switch.
 */
export function appsToApplyAlertSettings(changed: {
  crowdsecTopic: boolean;
  criticalServiceTopic: boolean;
  crowdsec: boolean;
}): string[] {
  const apps = new Set<string>();
  if (changed.crowdsec || changed.crowdsecTopic) apps.add('n8n');
  if (changed.criticalServiceTopic) apps.add('uptime-kuma');
  if (changed.crowdsec) apps.add('crowdsec');
  return ['n8n', 'uptime-kuma', 'crowdsec'].filter((app) => apps.has(app));
}
