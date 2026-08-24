/**
 * Service status aggregator
 * Retrieves Docker container state and optional health check status.
 * Returns consolidated service status information.
 */

const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');
const { getAllServices, getService } = require('../config/services');

/**
 * Get container status from docker ps
 */
function getContainerStatus(containerName) {
  return new Promise((resolve) => {
    const command = `docker ps -a --filter "name=${containerName}" --format "{{.State}}" 2>/dev/null | head -n1`;
    exec(command, (error, stdout) => {
      if (error) {
        resolve('unknown');
      } else {
        const state = stdout.trim().toLowerCase();
        resolve(state || 'unknown');
      }
    });
  });
}

/**
 * Check service health via HTTP
 */
function checkHealthHttp(url, timeout = 5000) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeoutHandle = setTimeout(() => {
      resolve(false);
    }, timeout);

    const request = protocol.get(url, { timeout }, (response) => {
      clearTimeout(timeoutHandle);
      // Consider 2xx and 3xx as healthy
      resolve(response.statusCode >= 200 && response.statusCode < 400);
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
async function getServiceStatus(serviceName) {
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
    const containerName = serviceName.replace(/[_-]/g, '_');
    const containerState = await getContainerStatus(containerName);

    // Normalize Docker state to our status enum
    let state = containerState;
    if (containerState === 'running') {
      state = 'running';
    } else if (containerState === 'exited') {
      state = 'stopped';
    } else if (containerState === 'restarting') {
      state = 'starting';
    } else {
      state = 'unknown';
    }

    // Check health if enabled
    let healthy = false;
    if (service.healthCheck && service.healthCheck.enabled && state === 'running') {
      if (service.healthCheck.type === 'http') {
        healthy = await checkHealthHttp(
          service.healthCheck.url,
          service.healthCheck.timeout
        );
      }
    }

    return {
      name: serviceName,
      label: service.label,
      description: service.description,
      icon: service.icon,
      state,
      healthy,
      lastChecked: new Date(),
    };
  } catch (error) {
    logger.error(`Error getting status for service ${serviceName}`, {
      error: error.message,
    });
    return {
      name: serviceName,
      label: service.label,
      state: 'error',
      healthy: false,
      error: error.message,
      lastChecked: new Date(),
    };
  }
}

/**
 * Get status for all services
 */
async function getAllServiceStatus() {
  const services = getAllServices();
  const statuses = await Promise.all(
    services.map((service) => getServiceStatus(service.name))
  );

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

module.exports = {
  getServiceStatus,
  getAllServiceStatus,
  getContainerStatus,
  checkHealthHttp,
};
