/**
 * ntfy alerts: a single ntfy topic that alerts raised anywhere in the stack
 * are published to, plus a per-source on/off flag. Today the only source is
 * CrowdSec — its `notification-http` plugin POSTs every alert (batched) as raw
 * `models.Alert` JSON (§118.1); a later step routes that through an n8n
 * webhook that dedupes/formats before ntfy (§118.4). Future alert sources
 * reuse the same topic and add their own flag here.
 *
 * Stored per-key in `settings`, alongside the exposure / mail / timezone
 * config. The topic is a plain editable string with a readable default; note
 * that ntfy topics are publish-by-name and this instance is internet-facing,
 * so a guessable name means anyone who knows it can read the alert stream
 * (which carries attacker IPs) or post noise to it.
 */

import { query } from './database';
import { getPublishedUpstreamPort } from '../config/services';
import { getHostGatewayIp } from './network';

export const ALERT_NOTIFY_KEYS = {
  /** The default ntfy topic — every category with no override of its own publishes here. */
  topic: 'ntfy_alerts_topic',
  /** Per-source flag: CrowdSec intrusion alerts. */
  crowdsecEnabled: 'crowdsec_alerts_enabled',
  /**
   * Whether CrowdSec bans are actually enforced (the NPM lua bouncer, §119).
   * Set by that feature's toggle. The n8n relay reads it so the push says
   * "banned 4h" only when the ban is real — detection-only until then (§117).
   */
  enforceNpm: 'crowdsec_enforce_npm',
} as const;

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

const NTFY_SERVICE = 'ntfy';
const ALERT_PUBLISH_TIMEOUT_MS = 8000;

// ntfy's topic charset: letters, digits, - and _, up to 64 chars.
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidAlertTopic(value: unknown): value is string {
  return typeof value === 'string' && TOPIC_PATTERN.test(value);
}

export interface AlertNotifyConfig {
  /** The default ntfy topic — a category with no override resolves to this. */
  topic: string;
  /** Every category's resolved topic (its own override, or the default). */
  topics: Record<AlertSource, string>;
  /** Whether CrowdSec intrusion alerts are sent. */
  crowdsecEnabled: boolean;
  /** Whether CrowdSec bans are enforced at NPM (§119) — affects push wording. */
  enforceNpm: boolean;
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
  const [topicRaw, crowdsecRaw, enforceRaw, ...overrides] = await Promise.all([
    readSetting(ALERT_NOTIFY_KEYS.topic),
    readSetting(ALERT_NOTIFY_KEYS.crowdsecEnabled),
    readSetting(ALERT_NOTIFY_KEYS.enforceNpm),
    ...ALERT_CATEGORIES.map((category) => readSetting(categoryTopicKey(category))),
  ]);

  const topic = isValidAlertTopic(topicRaw) ? topicRaw : DEFAULT_ALERT_TOPIC;
  const topics = Object.fromEntries(
    ALERT_CATEGORIES.map((category, i) => [category, isValidAlertTopic(overrides[i]) ? overrides[i] : topic])
  ) as Record<AlertSource, string>;

  return {
    topic,
    topics,
    crowdsecEnabled: crowdsecRaw === 'true',
    enforceNpm: enforceRaw === 'true',
  };
}

export async function setCrowdsecAlertsEnabled(enabled: boolean): Promise<void> {
  await writeSetting(ALERT_NOTIFY_KEYS.crowdsecEnabled, enabled ? 'true' : 'false');
}

/** Set by the §119 NPM-enforcement toggle. */
export async function setCrowdsecEnforceNpm(enabled: boolean): Promise<void> {
  await writeSetting(ALERT_NOTIFY_KEYS.enforceNpm, enabled ? 'true' : 'false');
}

/** Caller must validate with isValidAlertTopic first. */
export async function setAlertTopic(topic: string): Promise<void> {
  await writeSetting(ALERT_NOTIFY_KEYS.topic, topic);
}

/**
 * Set (or, with an empty string, clear) one category's topic override.
 * A cleared category has no settings row, so it falls back to the default
 * topic on the next read — no separate "unset" flag needed.
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
 * Publish one alert to the shared ntfy topic, straight from backend code
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
 * callers that want to log the difference.
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
    const { topics } = await getAlertNotifyConfig();
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
 * the whole alert and ban path silently off for days (§531):
 *   - CrowdSec alerts → n8n's relay workflow + CrowdSec's profiles.yaml
 *   - crowdsecTopic (the default, or a 'crowdsec' override) → n8n's relay workflow
 *   - criticalServiceTopic (the default, or a 'critical-service' override) → Uptime Kuma's critical-monitor push
 *   - enforcement → CrowdSec (renders NPM's bouncer block) + NPM (loads it)
 * n8n first, so the webhook exists before CrowdSec can post to it; CrowdSec
 * before NPM, because CrowdSec's start renders the block NPM then loads.
 *
 * 'netbird' and 'backup' topics are read live on every publishAlert() call
 * (§553) — no baked-in config, so no restart is needed for either.
 */
export function appsToApplyAlertSettings(changed: {
  crowdsecTopic: boolean;
  criticalServiceTopic: boolean;
  crowdsec: boolean;
  enforce: boolean;
}): string[] {
  const apps = new Set<string>();
  if (changed.crowdsec || changed.crowdsecTopic) apps.add('n8n');
  if (changed.criticalServiceTopic) apps.add('uptime-kuma');
  if (changed.crowdsec || changed.enforce) apps.add('crowdsec');
  if (changed.enforce) apps.add('nginx-proxy-manager');
  return ['n8n', 'uptime-kuma', 'crowdsec', 'nginx-proxy-manager'].filter((app) => apps.has(app));
}
