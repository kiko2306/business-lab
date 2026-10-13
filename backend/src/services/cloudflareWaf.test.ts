import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('../utils/httpJson', () => ({ requestJson }));
const { getExposureConfig } = vi.hoisted(() => ({ getExposureConfig: vi.fn() }));
vi.mock('../utils/exposureSettings', () => ({ getExposureConfig }));
const { setSetting } = vi.hoisted(() => ({ setSetting: vi.fn() }));
vi.mock('../utils/settingsStore', () => ({ setSetting }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  PROBE_RULE_REF,
  buildProbeBlockExpression,
  desiredProbeRule,
  ensureEdgeWafRule,
  planProbeRule,
} from './cloudflareWaf';

describe('buildProbeBlockExpression', () => {
  const expr = buildProbeBlockExpression('example.com');

  it('blocks secret files and repo metadata on every hostname', () => {
    for (const prefix of ['/.env', '/.git', '/.aws/', '/.docker/']) {
      expect(expr).toContain(`starts_with(lower(http.request.uri.path), "${prefix}")`);
    }
    expect(expr).toContain('contains(lower(http.request.uri.path), "/vendor/phpunit/")');
  });

  // Nextcloud, ITFlow and Kimai serve real .php pages on their own hostnames;
  // only the bare domain (the Home Page, no PHP) can drop every .php request.
  it('blocks .php and PHP framework debug paths only on the bare domain', () => {
    expect(expr).toContain(
      '(http.host eq "example.com" and (ends_with(lower(http.request.uri.path), ".php") or ' +
        'starts_with(lower(http.request.uri.path), "/_ignition/") or ' +
        'starts_with(lower(http.request.uri.path), "/_profiler/")))'
    );
    expect(expr.match(/\.php"/g)).toHaveLength(1);
  });

  // Free-plan zones have no regex operator (`matches` is Business+).
  it('uses only operators every Cloudflare plan has', () => {
    expect(expr).not.toMatch(/\bmatches\b|~/);
  });

  it('refuses a domain that could break out of the quoted string', () => {
    expect(() => buildProbeBlockExpression('example.com" or true or "')).toThrow();
  });
});

describe('planProbeRule', () => {
  const desired = desiredProbeRule('example.com');

  it('creates the entrypoint ruleset when the zone has none', () => {
    expect(planProbeRule(null, desired)).toEqual({ kind: 'create-entrypoint' });
  });

  it('adds the rule beside the operator\'s own rules, never replacing them', () => {
    const ruleset = { id: 'rs1', rules: [{ id: 'r1', ref: 'mine', expression: 'true', action: 'block' }] };
    expect(planProbeRule(ruleset, desired)).toEqual({ kind: 'add', rulesetId: 'rs1' });
  });

  it('does nothing when ours is already there and unchanged', () => {
    const ruleset = { id: 'rs1', rules: [{ ...desired, id: 'r9' }] };
    expect(planProbeRule(ruleset, desired)).toEqual({ kind: 'none' });
  });

  it('updates ours in place when the domain or the list changed', () => {
    const ruleset = { id: 'rs1', rules: [{ ...desired, id: 'r9', expression: 'old' }] };
    expect(planProbeRule(ruleset, desired)).toEqual({ kind: 'update', rulesetId: 'rs1', ruleId: 'r9' });
  });

  it('re-enables ours if someone switched it off', () => {
    const ruleset = { id: 'rs1', rules: [{ ...desired, id: 'r9', enabled: false }] };
    expect(planProbeRule(ruleset, desired)).toEqual({ kind: 'update', rulesetId: 'rs1', ruleId: 'r9' });
  });
});

describe('ensureEdgeWafRule', () => {
  const config = { baseDomain: 'example.com', cloudflareZoneId: 'z1', cloudflareApiToken: 't' };
  const lastStatus = () => JSON.parse(setSetting.mock.calls.at(-1)![1] as string);

  beforeEach(() => {
    requestJson.mockReset();
    setSetting.mockReset();
    getExposureConfig.mockReset();
    getExposureConfig.mockResolvedValue(config);
  });

  it('creates the rule on a zone with no custom rules and records it active', async () => {
    requestJson
      .mockResolvedValueOnce({ statusCode: 404, body: { success: false, errors: [{ code: 10003 }] } })
      .mockResolvedValueOnce({ statusCode: 200, body: { success: true, result: { id: 'rs1' } } });

    expect(await ensureEdgeWafRule()).toBe('active');

    const [url, opts] = requestJson.mock.calls[1];
    expect(url).toBe('https://api.cloudflare.com/client/v4/zones/z1/rulesets/phases/http_request_firewall_custom/entrypoint');
    expect(opts.method).toBe('PUT');
    expect(opts.body.rules).toEqual([expect.objectContaining({ ref: PROBE_RULE_REF, action: 'block' })]);
    expect(lastStatus().state).toBe('active');
  });

  it('records a missing token permission instead of failing the reconcile', async () => {
    requestJson
      .mockResolvedValueOnce({ statusCode: 404, body: { success: false, errors: [{ code: 10003 }] } })
      .mockResolvedValueOnce({ statusCode: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } });

    expect(await ensureEdgeWafRule()).toBe('missing-permission');
    expect(lastStatus().state).toBe('missing-permission');
  });

  it('records other API failures with Cloudflare\'s message', async () => {
    requestJson.mockResolvedValueOnce({ statusCode: 500, body: { success: false, errors: [{ code: 1, message: 'boom' }] } });

    expect(await ensureEdgeWafRule()).toBe('error');
    expect(lastStatus()).toEqual(expect.objectContaining({ state: 'error', detail: 'boom' }));
  });

  it('is a no-op until the exposure settings are complete', async () => {
    getExposureConfig.mockResolvedValue(null);
    expect(await ensureEdgeWafRule()).toBe('not-configured');
    expect(requestJson).not.toHaveBeenCalled();
  });
});
