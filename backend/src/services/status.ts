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
import { ServiceState, ServiceStatusPayload, ServiceStatusResponse } from '../types';

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

export { getContainerStatus, checkHealthHttp };
