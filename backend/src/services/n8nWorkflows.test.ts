import { describe, expect, it } from 'vitest';
import {
  buildCrowdsecAlertWorkflow,
  CROWDSEC_ALERT_WEBHOOK_PATH,
  CROWDSEC_ALERT_WORKFLOW_ID,
  DEDUPE_WINDOW_MS,
  NOISE_SCENARIOS,
} from './n8nWorkflows';

describe('buildCrowdsecAlertWorkflow', () => {
  const wf = buildCrowdsecAlertWorkflow({
    topic: 'homelab-alerts',
    ntfyUrl: 'http://host.docker.internal:10290/',
    enforced: false,
  });

  it('has the stable id (used as filename + import key) and is active', () => {
    expect(wf.id).toBe(CROWDSEC_ALERT_WORKFLOW_ID);
    expect(wf.active).toBe(true);
  });

  it('wires Webhook → Format → Send to ntfy', () => {
    const names = (wf.nodes as Array<{ name: string; type: string }>).map((n) => n.name);
    expect(names).toEqual(['Webhook', 'Format', 'Send to ntfy']);
    const conns = wf.connections as Record<string, { main: Array<Array<{ node: string }>> }>;
    expect(conns.Webhook.main[0][0].node).toBe('Format');
    expect(conns.Format.main[0][0].node).toBe('Send to ntfy');
  });

  it('POSTs to the webhook path CrowdSec will call', () => {
    const webhook = (wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>).find(
      (n) => n.name === 'Webhook'
    )!;
    expect(webhook.parameters.httpMethod).toBe('POST');
    expect(webhook.parameters.path).toBe(CROWDSEC_ALERT_WEBHOOK_PATH);
  });

  it('bakes the topic into the Code node and the ntfy url into the HTTP node', () => {
    const nodes = wf.nodes as Array<{ name: string; parameters: Record<string, unknown> }>;
    const code = nodes.find((n) => n.name === 'Format')!;
    expect(code.parameters.jsCode).toContain('"homelab-alerts"');
    const http = nodes.find((n) => n.name === 'Send to ntfy')!;
    expect(http.parameters.url).toBe('http://host.docker.internal:10290/');
    expect(http.parameters.method).toBe('POST');
  });

  function codeOf(wfObj: Record<string, unknown>): string {
    return (wfObj.nodes as Array<{ name: string; parameters: { jsCode: string } }>).find(
      (n) => n.name === 'Format'
    )!.parameters.jsCode;
  }

  it('the Code node dedupes by IP and drops noisy scenarios', () => {
    const js = codeOf(wf);
    expect(js).toContain("$getWorkflowStaticData('global')");
    expect(js).toContain(String(DEDUPE_WINDOW_MS));
    expect(js).toContain(JSON.stringify(NOISE_SCENARIOS));
    // nothing survives → no items → HTTP node never fires
    expect(js).toContain('if (kept.length === 0) return [];');
  });

  it('marks an all-test batch with a TEST title and the test_tube tag', () => {
    const js = codeOf(wf);
    expect(js).toContain("allTest ? 'TEST — '");
    expect(js).toContain("allTest ? ['test_tube'] : ['rotating_light']");
  });

  it('appends the applied ban only when enforcement is on', () => {
    // enforced: false → the ban clause is gated off
    expect(codeOf(wf)).toContain('const enforced = false;');
    expect(codeOf(wf)).toContain("(enforced && dec.type === 'ban')");
    // enforced: true → same code, flag flipped (the §119 bouncer live)
    const enforcedWf = buildCrowdsecAlertWorkflow({
      topic: 'homelab-alerts',
      ntfyUrl: 'http://host.docker.internal:10290/',
      enforced: true,
    });
    expect(codeOf(enforcedWf)).toContain('const enforced = true;');
    expect(codeOf(enforcedWf)).toContain("' · banned '");
  });

  it('serialises to JSON (n8n import reads a file)', () => {
    expect(() => JSON.parse(JSON.stringify(wf))).not.toThrow();
  });
});
