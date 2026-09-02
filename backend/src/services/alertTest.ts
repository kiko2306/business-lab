/**
 * "Test" button behind each source in the Settings → "ntfy alerts" card.
 * Fires a representative payload down that source's real delivery path so the
 * ntfy topic + the user's subscription can be confirmed without waiting for a
 * real event.
 *
 * The CrowdSec source posts a sample alert straight to the n8n relay webhook
 * (§118.3) — it exercises n8n → ntfy, not CrowdSec's own notification-http
 * plugin (the backend can't `docker exec crowdsec cscli notifications test` —
 * the socket proxy blocks exec). That is the half most likely to be
 * misconfigured (topic, subscription, the relay workflow).
 */

import { requestJson } from '../utils/httpJson';
import { getPublishedUpstreamPort } from '../config/services';
import { CROWDSEC_ALERT_WEBHOOK_PATH } from './n8nWorkflows';

const N8N_DEFAULT_PORT = 10240;

export type AlertSource = 'crowdsec';

export interface AlertTestResult {
  ok: boolean;
  message: string;
}

function sampleCrowdsecAlert(): unknown[] {
  // A fresh 192.0.2.x (TEST-NET-1) each call so repeated tests always deliver
  // rather than tripping the relay's within-batch IP dedupe.
  const ip = `192.0.2.${1 + Math.floor(Math.random() * 254)}`;
  const now = new Date().toISOString();
  return [
    {
      scenario: 'homelab-management/alert-test',
      source: { ip, cn: 'US', scope: 'Ip', value: ip, as_name: 'Test' },
      decisions: [{ type: 'ban', duration: '5m', scope: 'Ip', value: ip, origin: 'cscli' }],
      events_count: 1,
      message: 'Test alert from the dashboard',
      start_at: now,
      stop_at: now,
    },
  ];
}

async function testCrowdsec(): Promise<AlertTestResult> {
  const port = getPublishedUpstreamPort('n8n') ?? N8N_DEFAULT_PORT;
  const url = `http://host.docker.internal:${port}/webhook/${CROWDSEC_ALERT_WEBHOOK_PATH}`;

  try {
    const res = await requestJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: sampleCrowdsecAlert(),
      timeout: 8000,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { ok: true, message: 'Sent — check the ntfy topic on your phone.' };
    }
    if (res.statusCode === 404) {
      return {
        ok: false,
        message: 'The n8n relay webhook returned 404 — start n8n so the CrowdSec-alert workflow is registered.',
      };
    }
    return { ok: false, message: `The n8n relay webhook returned HTTP ${res.statusCode}.` };
  } catch (error) {
    return { ok: false, message: `Could not reach the n8n relay webhook: ${(error as Error).message}` };
  }
}

export async function runAlertTest(source: AlertSource): Promise<AlertTestResult> {
  switch (source) {
    case 'crowdsec':
      return testCrowdsec();
    default:
      return { ok: false, message: `Unknown alert source "${source}".` };
  }
}
