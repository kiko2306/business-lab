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

export interface ServiceAdditionalExposure {
  // Appended to the base hostname: <service>-<suffix>.<base-domain>.
  suffix: string;
  // Shown in the dashboard UI (exposure status, audit logs).
  label: string;
  // The compose ${VAR} name whose published host port this hostname should
  // forward to — required because a multi-container app publishes more than
  // one port, so "first port in the file" (the single-hostname default)
  // can't tell them apart. See getPublishedUpstreamPort.
  portEnvVar: string;
  // True if this upstream serves real gRPC (not grpc-web) alongside its REST
  // API on the same port — native clients need HTTP/2 end-to-end, which
  // plain proxy_pass doesn't provide. See buildGrpcAdvancedConfig in
  // npmClient.ts. Defaults to false (plain HTTP/1.1 proxying).
  grpc?: boolean;
}

// Groups services on the dashboard so the grid reads by function instead of
// as one flat list of 25+ cards.
export type ServiceCategory =
  | 'Networking & Security'
  | 'Monitoring & Management'
  | 'Media'
  | 'Backup & Storage'
  | 'Productivity'
  | 'Home Automation'
  | 'Development';

export interface ServiceDefinition {
  name: string;
  label: string;
  description: string;
  icon: string;
  category: ServiceCategory;
  composePath: string;
  healthCheck: ServiceHealthCheck;
  exposureEnvKeys?: ServiceExposureEnvKeys;
  setupToken?: ServiceSetupToken;
  // Whether this service exposes a manageable admin account from the
  // dashboard (currently only Authelia's file-based users_database.yml —
  // see services/autheliaUsers.ts).
  supportsAdminUserManagement?: boolean;
  // Other SERVICES keys (separate compose projects) that must already be
  // running before this one can start — e.g. an app that authenticates
  // against Authelia's OIDC provider needs Authelia up first.
  dependsOn?: string[];
  // Disambiguates which published port is the primary exposure's upstream,
  // for services whose compose file publishes more than one port where the
  // web UI isn't simply the first one listed — e.g. Pi-hole publishes DNS
  // (53/tcp, 53/udp) before its web port, so "first port in the file" (the
  // default getPublishedUpstreamPort behavior — see its docstring) would
  // pick DNS instead. Unset for every service with just one published port.
  exposurePortEnvVar?: string;
  // Secondary public hostnames this service needs beyond its primary one —
  // e.g. NetBird VPN's dashboard is a static SPA with no server-side proxy,
  // so its management API needs its own directly-reachable hostname.
  // Provisioned/torn down automatically alongside the primary exposure.
  additionalExposures?: ServiceAdditionalExposure[];
}

export type ServiceState = 'running' | 'stopped' | 'starting' | 'error' | 'unknown';

// A container's published host port, read live from `docker ps` rather than
// parsed from the compose file — so it reflects what's actually bound right
// now and covers every container in a multi-container project.
export interface ServicePortMapping {
  hostPort: string;
  containerPort: string;
  protocol: string;
}

export interface ServiceStatusPayload {
  name: string;
  label?: string;
  description?: string;
  icon?: string;
  category?: ServiceCategory;
  state: ServiceState;
  healthy: boolean;
  lastChecked?: Date;
  error?: string;
  setupTokenSupported?: boolean;
  adminUserManagementSupported?: boolean;
  dependsOn?: string[];
  ports?: ServicePortMapping[];
  // The service's public hostname, only when exposure is enabled and
  // provisioned successfully — null/absent otherwise, including for
  // services with no published port to expose in the first place.
  exposedHostname?: string | null;
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
  authelia_protected: boolean;
  npm_host_id: number | null;
  cf_hostname_id: string | null;
  status: string;
  last_error: string | null;
  updated_at: Date;
}

export interface ServiceExposureInput {
  enabled: boolean;
  autheliaProtected?: boolean;
}

export interface ExposureProvisionResult {
  attempted: boolean;
  success?: boolean;
  warning?: string;
  hostname?: string;
}
