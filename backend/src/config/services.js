/**
 * Service registry and configuration
 * Defines all available services that can be managed by the system.
 * Only services in this allowlist can be controlled via the API.
 */

const fs = require('fs');
const path = require('path');

// Compose files are named inconsistently across upstream projects, so each
// app directory is probed for any of the filenames Docker Compose accepts.
const COMPOSE_FILENAMES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
];

const SERVICES = {
  'nginx-proxy-manager': {
    name: 'nginx-proxy-manager',
    label: 'Nginx Proxy Manager',
    description: 'Reverse proxy and certificate management',
    icon: 'nginx',
    composePath: 'apps/nginx-proxy-manager/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:81/health',
      interval: 30000, // 30 seconds
      timeout: 5000,
    },
  },
  'netbird-vpn': {
    name: 'netbird-vpn',
    label: 'Netbird VPN',
    description: 'Zero-trust VPN and network access',
    icon: 'vpn',
    composePath: 'apps/netbird-vpn/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'home-assistant': {
    name: 'home-assistant',
    label: 'Home Assistant',
    description: 'Home automation platform',
    icon: 'home',
    composePath: 'apps/home-assistant/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8123/api/',
      interval: 30000,
      timeout: 5000,
    },
  },
  'cloudflare-tunnel': {
    name: 'cloudflare-tunnel',
    label: 'Cloudflare Tunnel',
    description: 'Secure tunnel to Cloudflare',
    icon: 'cloud',
    composePath: 'apps/cloudflare-tunnel/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'code-server': {
    name: 'code-server',
    label: 'Code Server',
    description: 'VS Code in the browser',
    icon: 'code',
    composePath: 'apps/code-server/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8443/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'bookstack': {
    name: 'bookstack',
    label: 'BookStack',
    description: 'Wiki and knowledge management',
    icon: 'book',
    composePath: 'apps/bookstack/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'filebrowser': {
    name: 'filebrowser',
    label: 'File Browser',
    description: 'Web-based file manager',
    icon: 'folder',
    composePath: 'apps/file-browser/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'homepage': {
    name: 'homepage',
    label: 'Home Page',
    description: 'Custom start page dashboard',
    icon: 'dashboard',
    composePath: 'apps/home-page/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3000/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'n8n': {
    name: 'n8n',
    label: 'n8n',
    description: 'Workflow automation platform',
    icon: 'workflow',
    composePath: 'apps/n8n/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:5678/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'paperless': {
    name: 'paperless',
    label: 'Paperless',
    description: 'Document management system',
    icon: 'document',
    composePath: 'apps/paperless/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'pihole': {
    name: 'pihole',
    label: 'Pi-hole',
    description: 'DNS ad blocker',
    icon: 'shield',
    composePath: 'apps/pihole/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'speedtest': {
    name: 'speedtest',
    label: 'Speedtest',
    description: 'Internet speed testing tool',
    icon: 'speed',
    composePath: 'apps/speedtest/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'tailscale': {
    name: 'tailscale',
    label: 'Tailscale',
    description: 'Mesh VPN service',
    icon: 'vpn',
    composePath: 'apps/tailscale/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'dozzle': {
    name: 'dozzle',
    label: 'Dozzle',
    description: 'Real-time Docker container log viewer',
    icon: 'logs',
    composePath: 'apps/dozzle/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'beszel': {
    name: 'beszel',
    label: 'Beszel',
    description: 'Lightweight server monitoring hub',
    icon: 'monitor',
    composePath: 'apps/beszel/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8090/api/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'mealie': {
    name: 'mealie',
    label: 'Mealie',
    description: 'Recipe manager and meal planner',
    icon: 'food',
    composePath: 'apps/mealie/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'portainer': {
    name: 'portainer',
    label: 'Portainer',
    description: 'Docker container management UI',
    icon: 'container',
    composePath: 'apps/portainer/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
};

/**
 * Get all services
 */
function getAllServices() {
  return Object.values(SERVICES);
}

/**
 * Get a service by name
 */
function getService(name) {
  return SERVICES[name];
}

/**
 * Check if a service name is valid and in the allowlist
 */
function isValidServiceName(name) {
  return name && typeof name === 'string' && SERVICES.hasOwnProperty(name);
}

/**
 * Root directory holding the managed app stacks. Mounted at the same absolute
 * path inside the container as on the host.
 */
function getAppsDir() {
  return process.env.APPS_DIR || path.join(process.cwd(), 'apps');
}

/**
 * Compose project name for a service, derived from its app directory so that
 * containers can be matched back to the service via compose labels.
 */
function getProjectName(name) {
  const service = getService(name);
  return service ? path.basename(path.dirname(service.composePath)) : null;
}

/**
 * Locate a service's compose file on disk.
 * Returns `composeFile: null` when the app is not installed.
 */
function resolveComposeFile(name) {
  const service = getService(name);
  if (!service) {
    return null;
  }

  const projectName = path.basename(path.dirname(service.composePath));
  const appDir = path.join(getAppsDir(), projectName);
  const configured = path.basename(service.composePath);

  for (const candidate of [configured, ...COMPOSE_FILENAMES]) {
    const composeFile = path.join(appDir, candidate);
    if (fs.existsSync(composeFile)) {
      return { projectName, appDir, composeFile };
    }
  }

  return { projectName, appDir, composeFile: null };
}

module.exports = {
  SERVICES,
  getAllServices,
  getService,
  isValidServiceName,
  getAppsDir,
  getProjectName,
  resolveComposeFile,
};
