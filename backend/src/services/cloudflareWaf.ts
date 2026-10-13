/**
 * One Cloudflare WAF custom rule, kept in place by the dashboard (plan.md
 * §915): drop the secret-file and PHP-exploit probes that made up every
 * CrowdSec alert in §912's scan report at Cloudflare's edge, before they
 * reach the tunnel, NPM or CrowdSec at all.
 *
 * It lives in the zone's `http_request_firewall_custom` entrypoint ruleset,
 * identified by its `ref`, and is only ever added or updated by that ref —
 * the operator's own custom rules in the same ruleset are never touched. The
 * ruleset is created only when the zone has none (a `PUT` on the entrypoint
 * replaces its whole rule list, so it is never used once one exists).
 *
 * Needs **Zone → Zone WAF: Edit** on the Cloudflare token, beyond the Tunnel
 * and DNS permissions exposure already uses. Cloudflare adds a permission to
 * an existing token without changing its value, so a missing one is reported
 * on the deployment checklist rather than asked for as a new secret.
 */

import { requestJson } from '../utils/httpJson';
import { getExposureConfig } from '../utils/exposureSettings';
import { setSetting } from '../utils/settingsStore';
import logger from '../utils/logger';

const API_BASE = 'https://api.cloudflare.com/client/v4';
export const PROBE_RULE_REF = 'business_lab_probe_block';
export const WAF_STATUS_KEY = 'cloudflare_waf_status';

// Probed on every hostname in the scan; no managed app serves any of them.
// `/.git` (no slash) also covers `.github/`, `.gitlab-ci.yml`, `.gitmodules`.
const ZONE_WIDE_PREFIXES = ['/.env', '/.git', '/.aws/', '/.docker/', '/.boto', '/.s3cfg', '/.npmrc'];
// PHP is only safe to drop where nothing serves it: the bare domain is the
// Home Page. Nextcloud, ITFlow and Kimai serve real .php pages on theirs.
const APEX_PREFIXES = ['/_ignition/', '/_profiler/'];

export type WafState = 'active' | 'missing-permission' | 'error' | 'not-configured';

export interface WafRule {
  id?: string;
  ref?: string;
  expression: string;
  action: string;
  description?: string;
  enabled?: boolean;
}

interface Ruleset {
  id: string;
  rules?: WafRule[];
}

interface Envelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result?: T;
}

export type WafPlan =
  | { kind: 'create-entrypoint' }
  | { kind: 'add'; rulesetId: string }
  | { kind: 'update'; rulesetId: string; ruleId: string }
  | { kind: 'none' };

/**
 * The rule expression. Only `starts_with`/`ends_with`/`contains`/`lower` —
 * free-plan zones have no `matches` (regex is Business and up). Paths are
 * lower-cased so `/.ENV` is caught too.
 */
export function buildProbeBlockExpression(baseDomain: string): string {
  if (!/^[a-z0-9.-]+$/i.test(baseDomain)) {
    throw new Error(`Refusing to build a WAF expression for domain ${JSON.stringify(baseDomain)}`);
  }
  const path = 'lower(http.request.uri.path)';
  const zoneWide = [
    ...ZONE_WIDE_PREFIXES.map((p) => `starts_with(${path}, "${p}")`),
    `contains(${path}, "/vendor/phpunit/")`,
  ];
  const apex = [`ends_with(${path}, ".php")`, ...APEX_PREFIXES.map((p) => `starts_with(${path}, "${p}")`)];
  return `${zoneWide.join(' or ')} or (http.host eq "${baseDomain.toLowerCase()}" and (${apex.join(' or ')}))`;
}

export function desiredProbeRule(baseDomain: string): WafRule {
  return {
    ref: PROBE_RULE_REF,
    action: 'block',
    expression: buildProbeBlockExpression(baseDomain),
    description: 'Business Lab: secret-file and PHP exploit probes (managed by the dashboard)',
    enabled: true,
  };
}

export function planProbeRule(ruleset: Ruleset | null, desired: WafRule): WafPlan {
  if (!ruleset) return { kind: 'create-entrypoint' };
  const ours = ruleset.rules?.find((rule) => rule.ref === PROBE_RULE_REF);
  if (!ours?.id) return { kind: 'add', rulesetId: ruleset.id };
  const same = ours.expression === desired.expression && ours.action === desired.action && ours.enabled !== false;
  return same ? { kind: 'none' } : { kind: 'update', rulesetId: ruleset.id, ruleId: ours.id };
}

class CloudflareWafError extends Error {
  constructor(
    message: string,
    readonly forbidden: boolean
  ) {
    super(message);
  }
}

async function call<T>(token: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: Envelope<T> | null }> {
  const response = await requestJson<Envelope<T>>(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  return { status: response.statusCode, body: response.body };
}

function fail(status: number, body: Envelope<unknown> | null): never {
  const errors = body?.errors ?? [];
  // 10000 is Cloudflare's "Authentication error" — a token without the scope.
  const forbidden = status === 403 || errors.some((e) => e.code === 10000);
  throw new CloudflareWafError(errors.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${status}`, forbidden);
}

async function recordStatus(state: WafState, detail = ''): Promise<WafState> {
  try {
    await setSetting(WAF_STATUS_KEY, JSON.stringify({ state, detail, at: new Date().toISOString() }));
  } catch {
    // Only the checklist reads it; the rule itself is what matters.
  }
  return state;
}

/** Add or update the probe-block rule. Never throws: records and returns its state. */
export async function ensureEdgeWafRule(): Promise<WafState> {
  const config = await getExposureConfig();
  if (!config) return 'not-configured';
  const token = config.cloudflareApiToken;
  const zone = `${API_BASE}/zones/${config.cloudflareZoneId}/rulesets`;
  const entrypoint = `${zone}/phases/http_request_firewall_custom/entrypoint`;

  try {
    const desired = desiredProbeRule(config.baseDomain);
    const current = await call<Ruleset>(token, 'GET', entrypoint);
    // 10003: "could not find entrypoint ruleset" — the zone has no custom rules yet.
    const missing = current.status === 404 && (current.body?.errors ?? []).some((e) => e.code === 10003);
    if (!missing && (current.status >= 300 || !current.body?.result)) fail(current.status, current.body);

    const plan = planProbeRule(missing ? null : current.body!.result!, desired);
    let result: { status: number; body: Envelope<unknown> | null } | null = null;
    if (plan.kind === 'create-entrypoint') {
      result = await call(token, 'PUT', entrypoint, { rules: [desired] });
    } else if (plan.kind === 'add') {
      // First, so it runs ahead of any allow/skip rule the operator added.
      result = await call(token, 'POST', `${zone}/${plan.rulesetId}/rules`, { ...desired, position: { index: 1 } });
    } else if (plan.kind === 'update') {
      result = await call(token, 'PATCH', `${zone}/${plan.rulesetId}/rules/${plan.ruleId}`, desired);
    }
    if (result && (result.status >= 300 || !result.body?.success)) fail(result.status, result.body);
    if (plan.kind !== 'none') logger.info('Cloudflare WAF: probe-block rule applied', { change: plan.kind });
    return await recordStatus('active');
  } catch (error) {
    if (error instanceof CloudflareWafError && error.forbidden) {
      logger.warn('Cloudflare WAF: token lacks Zone WAF: Edit — probe-block rule not applied');
      return recordStatus('missing-permission', error.message);
    }
    logger.warn('Cloudflare WAF: could not apply the probe-block rule', { error: (error as Error).message });
    return recordStatus('error', (error as Error).message);
  }
}
