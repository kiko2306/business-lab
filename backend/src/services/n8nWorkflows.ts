/**
 * Dashboard-managed n8n workflows. The backend renders one JSON file per
 * workflow into apps/n8n/workflows/ on each n8n start; the n8n-workflows-init
 * container then imports + publishes them (see that app's compose file), and
 * n8n registers their webhooks on boot. plan.md §118.3.
 *
 * A rendered workflow is authoritative — the init re-imports every start, so
 * editing one in the n8n UI is pointless (the change is replaced). Clone it
 * there if you want a customised copy.
 *
 * Today there is one: a CrowdSec-alert relay (Webhook → Code → ntfy). §118.4
 * makes the Code node smart (dedupe, scenario filtering); for now it just
 * summarises the batch and forwards it.
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getAlertNotifyConfig } from '../utils/alertNotify';

export const N8N_SERVICE = 'n8n';
const WORKFLOWS_DIR_RELATIVE = 'workflows';

const NTFY_SERVICE = 'ntfy';
const NTFY_DEFAULT_PORT = 10290;

// n8n workflow id — used as the filename (<id>.json) and as the import key, so
// it must stay stable. Alphanumeric only (matches n8n's own id shape).
export const CROWDSEC_ALERT_WORKFLOW_ID = 'homelabCrowdsecAlertRelay';
export const CROWDSEC_ALERT_WEBHOOK_PATH = 'crowdsec-alert';

/**
 * The CrowdSec-alert relay workflow. `topic` is baked into the Code node and
 * `ntfyUrl` into the HTTP Request node — n8n substitutes nothing at runtime
 * here, the backend does it now.
 */
export function buildCrowdsecAlertWorkflow(opts: { topic: string; ntfyUrl: string }): Record<string, unknown> {
  const jsCode = [
    "const input = $input.first().json;",
    "const raw = input && input.body !== undefined ? input.body : input;",
    "const alerts = Array.isArray(raw) ? raw : [raw];",
    "const lines = alerts.map((a) => {",
    "  const src = (a && a.source) || {};",
    "  const ip = src.ip || src.value || 'unknown';",
    "  const cn = src.cn ? ' (' + src.cn + ')' : '';",
    "  const dec = (a && a.decisions && a.decisions[0]) || {};",
    "  const dur = dec.duration ? ' · ' + dec.duration + ' ' + (dec.type || 'ban') : '';",
    "  return (a && a.scenario ? a.scenario : 'alert') + ' — ' + ip + cn + dur;",
    "});",
    `const topic = ${JSON.stringify(opts.topic)};`,
    "return [{ json: {",
    "  topic,",
    "  title: 'CrowdSec: ' + alerts.length + ' alert' + (alerts.length === 1 ? '' : 's'),",
    "  message: lines.join('\\n') || 'CrowdSec raised an alert',",
    "  priority: 4,",
    "  tags: ['rotating_light'],",
    "} }];",
  ].join('\n');

  return {
    id: CROWDSEC_ALERT_WORKFLOW_ID,
    name: 'CrowdSec alert relay (managed)',
    active: true,
    settings: { executionOrder: 'v1' },
    connections: {
      Webhook: { main: [[{ node: 'Format', type: 'main', index: 0 }]] },
      Format: { main: [[{ node: 'Send to ntfy', type: 'main', index: 0 }]] },
    },
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: CROWDSEC_ALERT_WEBHOOK_PATH,
          responseMode: 'onReceived',
          options: {},
        },
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        webhookId: 'homelab-crowdsec-alert',
      },
      {
        parameters: { mode: 'runOnceForAllItems', jsCode },
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Format',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [220, 0],
      },
      {
        parameters: {
          method: 'POST',
          url: opts.ntfyUrl,
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json) }}',
          options: {},
        },
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Send to ntfy',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [440, 0],
      },
    ],
  };
}

function ntfyPublishUrl(): string {
  const port = getPublishedUpstreamPort(NTFY_SERVICE) ?? NTFY_DEFAULT_PORT;
  // ntfy's JSON-publish endpoint is the server root; the topic is in the body.
  return `http://host.docker.internal:${port}/`;
}

/**
 * Render the managed workflow files for n8n. No-op for every other service.
 * Never throws — a failure here must not block the container start.
 */
export async function applyN8nWorkflows(serviceName: string, appDir: string): Promise<void> {
  if (serviceName !== N8N_SERVICE) {
    return;
  }

  try {
    const dir = path.join(appDir, WORKFLOWS_DIR_RELATIVE);
    await fs.mkdir(dir, { recursive: true });

    const { topic, crowdsecEnabled } = await getAlertNotifyConfig();
    const target = path.join(dir, `${CROWDSEC_ALERT_WORKFLOW_ID}.json`);

    // Only ship the relay while CrowdSec alerts are on. Removing the file
    // stops it being re-imported; an already-imported copy is left in place
    // (n8n has no clean CLI delete, and a stale inactive workflow is inert).
    if (!crowdsecEnabled) {
      await fs.rm(target, { force: true });
      return;
    }

    const workflow = buildCrowdsecAlertWorkflow({ topic, ntfyUrl: ntfyPublishUrl() });
    await fs.writeFile(target, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
    logger.info('n8n: rendered managed workflow', { id: CROWDSEC_ALERT_WORKFLOW_ID });
  } catch (error) {
    logger.warn('n8n: could not render managed workflows', { error: (error as Error).message });
  }
}

// Not currently used elsewhere, kept for symmetry with resolveComposeFile-based
// callers/tests.
export function n8nWorkflowsDir(): string | null {
  const resolved = resolveComposeFile(N8N_SERVICE);
  return resolved ? path.join(resolved.appDir, WORKFLOWS_DIR_RELATIVE) : null;
}
