/**
 * CrowdSec alerting: when enabled, CrowdSec's `notification-http` plugin POSTs
 * every alert (batched) as raw `models.Alert` JSON to a target. Today that
 * target is the local ntfy instance so a scanner hit lands as a phone push
 * (§118.1); a later step repoints it at an n8n webhook that dedupes and
 * formats before ntfy (§118.4). The POST body shape does not change between
 * the two — n8n wants the raw alert JSON as much as this does.
 *
 * Stored per-key in `settings`, alongside the exposure / mail / timezone
 * config. The topic is generated once and kept: ntfy topics are
 * publish-by-name and this instance is internet-facing, so a guessable topic
 * like "crowdsec" would leak the box's attack telemetry to anyone.
 */

import crypto from 'crypto';
import { query } from './database';

export const CROWDSEC_ALERTS_KEYS = {
  enabled: 'crowdsec_alerts_enabled',
  topic: 'crowdsec_alerts_topic',
} as const;

export interface CrowdsecAlertsConfig {
  enabled: boolean;
  /** ntfy topic the notification is published to. Always present. */
  topic: string;
}

function generateTopic(): string {
  // ~13 url-safe chars — unguessable, short enough to type into the ntfy app.
  return `crowdsec-${crypto.randomBytes(9).toString('base64url')}`;
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

/**
 * Current config. Generates and persists the topic on first call so it is
 * stable for the life of the deployment (and survives toggling alerting off
 * and on again).
 */
export async function getCrowdsecAlertsConfig(): Promise<CrowdsecAlertsConfig> {
  const [enabledRaw, topicRaw] = await Promise.all([
    readSetting(CROWDSEC_ALERTS_KEYS.enabled),
    readSetting(CROWDSEC_ALERTS_KEYS.topic),
  ]);

  let topic = topicRaw ?? '';
  if (!topic) {
    topic = generateTopic();
    // Best-effort: a write failure just means the next call regenerates it.
    await writeSetting(CROWDSEC_ALERTS_KEYS.topic, topic).catch(() => {});
  }

  return { enabled: enabledRaw === 'true', topic };
}

export async function setCrowdsecAlertsEnabled(enabled: boolean): Promise<void> {
  await writeSetting(CROWDSEC_ALERTS_KEYS.enabled, enabled ? 'true' : 'false');
}
