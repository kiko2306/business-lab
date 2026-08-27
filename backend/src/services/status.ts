/**
 * Service status aggregator
 * Retrieves Docker container state and optional health check status.
 * Returns consolidated service status information.
 */

import { exec } from 'child_process';
import https from 'https';
import http from 'http';
import logger from '../utils/logger';
import { getAllServices, getService, getProjectName, resolveComposeFile } from '../config/services';
import { getServiceExposureRow } from './exposure';
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

      if (!states.length) {
        resolve('unknown');
      } else if (states.every((state) => state === 'running')) {
        resolve('running');
      } else if (states.some((state) => ['running', 'restarting', 'created'].includes(state))) {
        // Partially up, e.g. a dependency is still coming online.
        resolve('starting');
      } else {
        resolve('stopped');
      }
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
 * Health check URLs in the service registry are written from the host's point
 * of view (localhost:PORT). The backend runs in a container, where localhost is
 * the backend itself, so the host must be substituted.
 */
function resolveHealthUrl(rawUrl: string): string {
  const healthHost = process.env.SERVICE_HEALTH_HOST;
  if (!healthHost) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      url.hostname = healthHost;
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Check service health via HTTP
 */
function checkHealthHttp(url: string, timeout = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeoutHandle = setTimeout(() => {
      resolve(false);
    }, timeout);

    const request = protocol.get(url, { timeout }, (response) => {
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

    // Without a configured check there's nothing to fail, so a running
    // service is reported healthy; only an actual check can mark it unhealthy.
    let healthy = state === 'running';
    if (service.healthCheck?.enabled && state === 'running') {
      if (service.healthCheck.type === 'http' && service.healthCheck.url) {
        healthy = await checkHealthHttp(resolveHealthUrl(service.healthCheck.url), service.healthCheck.timeout);
      }
    }

    const ports = state === 'running' ? await getContainerPorts(getProjectName(serviceName)) : [];
    const exposedHostname = state === 'running' ? await getExposedHostname(serviceName) : null;

    return {
      name: serviceName,
      label: service.label,
      description: service.description,
      icon: service.icon,
      category: service.category,
      state,
      healthy,
      lastChecked: new Date(),
      setupTokenSupported: Boolean(service.setupToken),
      adminUserManagementSupported: Boolean(service.supportsAdminUserManagement),
      dependsOn: service.dependsOn,
      ports,
      exposedHostname,
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

export { getContainerStatus, getContainerPorts, checkHealthHttp };
