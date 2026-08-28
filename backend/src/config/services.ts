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
    category: 'Networking & Security',
    composePath: 'apps/nginx-proxy-manager/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:81/health',
      interval: 30000, // 30 seconds
      timeout: 5000,
    },
    // The compose file publishes the proxy listeners (:80, :443) before the
    // admin UI (:81) — "first port in the file" would point exposure at :80,
    // whose default vhost is NPM's "Congratulations" placeholder, not the
    // admin panel. Pin the upstream to the admin port so the dashboard link
    // (and the tunnel route) land on the actual UI.
    exposurePortEnvVar: 'NPM_ADMIN_PORT',
  },
  'netbird-vpn': {
    name: 'netbird-vpn',
    label: 'Netbird VPN',
    description: 'Zero-trust VPN and network access',
    icon: 'vpn',
    category: 'Networking & Security',
    composePath: 'apps/netbird-vpn/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Its dashboard/management containers authenticate against Authelia's
    // OIDC provider — starting before Authelia is up just crash-loops.
    dependsOn: ['authelia'],
    // The dashboard is a static SPA with no server-side proxy for /api —
    // the browser calls the management API directly, so it needs its own
    // reachable hostname (<name>-api.<base-domain>) rather than the
    // internal container address. See NETBIRD_MGMT_API_ENDPOINT in
    // apps/netbird-vpn/docker-compose.yml.
    // grpc: true — native clients (mobile/desktop/CLI) call this endpoint
    // over real gRPC, not just REST/grpc-web like the browser dashboard.
    // That needs HTTP/2 end-to-end through the proxy, or their very first
    // call (fetching the management server's public key) fails with
    // "failed to check SSO support: failed getting management service
    // public key". Plain proxy_pass (the default) is HTTP/1.1-only.
    additionalExposures: [{ suffix: 'api', label: 'Management API', portEnvVar: 'NETBIRD_MGMT_PORT', grpc: true }],
  },
  'home-assistant': {
    name: 'home-assistant',
    label: 'Home Assistant',
    description: 'Home automation platform',
    icon: 'home',
    category: 'Home Automation',
    composePath: 'apps/home-assistant/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8123/api/',
      interval: 30000,
      timeout: 5000,
    },
    // HA returns "400: Bad Request" through any proxy unless its
    // configuration.yaml has an http: block with use_x_forwarded_for +
    // trusted_proxies, and there's no env var for it. See
    // services/exposureConfigFiles.ts.
    exposureConfigFile: true,
  },
  'code-server': {
    name: 'code-server',
    label: 'Code Server',
    description: 'VS Code in the browser',
    icon: 'code',
    category: 'Development',
    composePath: 'apps/code-server/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8443/healthz',
      interval: 30000,
      timeout: 5000,
    },
  },
  'bookstack': {
    name: 'bookstack',
    label: 'BookStack',
    description: 'Wiki and knowledge management',
    icon: 'book',
    category: 'Productivity',
    composePath: 'apps/bookstack/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/login',
      interval: 30000,
      timeout: 5000,
    },
    // BookStack forces redirects to APP_URL and rejects login CSRF if it
    // doesn't match the URL in the browser, so it has to track the public one.
    exposureEnvKeys: {
      url: ['BOOKSTACK_URL'],
    },
  },
  'filebrowser': {
    name: 'filebrowser',
    label: 'File Browser',
    description: 'Web-based file manager',
    icon: 'folder',
    category: 'Backup & Storage',
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
    category: 'Productivity',
    composePath: 'apps/home-page/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3000/health',
      interval: 30000,
      timeout: 5000,
    },
    // gethomepage rejects any request whose Host isn't in HOMEPAGE_ALLOWED_HOSTS
    // with `{"error":"Host validation failed. See logs for more details."}`.
    exposureEnvKeys: {
      allowedHosts: ['HOMEPAGE_ALLOWED_HOSTS'],
    },
  },
  'n8n': {
    name: 'n8n',
    label: 'n8n',
    description: 'Workflow automation platform',
    icon: 'workflow',
    category: 'Productivity',
    composePath: 'apps/n8n/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:5678/health',
      interval: 30000,
      timeout: 5000,
    },
    // n8n blocks the editor ("secure cookie … not using https") unless it
    // knows it's behind HTTPS, and builds webhook/OAuth callback URLs from
    // N8N_HOST / WEBHOOK_URL / N8N_EDITOR_BASE_URL.
    exposureEnvKeys: {
      url: ['N8N_WEBHOOK_URL', 'N8N_EDITOR_BASE_URL'],
      host: ['N8N_HOST'],
      staticOnExposure: { N8N_PROTOCOL: 'https' },
    },
  },
  'paperless': {
    name: 'paperless',
    label: 'Paperless',
    description: 'Document management system',
    icon: 'document',
    category: 'Backup & Storage',
    composePath: 'apps/paperless/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    exposureEnvKeys: {
      // PAPERLESS_URL feeds ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS derivation,
      // but set CSRF explicitly too — a bare 400 on the login POST is exactly
      // what a missing trusted origin looks like.
      url: ['PAPERLESS_URL', 'PAPERLESS_CSRF_TRUSTED_ORIGINS'],
      allowedHosts: ['PAPERLESS_ALLOWED_HOSTS'],
    },
  },
  'pihole': {
    name: 'pihole',
    label: 'Pi-hole',
    description: 'DNS ad blocker',
    icon: 'shield',
    category: 'Networking & Security',
    composePath: 'apps/pihole/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // The compose file publishes DNS (53/tcp, 53/udp) before the web UI
    // port — "first port in the file" would pick DNS, not the web UI, so
    // exposure needs to be told explicitly which one is the actual upstream.
    exposurePortEnvVar: 'PIHOLE_WEB_PORT',
    // Pi-hole serves its admin UI under /admin; the bare root just redirects
    // (or 403s on v6), so the dashboard link has to target the sub-path.
    webPath: '/admin',
  },
  'speedtest': {
    name: 'speedtest',
    label: 'Speedtest',
    description: 'Internet speed testing tool',
    icon: 'speed',
    category: 'Monitoring & Management',
    composePath: 'apps/speedtest/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // speedtest-tracker is a Laravel app: wrong APP_URL = broken assets and
    // 419 CSRF errors on login once it's proxied.
    exposureEnvKeys: {
      url: ['SPEEDTEST_APP_URL'],
    },
  },
  'tailscale': {
    name: 'tailscale',
    label: 'Tailscale',
    description: 'Mesh VPN service',
    icon: 'vpn',
    category: 'Networking & Security',
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
    category: 'Monitoring & Management',
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
    category: 'Monitoring & Management',
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
    category: 'Productivity',
    composePath: 'apps/mealie/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Mealie builds share links, OAuth redirects and API URLs from BASE_URL;
    // wrong value = broken login and links once proxied.
    exposureEnvKeys: {
      url: ['MEALIE_BASE_URL'],
    },
  },
  'portainer': {
    name: 'portainer',
    label: 'Portainer',
    description: 'Docker container management UI',
    icon: 'container',
    category: 'Monitoring & Management',
    composePath: 'apps/portainer/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // Portainer prints a one-time initial-admin setup token to its logs on
    // first start (`setup_token=<value>`), valid for 5 minutes.
    setupToken: {
      logPattern: 'setup_token=(\\S+)',
    },
  },
  'vaultwarden': {
    name: 'vaultwarden',
    label: 'Vaultwarden',
    description: 'Self-hosted password manager (Bitwarden-compatible)',
    icon: 'lock',
    category: 'Networking & Security',
    composePath: 'apps/vaultwarden/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/alive',
      interval: 30000,
      timeout: 5000,
    },
    // Vaultwarden needs DOMAIN to exactly match the browser URL or WebAuthn,
    // attachments and the /admin panel break — so the dashboard drives it
    // from the exposure hostname and shows it read-only instead of letting
    // the user type a value.
    exposureEnvKeys: {
      url: ['VAULTWARDEN_DOMAIN'],
    },
    managedEnvKeys: ['VAULTWARDEN_DOMAIN'],
    booleanEnvKeys: ['VAULTWARDEN_SIGNUPS_ALLOWED'],
    // ADMIN_TOKEN only unlocks the /admin panel; generate it during setup and
    // keep it out of the dashboard entirely.
    hiddenGeneratedSecrets: ['VAULTWARDEN_ADMIN_TOKEN'],
  },
  'uptime-kuma': {
    name: 'uptime-kuma',
    label: 'Uptime Kuma',
    description: 'Uptime and status monitoring with alerts',
    icon: 'pulse',
    category: 'Monitoring & Management',
    composePath: 'apps/uptime-kuma/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3001',
      interval: 30000,
      timeout: 5000,
    },
  },
  'authelia': {
    name: 'authelia',
    label: 'Authelia',
    description: 'Single sign-on and 2FA gateway',
    icon: 'key',
    category: 'Networking & Security',
    composePath: 'apps/authelia/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    supportsAdminUserManagement: true,
  },
  'duplicati': {
    name: 'duplicati',
    label: 'Duplicati',
    description: 'Encrypted offsite/cloud backup',
    icon: 'backup',
    category: 'Backup & Storage',
    composePath: 'apps/duplicati/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8200',
      interval: 30000,
      timeout: 5000,
    },
    // Duplicati 2.x rejects requests whose Host header isn't allow-listed;
    // its compose default is "*" so it works proxied out of the box. If you
    // narrow DUPLICATI__WEBSERVICE_ALLOWEDHOSTNAMES in .env, add the public
    // hostname there yourself.
  },
  'nextcloud': {
    name: 'nextcloud',
    label: 'Nextcloud',
    description: 'File sync, calendar, and contacts',
    icon: 'cloud',
    category: 'Backup & Storage',
    composePath: 'apps/nextcloud/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:80/status.php',
      interval: 30000,
      timeout: 5000,
    },
    // Nextcloud hard-blocks unknown domains ("Access through untrusted
    // domain") and needs the overwrite* knobs to emit https:// URLs behind a
    // TLS-terminating proxy. TRUSTED_DOMAINS is space-separated, not comma.
    exposureEnvKeys: {
      allowedHosts: ['NEXTCLOUD_TRUSTED_DOMAINS'],
      allowedHostsSeparator: ' ',
      host: ['NEXTCLOUD_OVERWRITEHOST'],
      staticOnExposure: {
        NEXTCLOUD_OVERWRITEPROTOCOL: 'https',
        NEXTCLOUD_TRUSTED_PROXIES: '10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 fc00::/7',
      },
    },
  },
  'immich': {
    name: 'immich',
    label: 'Immich',
    description: 'Photo and video backup with mobile auto-upload',
    icon: 'photo',
    category: 'Media',
    composePath: 'apps/immich/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:2283/api/server/ping',
      interval: 30000,
      timeout: 5000,
    },
  },
  'jellyfin': {
    name: 'jellyfin',
    label: 'Jellyfin',
    description: 'Home media server',
    icon: 'media',
    category: 'Media',
    composePath: 'apps/jellyfin/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8096/health',
      interval: 30000,
      timeout: 5000,
    },
  },
  'vikunja': {
    name: 'vikunja',
    label: 'Vikunja',
    description: 'Task and project management',
    icon: 'tasks',
    category: 'Productivity',
    composePath: 'apps/vikunja/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
    // VIKUNJA_JWT_SECRET has no default — pre-generate it in the config
    // panel. VIKUNJA_PUBLIC_URL feeds Vikunja's own PUBLICURL (used to build
    // links and validate the frontend origin), so it has to follow the
    // public hostname once exposure is on.
    autoGeneratedSecrets: ['VIKUNJA_JWT_SECRET'],
    exposureEnvKeys: {
      url: ['VIKUNJA_PUBLIC_URL'],
    },
  },
  'watchtower': {
    name: 'watchtower',
    label: 'Watchtower',
    description: 'Automatic container image updates',
    icon: 'update',
    category: 'Monitoring & Management',
    composePath: 'apps/watchtower/docker-compose.yml',
    healthCheck: {
      enabled: false,
    },
  },
  'ntfy': {
    name: 'ntfy',
    label: 'ntfy',
    description: 'Push notifications to phone and desktop',
    icon: 'bell',
    category: 'Monitoring & Management',
    composePath: 'apps/ntfy/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8010/v1/health',
      interval: 30000,
      timeout: 5000,
    },
    // ntfy builds the web app base href, click links and attachment URLs from
    // NTFY_BASE_URL, and only trusts X-Forwarded-For when NTFY_BEHIND_PROXY is
    // set — both follow the public hostname once exposure is enabled.
    exposureEnvKeys: {
      url: ['NTFY_BASE_URL'],
      staticOnExposure: { NTFY_BEHIND_PROXY: 'true' },
    },
  },
  'waha': {
    name: 'waha',
    label: 'WAHA',
    description: 'WhatsApp HTTP API — REST, webhooks, and a dashboard',
    icon: 'chat',
    category: 'Productivity',
    composePath: 'apps/waha/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:3009/health',
      interval: 30000,
      timeout: 5000,
    },
    // WAHA_BASE_URL feeds webhook payloads, Swagger's server URL and the
    // QR/screenshot links — it has to follow the public hostname once exposed.
    exposureEnvKeys: {
      url: ['WAHA_BASE_URL'],
    },
  },
  'stirling-pdf': {
    name: 'stirling-pdf',
    label: 'Stirling-PDF',
    description: 'Local PDF toolkit (merge, split, OCR, sign, convert)',
    icon: 'pdf',
    category: 'Backup & Storage',
    composePath: 'apps/stirling-pdf/docker-compose.yml',
    healthCheck: {
      enabled: true,
      type: 'http',
      url: 'http://localhost:8009/api/v1/info/status',
      interval: 30000,
      timeout: 5000,
    },
    // No Host-header / allowed-origin validation — nothing to sync on exposure.
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
 * Derive a service's published host port from its compose file, used to
 * auto-configure exposure upstream settings instead of requiring the user to
 * enter them. Without `portEnvVar`, returns the first `ports:` mapping found
 * (the common single-port-per-app case). With it, returns the port whose
 * mapping uses that specific `${VAR}` — needed once an app publishes more
 * than one port (see `additionalExposures` on ServiceDefinition), since file
 * order alone can't disambiguate which port belongs to which container.
 */
export function getPublishedUpstreamPort(name: string, portEnvVar?: string): number | null {
  const resolved = resolveComposeFile(name);
  if (!resolved?.composeFile) {
    return null;
  }

  const composeContent = fs.readFileSync(resolved.composeFile, 'utf8');
  const envFilePath = path.join(resolved.appDir, '.env');
  const envValues = fs.existsSync(envFilePath) ? parseEnvFile(envFilePath) : {};

  const resolvePort = (varName: string | undefined, varDefault: string | undefined, literalPort: string | undefined) => {
    const hostPortStr = varName ? envValues[varName] ?? varDefault : literalPort;
    const hostPort = hostPortStr ? Number.parseInt(hostPortStr, 10) : NaN;
    return Number.isFinite(hostPort) ? hostPort : null;
  };

  if (portEnvVar) {
    for (const match of composeContent.matchAll(new RegExp(HOST_PORT_PATTERN.source, 'g'))) {
      const [, varName, varDefault, literalPort] = match;
      if (varName === portEnvVar) {
        return resolvePort(varName, varDefault, literalPort);
      }
    }
    return null;
  }

  const match = HOST_PORT_PATTERN.exec(composeContent);
  if (!match) {
    return null;
  }
  const [, varName, varDefault, literalPort] = match;
  return resolvePort(varName, varDefault, literalPort);
}
