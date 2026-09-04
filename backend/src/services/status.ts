/**
 * Service status aggregator
 * Retrieves Docker container state and optional health check status.
 * Returns consolidated service status information.
 */

import { exec } from 'child_process';
import https from 'https';
import http from 'http';
import logger from '../utils/logger';
import { getAllServices, getService, getProjectName, getPublishedUpstreamPort, resolveComposeFile } from '../config/services';
import { getServiceExposureRow } from './exposure';
import { getImageUpdateRow } from './imageUpdates';
import { pinnedImages } from './composeOverride';
import { ServicePortMapping, ServiceState, ServiceStatusPayload, ServiceStatusResponse } from '../types';

/**
 * The service's live public hostname, if exposure is enabled and was
 * provisioned successfully. Swallows lookup failures — exposure status is
 * secondary to the container status this call is really for.
 */
async function getExposedHostname(serviceName: string): Promise<string | null> {
  try {
    const row = await getServiceExposureRow(serviceName);
    return row && row.enabled && row.status === 'provisioned' ? row.hostname : null;
  } catch (error) {
    logger.error(`Error loading exposure status for service ${serviceName}`, { error: (error as Error).message });
    return null;
  }
}

/**
 * Collapse a compose project's per-container `docker ps` states into a single
 * service state. Order matters here:
 *  - any container stuck `restarting` → the project is crash-looping (`error`),
 *    not "still starting" — a restart loop never resolves on its own.
 *  - all `running` → `running`.
 *  - some `running`, some still `created` → genuinely mid-boot (`starting`),
 *    e.g. a dependency container hasn't been started yet.
 *  - some `running`, the rest exited → treat as up: one-shot init/migration
 *    containers that ran and exited are normal (e.g. beszel's init step).
 *  - nothing `running` but something `created` → `compose up` created the
 *    container(s) but they never started — a host-port clash or a bad mount —
 *    which is a failure (`error`), not a transient state.
 *  - nothing `running` or `created` → everything exited → `stopped`.
 */
function aggregateContainerState(states: string[]): ServiceState {
  if (!states.length) {
    return 'unknown';
  }

  const has = (state: string) => states.includes(state);
  const running = states.filter((state) => state === 'running').length;

  if (has('restarting')) {
    return 'error';
  }
  if (running === states.length) {
    return 'running';
  }
  if (running > 0) {
    return has('created') ? 'starting' : 'running';
  }
  if (has('created')) {
    return 'error';
  }
  return 'stopped';
}

/**
 * Get the aggregated state of a compose project's containers.
 * Matching is done on the compose project label rather than container names,
 * because compose prefixes/suffixes the names it generates.
 */
function getContainerStatus(projectName: string | null): Promise<ServiceState> {
  return new Promise((resolve) => {
    const command = `docker ps -a --filter "label=com.docker.compose.project=${projectName}" --format "{{.State}}"`;
    exec(command, (error, stdout) => {
      if (error) {
        resolve('unknown');
        return;
      }

      const states = stdout
        .trim()
        .split('\n')
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean);

      resolve(aggregateContainerState(states));
    });
  });
}

// Matches one `docker ps --format {{.Ports}}` entry, e.g.
// "0.0.0.0:8080->80/tcp" or "0.0.0.0:80-81->80-81/tcp" (port ranges).
// Unpublished container-only ports (e.g. "5432/tcp", no "->") don't match
// and are skipped, since there's nothing reachable from the host to report.
const PORT_MAPPING_PATTERN = /(?:\S+:)?(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(tcp|udp)/g;

/**
 * Get the live published host ports for a compose project's containers,
 * straight from `docker ps` rather than parsed from the compose file — this
 * way it reflects what's actually bound right now and covers every
 * container in a multi-container project, not just the first `ports:` entry.
 */
function getContainerPorts(projectName: string | null): Promise<ServicePortMapping[]> {
  return new Promise((resolve) => {
    if (!projectName) {
      resolve([]);
      return;
    }

    const command = `docker ps --filter "label=com.docker.compose.project=${projectName}" --format "{{.Ports}}"`;
    exec(command, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const ports = new Map<string, ServicePortMapping>();
      for (const line of stdout.split('\n')) {
        PORT_MAPPING_PATTERN.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = PORT_MAPPING_PATTERN.exec(line)) !== null) {
          const [, hostPort, containerPort, protocol] = match;
          const key = `${hostPort}/${protocol}`;
          if (!ports.has(key)) {
            ports.set(key, { hostPort, containerPort, protocol });
          }
        }
      }

      resolve(
        [...ports.values()].sort(
          (a, b) => Number(a.hostPort.split('-')[0]) - Number(b.hostPort.split('-')[0])
        )
      );
    });
  });
}

/**
 * The equivalent of getContainerPorts for a service running with
 * `network_mode: host`, whose port is a registry fact rather than something
 * `docker ps` can report. See ServiceDefinition.hostNetworkPort.
 */
export function hostNetworkPortMappings(hostNetworkPort: number): ServicePortMapping[] {
  const port = String(hostNetworkPort);
  return [{ hostPort: port, containerPort: port, protocol: 'tcp' }];
}

/**
 * Health check URLs in the service registry are written from the host's point
 * of view (localhost:CONTAINER_PORT). To make them reachable from the backend
 * container we connect to SERVICE_HEALTH_HOST on the service's *published* host
 * port (which often isn't the container port — Vaultwarden serves :80 but
 * publishes :8222) while still sending the original `localhost:CONTAINER_PORT`
 * as the Host header, so apps that validate Host (gethomepage) still accept it.
 */
function resolveHealthTarget(rawUrl: string, publishedPort: number | null): { url: string; hostHeader?: string } {
  try {
    const url = new URL(rawUrl);
    const hostHeader = url.host; // e.g. "localhost:3000" — what the app expects
    const healthHost = process.env.SERVICE_HEALTH_HOST;
    if (healthHost && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
      url.hostname = healthHost;
    }
    if (publishedPort) {
      url.port = String(publishedPort);
    }
    return { url: url.toString(), hostHeader };
  } catch {
    return { url: rawUrl };
  }
}

/**
 * Whether a running service can actually be reached for an HTTP health probe.
 *
 * The probe connects to the service's *published* host port (`webPort`), or —
 * for a host-networked app — the port it declares (`hostNetworkPort`). A
 * container that publishes nothing and declares neither has no address the
 * backend container can reach: `resolveHealthTarget` would fall back to the
 * container port on `SERVICE_HEALTH_HOST`, where nothing is listening, and the
 * probe would fail — reporting a perfectly healthy app as unhealthy. No
 * registry app hits this today; this stops a future portless one from getting
 * a spurious red (plan.md §170).
 */
export function healthProbeReachable(webPort: number | null, hostNetworkPort: number | undefined): boolean {
  return webPort !== null || hostNetworkPort !== undefined;
}

/**
 * Check service health via HTTP
 */
function checkHealthHttp(target: { url: string; hostHeader?: string }, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = target.url.startsWith('https') ? https : http;
    const timeoutHandle = setTimeout(() => {
      resolve(false);
    }, timeout);

    const options = target.hostHeader ? { timeout, headers: { Host: target.hostHeader } } : { timeout };
    const request = protocol.get(target.url, options, (response) => {
      clearTimeout(timeoutHandle);
      // Consider 2xx and 3xx as healthy
      resolve((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 400);
      response.resume();
    });

    request.on('error', () => {
      clearTimeout(timeoutHandle);
      resolve(false);
    });
  });
}

/**
 * Get status for a single service
 */
export async function getServiceStatus(serviceName: string): Promise<ServiceStatusPayload> {
  const service = getService(serviceName);

  if (!service) {
    return {
      name: serviceName,
      state: 'unknown',
      healthy: false,
      error: 'Service not found',
    };
  }

  try {
    // Get container state
    const containerState = await getContainerStatus(getProjectName(serviceName));

    // `compose down` removes containers, so an installed app with no containers
    // is stopped rather than unknown. Uninstalled apps stay unknown.
    const installed = Boolean(resolveComposeFile(serviceName)?.composeFile);
    const state: ServiceState = containerState === 'unknown' && installed ? 'stopped' : containerState;

    const webPort =
      state === 'running' ? getPublishedUpstreamPort(serviceName, service.exposurePortEnvVar) ?? null : null;

    // Without a configured check there's nothing to fail, so a running
    // service is reported healthy; only an actual check can mark it unhealthy.
    let healthy = state === 'running';
    if (service.healthCheck?.enabled && state === 'running') {
      if (service.healthCheck.type === 'http' && service.healthCheck.url) {
        if (healthProbeReachable(webPort, service.hostNetworkPort)) {
          healthy = await checkHealthHttp(
            resolveHealthTarget(service.healthCheck.url, webPort),
            service.healthCheck.timeout
          );
        } else {
          // Nothing to probe against — leave `healthy` at its running default
          // rather than run a check that can only fail.
          logger.warn('Skipping health check: service publishes no reachable host port', { service: serviceName });
        }
      }
    }

    // A host-networked service publishes nothing for `docker ps` to report —
    // it binds the host's interfaces directly — so asking docker would drop it
    // out of the dashboard's running-apps-and-ports table entirely. Report the
    // port it declared instead: from the host's side it is just as reachable,
    // and the container port is the same number by definition.
    const ports =
      state !== 'running'
        ? []
        : service.hostNetworkPort
          ? hostNetworkPortMappings(service.hostNetworkPort)
          : await getContainerPorts(getProjectName(serviceName));
    const exposedHostname = state === 'running' ? await getExposedHostname(serviceName) : null;
    const updates = await getImageUpdateRow(serviceName).catch(() => null);
    // Image digests the Update button pinned into docker-compose.override.yml
    // (composeOverride.ts). Non-empty means the app is frozen on a specific
    // build until "Unpin" — surfaced so the card can say so.
    const resolvedForPins = resolveComposeFile(serviceName);
    const pinned = resolvedForPins?.appDir ? [...pinnedImages(resolvedForPins.appDir).values()] : [];

    return {
      name: serviceName,
      label: service.label,
      description: service.description,
      icon: service.icon,
      category: service.category,
      state,
      healthy,
      lastChecked: new Date(),
      adminUserManagementSupported: Boolean(service.supportsAdminUserManagement),
      dependsOn: service.dependsOn,
      requires: service.requires,
      updateImages: updates?.outdated ?? [],
      updateCheckedAt: updates?.checkedAt ?? null,
      pinnedImages: pinned,
      ports,
      exposedHostname,
      webPath: service.webPath,
      webPort,
    };
  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Error getting status for service ${serviceName}`, { error: message });
    return {
      name: serviceName,
      label: service.label,
      category: service.category,
      state: 'error',
      healthy: false,
      error: message,
      lastChecked: new Date(),
    };
  }
}

/**
 * Get status for all services
 */
export async function getAllServiceStatus(): Promise<ServiceStatusResponse> {
  const services = getAllServices();
  const statuses = await Promise.all(services.map((service) => getServiceStatus(service.name)));

  return {
    timestamp: new Date(),
    services: statuses,
    summary: {
      total: statuses.length,
      running: statuses.filter((s) => s.state === 'running').length,
      stopped: statuses.filter((s) => s.state === 'stopped').length,
      error: statuses.filter((s) => s.state === 'error').length,
      starting: statuses.filter((s) => s.state === 'starting').length,
    },
  };
}

export { aggregateContainerState, getContainerStatus, getContainerPorts, checkHealthHttp };
