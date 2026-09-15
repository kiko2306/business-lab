/**
 * Auto-restart for Tailscale and NetBird after repeated external-reachability
 * failures. Built after §442/§443: a wedged Tailscale Funnel sat undetected
 * for who knows how long because every *local* health signal — `docker ps`,
 * `tailscale status` — reported fine while the actual external path was
 * broken. `restart: unless-stopped` never fires here since neither container
 * crashes; only a real external probe catches it.
 *
 * Detection and alerting for all five critical services (NPM, Authelia,
 * Tailscale, NetBird management/relay) now live in Uptime Kuma
 * (`uptimeKumaCriticalMonitors.ts`) — it already has ntfy wired in, checks on
 * a much faster cadence than a hand-rolled loop would, and gives a visual
 * history for free. This module's only job is the one thing Uptime Kuma
 * can't do: act. It re-probes Tailscale/NetBird itself (deliberately
 * independent of Uptime Kuma — the auto-restart path must not go dark just
 * because Uptime Kuma itself is having a bad day) and restarts the owning
 * compose project after a few consecutive failures.
 *
 * NPM and Authelia are intentionally not here at all — alert-only by the
 * user's own call (§443): everything exposed routes through both, and a
 * blind auto-restart risks masking a real incident (a bad cert renewal, a DB
 * problem) instead of surfacing it.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import logger from '../utils/logger';
import { getExposureConfig } from '../utils/exposureSettings';
import { publishAlert } from '../utils/alertNotify';
import { resolveComposeFile } from '../config/services';
import { managementJsonPath } from './netbirdAuthFlow';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 10_000;
const RECONCILE_INTERVAL_MS = 2 * 60 * 1000;
// Give the stack a couple of minutes to settle on a cold start before the
// first pass — a boot-time false positive helps no one.
const INITIAL_DELAY_MS = 2 * 60 * 1000;
const RESTART_AFTER = 3;
// Stops a still-broken service being bounced every RESTART_AFTER passes
// forever — one retry, then wait, rather than a restart storm.
const RESTART_COOLDOWN_MS = 15 * 60 * 1000;

interface Probe {
  name: string;
  /** services.ts key to restart via `docker compose restart`. */
  restartService: string;
  /** Resolves to the URL to probe, or null when its config isn't ready yet. */
  url(): Promise<string | null>;
}

interface ProbeState {
  consecutiveFailures: number;
  lastRestartAt: number;
}

const state = new Map<string, ProbeState>();

function getState(name: string): ProbeState {
  let s = state.get(name);
  if (!s) {
    s = { consecutiveFailures: 0, lastRestartAt: 0 };
    state.set(name, s);
  }
  return s;
}

async function probeReachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
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
      return config ? `https://netbird-vpn-api.${config.baseDomain}/api/networks` : null;
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

async function restartService(serviceName: string): Promise<void> {
  const resolved = resolveComposeFile(serviceName);
  if (!resolved?.composeFile) return;
  // No service argument — restarts every container in the project, same as
  // a dashboard "Restart" click.
  await execFileAsync('docker', ['compose', '-p', resolved.projectName, '-f', resolved.composeFile, 'restart'], {
    timeout: 90_000,
  });
}

export async function runProbe(probe: Probe): Promise<void> {
  const url = await probe.url();
  if (!url) return; // config not ready yet — nothing to check

  const healthy = await probeReachable(url);
  const s = getState(probe.name);

  if (healthy) {
    s.consecutiveFailures = 0;
    return;
  }

  s.consecutiveFailures += 1;
  logger.warn(`Critical service auto-restart: ${probe.name} unreachable`, {
    consecutiveFailures: s.consecutiveFailures,
    url,
  });

  if (s.consecutiveFailures < RESTART_AFTER) return;
  if (Date.now() - s.lastRestartAt < RESTART_COOLDOWN_MS) return; // tried recently — wait it out

  try {
    await restartService(probe.restartService);
    s.lastRestartAt = Date.now();
    logger.warn(`Critical service auto-restart: restarted ${probe.restartService} after repeated ${probe.name} failures`);
    await publishAlert({
      title: `${probe.name}: auto-restarted ${probe.restartService}`,
      message: `Restarted ${probe.restartService} after ${RESTART_AFTER} consecutive failed external checks against ${probe.name}.`,
      tags: ['arrows_counterclockwise'],
      priority: 4,
    });
  } catch (error) {
    logger.error(`Critical service auto-restart: failed to restart ${probe.restartService}`, {
      error: (error as Error).message,
    });
  }
}

export async function checkCriticalServices(): Promise<void> {
  for (const probe of PROBES) {
    await runProbe(probe).catch((error: Error) =>
      logger.error('Critical service auto-restart: probe crashed', { probe: probe.name, error: error.message })
    );
  }
}

export function startCriticalServiceHealthMonitor(): void {
  setTimeout(() => void checkCriticalServices(), INITIAL_DELAY_MS);
  setInterval(() => void checkCriticalServices(), RECONCILE_INTERVAL_MS);
}
