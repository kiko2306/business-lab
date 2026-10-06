/**
 * Auto-restart for Tailscale and NetBird after repeated external-reachability
 * failures. Built after §442/§443: a wedged Tailscale Funnel sat undetected
 * because every *local* health signal — `docker ps`, `tailscale status` —
 * reported fine while the actual external path was broken.
 * `restart: unless-stopped` never fires there since neither container
 * crashes; only a real external probe catches it.
 *
 * Detection and alerting for all five critical services live in Uptime Kuma
 * (`uptimeKumaCriticalMonitors.ts`). This module's only job is the one thing
 * Uptime Kuma can't do: act.
 *
 * Two guards, both learned the hard way (§444). For an hour this module's own
 * probe saw the Funnel as unreachable from inside the backend container while
 * Uptime Kuma — same host, different container, resolver and HTTP client —
 * got a 405 through it every single minute. Each "fix" restarted a healthy
 * Tailscale and dropped every real NetBird client, every 16 minutes:
 *
 * - **Corroborate before acting.** A restart only goes ahead if Uptime Kuma's
 *   monitor for the same URL agrees it is down. If Uptime Kuma is not
 *   installed, unreachable or has no such monitor, the probe decides alone —
 *   the recovery path must not go dark just because Uptime Kuma is down too.
 * - **One restart per outage.** If the probe is still failing
 *   RESTART_AFTER passes after a restart, the restart didn't help — so it
 *   alerts once and stops restarting that project until every one of its
 *   probes has come back healthy. Whatever the probe gets wrong next time, it
 *   costs one restart, not a loop.
 *
 * NPM and Authelia are intentionally not here at all — alert-only by the
 * user's own call (§443): everything exposed routes through both, and a
 * blind auto-restart risks masking a real incident instead of surfacing it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import dns from 'dns/promises';
import fs from 'fs/promises';
import logger from '../utils/logger';
import { getExposureConfig } from '../utils/exposureSettings';
import { publishAlert } from '../utils/alertNotify';
import { writeAuditLog } from '../utils/audit';
import { getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getHostGatewayIp } from '../utils/network';
import { managementJsonPath } from './netbirdAuthFlow';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 10_000;
const KUMA_TIMEOUT_MS = 5_000;
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;
// Give the stack a couple of minutes to settle on a cold start before the
// first pass — a boot-time false positive helps no one.
const INITIAL_DELAY_MS = 2 * 60 * 1000;
const RESTART_AFTER = 3;
// A name that doesn't resolve gets far longer (§543). The daily Tailscale
// "drop" was this module: `ts.net` intermittently answers NXDOMAIN for the
// live Funnel name, and 1.1.1.1/8.8.8.8 cache that for the zone's 300 s
// negative TTL, so the probe fails for exactly ~5 min (3 passes) and then
// recovers by itself. A restart can't clear a public resolver's cache — it
// only dropped the tailnet. 8 passes (16 min) outlasts that window with room,
// and still restarts if the name stays gone for real.
const RESTART_AFTER_DNS = 8;
const KUMA_SERVICE = 'uptime-kuma';
const KUMA_DOWN = 0;

interface Probe {
  name: string;
  /** services.ts key to restart via `docker compose restart`. */
  restartService: string;
  /** Resolves to the URL to probe, or null when its config isn't ready yet. */
  url(): Promise<string | null>;
}

interface ProjectState {
  /** Restarted, and no pass since has seen every probe healthy. */
  awaitingRecovery: boolean;
  gaveUpAlerted: boolean;
}

const failures = new Map<string, number>();
// Failed passes since the probe last answered. Unlike `failures` a restart
// does not zero it — it is what dates "recovered after N failed passes".
const streaks = new Map<string, number>();
const projects = new Map<string, ProjectState>();

function projectState(name: string): ProjectState {
  let s = projects.get(name);
  if (!s) {
    s = { awaitingRecovery: false, gaveUpAlerted: false };
    projects.set(name, s);
  }
  return s;
}

/**
 * Where the name points from this container's resolver — the thing to compare
 * with what Uptime Kuma's resolver reached when the two disagree (§444).
 */
async function resolvedAddresses(host: string): Promise<string> {
  try {
    const found = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 3_000).unref()),
    ]);
    return found.map((a) => a.address).join(', ') || 'nothing';
  } catch (error) {
    const e = error as Error & { code?: string };
    return `lookup failed (${e.code ?? e.message})`;
  }
}

interface ProbeOutcome {
  /** null when reachable; otherwise why not — the part §444 had no record of. */
  error: string | null;
  /** One line for the audit log: timing, failing syscall/address, resolution. Empty when reachable. */
  detail: string;
}

async function runProbe(url: string): Promise<ProbeOutcome> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    return { error: null, detail: '' };
  } catch (error) {
    const e = error as Error & { cause?: { code?: string; message?: string; syscall?: string; address?: string; port?: number } };
    const c = e.cause;
    const cause = c ? ` (${c.code ?? c.message})` : '';
    const where = c?.syscall ? `, ${c.syscall}${c.address ? ` ${c.address}${c.port ? `:${c.port}` : ''}` : ''}` : '';
    const resolved = await resolvedAddresses(new URL(url).hostname);
    return {
      error: `${e.name}: ${e.message}${cause}`,
      detail: `after ${Date.now() - started} ms${where}; resolves to ${resolved}`,
    };
  }
}

function kumaVerdict(status: number | null): string {
  switch (status) {
    case 1:
      return 'Uptime Kuma sees it up';
    case 0:
      return 'Uptime Kuma sees it down';
    case 2:
      return 'Uptime Kuma: pending';
    case 3:
      return 'Uptime Kuma: maintenance';
    default:
      return 'Uptime Kuma: no answer';
  }
}

/**
 * Uptime Kuma's verdict for the monitor probing `url`, from its Prometheus
 * `/metrics` line — `monitor_status{…,monitor_url="<url>",…} <0|1|2|3>`
 * (down/up/pending/maintenance). Matched on URL, not monitor name, so a
 * monitor renamed in Uptime Kuma's UI still counts. null when absent.
 * Exported for the test.
 */
/** The probe failed to resolve the host, rather than to reach it. Exported for the test. */
export function isDnsFailure(error: string): boolean {
  return /\((ENOTFOUND|EAI_AGAIN)\)$/.test(error);
}

export function parseKumaMonitorStatus(metrics: string, url: string): number | null {
  const needle = `monitor_url="${url}"`;
  for (const line of metrics.split('\n')) {
    if (!line.startsWith('monitor_status{') || !line.includes(needle)) continue;
    const value = Number(line.slice(line.lastIndexOf('}') + 1).trim());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * Readable without credentials because this deployment runs Uptime Kuma with
 * `disableAuth` (apps/uptime-kuma/docker-compose.yml's uptime-kuma-init) —
 * its `apiAuth` middleware skips basic auth entirely then (checked against
 * the pinned 1.23.17 source, server/auth.js). Any failure is "unknown".
 */
async function kumaMonitorStatus(url: string): Promise<number | null> {
  try {
    const port = getPublishedUpstreamPort(KUMA_SERVICE);
    if (!port) return null;
    const response = await fetch(`http://${await getHostGatewayIp()}:${port}/metrics`, {
      signal: AbortSignal.timeout(KUMA_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseKumaMonitorStatus(await response.text(), url);
  } catch {
    return null;
  }
}

/**
 * The Funnel hostname NetBird's Signal server is published on, read live
 * from management.json rather than assumed as the `businesslab-signal`
 * default — `TS_HOSTNAME` is overridable (apps/tailscale/docker-compose.yml).
 * "host:port" in Signal.URI; only the host matters for an HTTPS probe.
 * Exported: uptimeKumaCriticalMonitors.ts needs the same hostname for its
 * Tailscale monitor.
 */
export async function getSignalHostname(): Promise<string | null> {
  try {
    const raw = await fs.readFile(managementJsonPath(), 'utf8');
    const parsed = JSON.parse(raw) as { Signal?: { URI?: string } };
    const uri = parsed.Signal?.URI;
    return uri ? uri.split(':')[0] : null;
  } catch {
    return null;
  }
}

const PROBES: Probe[] = [
  {
    name: 'Tailscale Funnel (also NetBird signal)',
    restartService: 'tailscale',
    url: async () => {
      const host = await getSignalHostname();
      return host ? `https://${host}/` : null;
    },
  },
  {
    name: 'NetBird management',
    restartService: 'netbird-vpn',
    url: async () => {
      const config = await getExposureConfig();
      return config ? `https://netbird-vpn-api.${config.baseDomain}/api/instance` : null;
    },
  },
  {
    name: 'NetBird relay',
    restartService: 'netbird-vpn',
    url: async () => {
      const config = await getExposureConfig();
      return config ? `https://netbird-vpn-relay.${config.baseDomain}/` : null;
    },
  },
];

/** False when the app isn't installed — nothing was restarted. */
async function restartService(serviceName: string): Promise<boolean> {
  const resolved = resolveComposeFile(serviceName);
  if (!resolved?.composeFile) return false;
  // No service argument — restarts every container in the project, same as
  // a dashboard "Restart" click.
  await execFileAsync('docker', ['compose', '-p', resolved.projectName, '-f', resolved.composeFile, 'restart'], {
    timeout: 90_000,
  });
  return true;
}

interface ProbeResult {
  probe: Probe;
  url: string;
  error: string | null;
  /** Uptime Kuma's verdict for the URL, looked up on every failed pass; null = no answer. */
  kuma: number | null;
}

async function handleProject(project: string, results: ProbeResult[]): Promise<void> {
  const s = projectState(project);

  if (results.every((r) => r.error === null)) {
    s.awaitingRecovery = false;
    s.gaveUpAlerted = false;
    return;
  }

  const atThreshold = results.filter(
    (r) => r.error !== null && (failures.get(r.probe.name) ?? 0) >= (isDnsFailure(r.error) ? RESTART_AFTER_DNS : RESTART_AFTER)
  );
  if (!atThreshold.length) return;

  if (s.awaitingRecovery) {
    if (!s.gaveUpAlerted) {
      s.gaveUpAlerted = true;
      const names = atThreshold.map((r) => r.probe.name).join(', ');
      logger.error(`Critical service auto-restart: restarting ${project} did not restore ${names} — not restarting again until it recovers`);
      await writeAuditLog({
        action: 'critical-service.gave-up',
        resource: `${project}: restart did not restore ${names}; auto-restart paused until it recovers`,
        result: 'failure',
      });
      await publishAlert({
        category: 'critical-service',
        title: `${project}: auto-restart didn't help`,
        message: `${names} still failing after restarting ${project}. Auto-restart is paused for it until it recovers — needs a look.`,
        tags: ['rotating_light'],
        priority: 5,
      });
    }
    return;
  }

  const confirmed: ProbeResult[] = [];
  for (const r of atThreshold) {
    const kuma = r.kuma;
    if (kuma === null || kuma === KUMA_DOWN) {
      confirmed.push(r);
    } else {
      logger.warn(`Critical service auto-restart: ${r.probe.name} fails from here but Uptime Kuma sees it up — not restarting`, {
        url: r.url,
        kumaStatus: kuma,
        error: r.error,
      });
    }
  }
  if (!confirmed.length) return;

  try {
    if (!(await restartService(project))) return;
    s.awaitingRecovery = true;
    for (const r of results) failures.set(r.probe.name, 0);
    const names = confirmed.map((r) => r.probe.name).join(', ');
    logger.warn(`Critical service auto-restart: restarted ${project} after repeated ${names} failures`, {
      errors: confirmed.map((r) => r.error),
    });
    await writeAuditLog({
      action: 'critical-service.restarted',
      resource: `${project}: restarted after repeated ${names} failures (${confirmed.map((r) => `${r.error}; ${kumaVerdict(r.kuma)}`).join(' | ')})`,
    });
    await publishAlert({
      category: 'critical-service',
      title: `${names}: auto-restarted ${project}`,
      message: `Restarted ${project} after ${RESTART_AFTER} consecutive failed external checks against ${names}.`,
      tags: ['arrows_counterclockwise'],
      priority: 4,
    });
  } catch (error) {
    logger.error(`Critical service auto-restart: failed to restart ${project}`, { error: (error as Error).message });
  }
}

export async function checkCriticalServices(): Promise<void> {
  const byProject = new Map<string, ProbeResult[]>();

  for (const probe of PROBES) {
    const url = await probe.url().catch(() => null);
    if (!url) continue; // config not ready yet — nothing to check
    const { error, detail } = await runProbe(url);
    const count = error === null ? 0 : (failures.get(probe.name) ?? 0) + 1;
    failures.set(probe.name, count);
    const streak = error === null ? 0 : (streaks.get(probe.name) ?? 0) + 1;
    const wasFailing = streaks.get(probe.name) ?? 0;
    streaks.set(probe.name, streak);
    let kuma: number | null = null;
    if (error !== null) {
      kuma = await kumaMonitorStatus(url);
      logger.warn(`Critical service auto-restart: ${probe.name} unreachable`, { consecutiveFailures: count, url, error });
      // Stops at the longest window before a restart is possible: after that
      // the outage is already on record and a long one would flood the log.
      if (streak <= RESTART_AFTER_DNS) {
        await writeAuditLog({
          action: 'critical-service.probe-failed',
          resource: `${probe.name}: ${error} ${detail}; ${kumaVerdict(kuma)}`,
          result: 'failure',
          metadata: { url, consecutiveFailures: count, kumaStatus: kuma, error, detail },
        });
      }
    } else if (wasFailing > 0) {
      await writeAuditLog({ action: 'critical-service.recovered', resource: `${probe.name}: reachable again after ${wasFailing} failed passes` });
    }
    byProject.set(probe.restartService, [...(byProject.get(probe.restartService) ?? []), { probe, url, error, kuma }]);
  }

  for (const [project, results] of byProject) {
    await handleProject(project, results).catch((error: Error) =>
      logger.error('Critical service auto-restart: pass crashed', { project, error: error.message })
    );
  }
}

export function startCriticalServiceHealthMonitor(): void {
  setTimeout(() => void checkCriticalServices(), INITIAL_DELAY_MS);
  setInterval(() => void checkCriticalServices(), RECONCILE_INTERVAL_MS);
}
