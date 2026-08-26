export interface AuthAccessPayload {
  id: number;
  username: string;
}

export interface AuthRefreshPayload {
  id: number;
}

export interface ServiceHealthCheck {
  enabled: boolean;
  type?: 'http';
  url?: string;
  interval?: number;
  timeout?: number;
}

export interface ServiceExposureEnvKeys {
  // Compose env var(s) that should receive the service's public URL
  // (e.g. PAPERLESS_URL) when exposure is enabled.
  url?: string[];
  // Compose env var(s) holding a comma-separated allowed-hosts list that the
  // public hostname must be appended to (e.g. PAPERLESS_ALLOWED_HOSTS).
  allowedHosts?: string[];
}

export interface ServiceSetupToken {
  // Regex with one capture group, applied to the container's full logs, to
  // pull out a one-time first-run setup token/password some images print
  // (e.g. Portainer's `setup_token=<value>`).
  logPattern: string;
}

export interface ServiceDefinition {
  name: string;
  label: string;
  description: string;
  icon: string;
  composePath: string;
  healthCheck: ServiceHealthCheck;
  exposureEnvKeys?: ServiceExposureEnvKeys;
  setupToken?: ServiceSetupToken;
  // Other SERVICES keys (separate compose projects) that must already be
  // running before this one can start — e.g. an app that authenticates
  // against Authelia's OIDC provider needs Authelia up first.
  dependsOn?: string[];
}

export type ServiceState = 'running' | 'stopped' | 'starting' | 'error' | 'unknown';

export interface ServiceStatusPayload {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  state: ServiceState;
  healthy: boolean;
  lastChecked?: Date;
  error?: string;
  setupTokenSupported?: boolean;
  dependsOn?: string[];
}

export interface ServiceStatusSummary {
  total: number;
  running: number;
  stopped: number;
  error: number;
  starting: number;
}

export interface ServiceStatusResponse {
  timestamp: Date;
  services: ServiceStatusPayload[];
  summary: ServiceStatusSummary;
}

export interface ResolvedComposeFile {
  projectName: string;
  appDir: string;
  composeFile: string | null;
}

/** A thrown error shape used across route handlers for consistent HTTP responses. */
export interface HttpError {
  statusCode?: number;
  message: string;
  details?: unknown;
  code?: string;
  stderr?: string;
}

export interface ExposureGlobalConfig {
  baseDomain: string;
  npmApiUrl: string;
  npmEmail: string;
  npmPassword: string;
  cloudflareAccountId: string;
  cloudflareZoneId: string;
  cloudflareTunnelId: string;
  cloudflareApiToken: string;
}

export interface ServiceExposureRow {
  service_name: string;
  enabled: boolean;
  hostname: string | null;
  upstream_scheme: string;
  upstream_host: string | null;
  upstream_port: number | null;
  websocket: boolean;
  npm_host_id: number | null;
  cf_hostname_id: string | null;
  status: string;
  last_error: string | null;
  updated_at: Date;
}

export interface ServiceExposureInput {
  enabled: boolean;
}

export interface ExposureProvisionResult {
  attempted: boolean;
  success?: boolean;
  warning?: string;
  hostname?: string;
}
