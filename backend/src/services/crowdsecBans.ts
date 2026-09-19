/**
 * List and lift CrowdSec bans from the dashboard (plan.md §540), so clearing
 * a false positive — the operator's own IP, §538 — is not a `cscli decisions
 * delete` on the host (§0.2).
 *
 * Deleting a decision needs a *machine* login on CrowdSec's local API; the
 * bouncer keys this stack already has are read-only. So:
 *
 *  - A `dashboard` machine, its password a hidden generated secret in
 *    apps/crowdsec/.env. `cscli machines add` runs in a throwaway container
 *    against CrowdSec's own data volume (the socket-proxy blocks exec — same
 *    workaround as ntfyAuthBootstrap.ts). `/etc/crowdsec` isn't a volume, so
 *    the throwaway points cscli at the image's `/staging` copy of the config,
 *    which names the same sqlite path. `--force` makes it idempotent and
 *    re-syncs the password if .env ever changes.
 *  - LAPI isn't published (compose comment), so the backend joins the
 *    `crowdsec-lapi` network itself, at runtime, before each call. A backend
 *    recreate drops the attachment and the next call restores it. Declaring
 *    the network in the root compose file instead would make the dashboard
 *    fail to start on any host where CrowdSec never ran (it's external and
 *    created by the executor).
 */

import { exec } from 'child_process';
import { hostname } from 'os';
import { isIP } from 'net';
import logger from '../utils/logger';
import { resolveComposeFile } from '../config/services';
import { readAppEnvValue } from './appEnv';
import { getAppVersion } from '../version';

export const CROWDSEC_SERVICE = 'crowdsec';
export const DASHBOARD_PASSWORD_KEY = 'CROWDSEC_DASHBOARD_PASSWORD';
const MACHINE_ID = 'dashboard';
const LAPI_NETWORK = 'crowdsec-lapi';
const LAPI_URL = 'http://crowdsec:8080';
const REQUEST_TIMEOUT_MS = 10_000;

export interface CrowdsecBan {
  ip: string;
  scenarios: string[];
  /** Seconds until the longest of this IP's bans expires. */
  expiresInSeconds: number;
  country: string | null;
  asName: string | null;
  /** When the earliest of its alerts was raised (ISO). */
  since: string | null;
}

export class CrowdsecUnavailableError extends Error {}

function run(command: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString() || error.message));
        return;
      }
      resolve(`${stdout}\n${stderr}`);
    });
  });
}

function dashboardPassword(): string | null {
  return (readAppEnvValue(CROWDSEC_SERVICE, DASHBOARD_PASSWORD_KEY) ?? '').trim() || null;
}

/**
 * Register (or re-password) the `dashboard` machine. Post-start hook, and
 * retried lazily by the ban calls when a login is refused — so a host that
 * picks this up via self-update works without a CrowdSec restart.
 */
export async function ensureCrowdsecDashboardMachine(serviceName: string): Promise<boolean> {
  if (serviceName !== CROWDSEC_SERVICE) return false;
  const password = dashboardPassword();
  const resolved = resolveComposeFile(CROWDSEC_SERVICE);
  if (!password || !resolved?.composeFile) return false;
  const script =
    `cscli -c /staging/etc/crowdsec/config.yaml machines add ${MACHINE_ID} ` +
    `--password '${password}' -f /dev/null --force`;
  const scriptB64 = Buffer.from(script).toString('base64');
  try {
    await run(
      `docker compose -p ${resolved.projectName} ${resolved.composeArgs} run --rm --no-deps -T ` +
        `--entrypoint /bin/sh ${CROWDSEC_SERVICE} -c "echo ${scriptB64} | base64 -d | /bin/sh"`
    );
    return true;
  } catch (error) {
    // Never blocks the start; the ban calls retry it.
    logger.warn('CrowdSec: could not register the dashboard machine', { error: (error as Error).message });
    return false;
  }
}

async function joinLapiNetwork(): Promise<void> {
  try {
    await run(`docker network connect ${LAPI_NETWORK} ${hostname()}`, 15_000);
  } catch (error) {
    // "already exists in network" is the normal case after the first call.
    if (!/already exists/i.test((error as Error).message)) {
      throw new CrowdsecUnavailableError(
        `Could not reach CrowdSec's local API network — is CrowdSec running? (${(error as Error).message.trim()})`
      );
    }
  }
}

async function login(retryAfterRegister = true): Promise<string> {
  const password = dashboardPassword();
  if (!password) {
    throw new CrowdsecUnavailableError('CrowdSec has not been started from the dashboard yet.');
  }
  let response: Response;
  try {
    response = await fetch(`${LAPI_URL}/v1/watchers/login`, {
      method: 'POST',
      // LAPI refuses a login whose User-Agent isn't exactly `name/version`
      // ("bad user agent", logged only as a warning) — with the same 401 and
      // "incorrect Username or Password" as a wrong password (§540).
      headers: { 'Content-Type': 'application/json', 'User-Agent': `business-lab-dashboard/${getAppVersion()}` },
      body: JSON.stringify({ machine_id: MACHINE_ID, password, scenarios: [] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CrowdsecUnavailableError('CrowdSec is not answering — is it running?');
  }
  if (response.status === 401 && retryAfterRegister && (await ensureCrowdsecDashboardMachine(CROWDSEC_SERVICE))) {
    return login(false);
  }
  if (!response.ok) {
    throw new CrowdsecUnavailableError(`CrowdSec refused the dashboard's login (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new CrowdsecUnavailableError('CrowdSec returned no token.');
  return body.token;
}

async function lapi(method: string, pathAndQuery: string): Promise<unknown> {
  await joinLapiNetwork();
  const token = await login();
  const response = await fetch(`${LAPI_URL}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': `business-lab-dashboard/${getAppVersion()}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new CrowdsecUnavailableError(`CrowdSec answered HTTP ${response.status} to ${method} ${pathAndQuery.split('?')[0]}.`);
  }
  return response.json();
}

/** Go's time.Duration string ("3h32m29.5s", "-1m2s", "450ms") in seconds. */
export function goDurationSeconds(value: string): number {
  const sign = value.startsWith('-') ? -1 : 1;
  let total = 0;
  for (const [, n, unit] of value.matchAll(/([\d.]+)(h|ms|m|s|us|µs|ns)/g)) {
    const factor = { h: 3600, m: 60, s: 1, ms: 1e-3, us: 1e-6, µs: 1e-6, ns: 1e-9 }[unit] ?? 0;
    total += parseFloat(n) * factor;
  }
  return sign * total;
}

interface LapiAlert {
  scenario?: string;
  created_at?: string;
  source?: { cn?: string; as_name?: string };
  decisions?: { value?: string; scope?: string; type?: string; origin?: string; duration?: string; scenario?: string }[];
}

/**
 * Active bans from this host's own detections and manual `cscli` bans, one
 * row per IP. The community blocklist (CAPI/lists, ~26k IPs) is left out:
 * nobody unbans those by hand, and they'd bury the handful that matter.
 * Exported for the test.
 */
export function groupBans(alerts: LapiAlert[]): CrowdsecBan[] {
  const byIp = new Map<string, CrowdsecBan>();
  for (const alert of alerts) {
    for (const d of alert.decisions ?? []) {
      if (d.type !== 'ban' || d.scope?.toLowerCase() !== 'ip' || !d.value) continue;
      if (d.origin === 'CAPI' || d.origin === 'lists') continue;
      const remaining = goDurationSeconds(d.duration ?? '');
      if (remaining <= 0) continue;
      const entry =
        byIp.get(d.value) ??
        { ip: d.value, scenarios: [], expiresInSeconds: 0, country: alert.source?.cn || null, asName: alert.source?.as_name || null, since: null };
      const scenario = d.scenario || alert.scenario;
      if (scenario && !entry.scenarios.includes(scenario)) entry.scenarios.push(scenario);
      entry.expiresInSeconds = Math.max(entry.expiresInSeconds, Math.round(remaining));
      if (alert.created_at && (!entry.since || alert.created_at < entry.since)) entry.since = alert.created_at;
      byIp.set(d.value, entry);
    }
  }
  return [...byIp.values()].sort((a, b) => (b.since ?? '').localeCompare(a.since ?? ''));
}

export async function listCrowdsecBans(): Promise<CrowdsecBan[]> {
  const alerts = await lapi('GET', '/v1/alerts?has_active_decision=true&include_capi=false&limit=1000');
  return groupBans(Array.isArray(alerts) ? (alerts as LapiAlert[]) : []);
}

/** Lifts every decision on this IP (all scenarios, any origin). Returns how many. */
export async function unbanCrowdsecIp(ip: string): Promise<number> {
  if (!isIP(ip)) throw new Error('Not an IP address.');
  const body = (await lapi('DELETE', `/v1/decisions?ip=${encodeURIComponent(ip)}`)) as { nbDeleted?: string };
  return Number(body.nbDeleted ?? 0);
}
