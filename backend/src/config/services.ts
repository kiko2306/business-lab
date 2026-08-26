/**
 * Service registry and configuration
 * Defines all available services that can be managed by the system.
 * Only services in this allowlist can be controlled via the API.
 */

import fs from 'fs';
import path from 'path';
import { ResolvedComposeFile, ServiceDefinition } from '../types';
import { parseEnvFile } from '../utils/envFile';

// Compose files are named inconsistently across upstream projects, so each
// app directory is probed for any of the filenames Docker Compose accepts.
const COMPOSE_FILENAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];

export const SERVICES: Record<string, ServiceDefinition> = {
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
  'code-server': {
    name: 'code-server',
    label: 'Code Server',
    description: 'VS Code in the browser',
    icon: 'code',
    composePath: 'apps/code-server/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'https://localhost:8443/health',
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
      url: 'http://localhost:80/login',
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
    exposureEnvKeys: {
      url: ['PAPERLESS_URL'],
      allowedHosts: ['PAPERLESS_ALLOWED_HOSTS'],
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

export function getAllServices(): ServiceDefinition[] {
  return Object.values(SERVICES);
}

export function getService(name: string): ServiceDefinition | undefined {
  return SERVICES[name];
}

export function isValidServiceName(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(SERVICES, name);
}

/**
 * Root directory holding the managed app stacks. Mounted at the same absolute
 * path inside the container as on the host.
 */
export function getAppsDir(): string {
  return process.env.APPS_DIR || path.join(process.cwd(), 'apps');
}

/**
 * Compose project name for a service, derived from its app directory so that
 * containers can be matched back to the service via compose labels.
 */
export function getProjectName(name: string): string | null {
  const service = getService(name);
  return service ? path.basename(path.dirname(service.composePath)) : null;
}

/**
 * Locate a service's compose file on disk.
 * Returns `composeFile: null` when the app is not installed.
 */
export function resolveComposeFile(name: string): ResolvedComposeFile | null {
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

export interface ComposeEnvVar {
  key: string;
  // No `:-default` anywhere it's referenced in the compose file — Compose
  // itself will fail to start the service without it.
  required: boolean;
  defaultValue: string | null;
}

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g;

/**
 * Every `${VAR}` / `${VAR:-default}` reference in a compose file, deduped by
 * key. A key referenced without a default anywhere counts as required, even
 * if another occurrence of the same key has one.
 */
export function extractComposeEnvVars(composeContent: string): ComposeEnvVar[] {
  const byKey = new Map<string, ComposeEnvVar>();
  for (const match of composeContent.matchAll(ENV_VAR_PATTERN)) {
    const [, key, defaultValue] = match;
    const hasDefault = defaultValue !== undefined;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { key, required: !hasDefault, defaultValue: hasDefault ? defaultValue : null });
    } else if (!hasDefault) {
      existing.required = true;
    }
  }
  return [...byKey.values()];
}

// Matches a compose `ports:` entry's host-side value, e.g. "8000:8000" or
// "${PAPERLESS_PORT:-8000}:8000". Captures either a literal port or a
// ${VAR:-default} expression, to resolve against the app's .env file.
const HOST_PORT_PATTERN = /-\s*["']?(?:\$\{([A-Z0-9_]+)(?::-([^}]*))?\}|(\d+)):\d+["']?/;

/**
 * Derive the host port a service's primary container publishes, by reading
 * the first `ports:` mapping in its compose file. Used to auto-configure
 * exposure upstream settings instead of requiring the user to enter them.
 */
export function getPublishedUpstreamPort(name: string): number | null {
  const resolved = resolveComposeFile(name);
  if (!resolved?.composeFile) {
    return null;
  }

  const composeContent = fs.readFileSync(resolved.composeFile, 'utf8');
  const match = HOST_PORT_PATTERN.exec(composeContent);
  if (!match) {
    return null;
  }

  const [, varName, varDefault, literalPort] = match;
  let hostPortStr: string | undefined = literalPort;
  if (varName) {
    const envFilePath = path.join(resolved.appDir, '.env');
    const envValues = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};
    hostPortStr = envValues[varName] ?? varDefault;
  }

  const hostPort = hostPortStr ? Number.parseInt(hostPortStr, 10) : NaN;
  return Number.isFinite(hostPort) ? hostPort : null;
}
