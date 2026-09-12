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
  /** The shared ntfy topic — every alert source publishes here. */
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

const NTFY_SERVICE = 'ntfy';
const ALERT_PUBLISH_TIMEOUT_MS = 8000;

// ntfy's topic charset: letters, digits, - and _, up to 64 chars.
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidAlertTopic(value: unknown): value is string {
  return typeof value === 'string' && TOPIC_PATTERN.test(value);
}

export interface AlertNotifyConfig {
  /** ntfy topic alerts are published to. Always present. */
  topic: string;
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
  const [topicRaw, crowdsecRaw, enforceRaw] = await Promise.all([
    readSetting(ALERT_NOTIFY_KEYS.topic),
    readSetting(ALERT_NOTIFY_KEYS.crowdsecEnabled),
    readSetting(ALERT_NOTIFY_KEYS.enforceNpm),
  ]);

  return {
    topic: isValidAlertTopic(topicRaw) ? topicRaw : DEFAULT_ALERT_TOPIC,
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
  title: string;
  message: string;
  /** ntfy 1–5; 4 ("high") is right for "a credential stopped working". */
  priority?: number;
  tags?: string[];
}): Promise<boolean> {
  try {
    const port = getPublishedUpstreamPort(NTFY_SERVICE);
    if (!port) return false; // ntfy not installed on this deployment
    const { topic } = await getAlertNotifyConfig();

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
