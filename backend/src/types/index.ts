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

export interface ServiceDefinition {
  name: string;
  label: string;
  description: string;
  icon: string;
  composePath: string;
  healthCheck: ServiceHealthCheck;
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
  upstreamScheme: string;
  upstreamHost: string;
  upstreamPort: number;
  websocket: boolean;
}

export interface ExposureProvisionResult {
  attempted: boolean;
  success?: boolean;
  warning?: string;
  hostname?: string;
}
